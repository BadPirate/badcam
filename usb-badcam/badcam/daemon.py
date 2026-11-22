"""The state machine of PLAN section 5.5."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Callable

from . import __version__, log
from .config import Config
from .platform import Platform
from .power import PowerSource
from .scanner import ScanEvent, StabilityTracker, scan
from .state import State
from .uploader import ApiClient, CycleAbort, CycleStats, Interrupted, Uploader

RECORDING = "RECORDING"
LIVE_UPLOAD = "LIVE_UPLOAD"
DETACHED_WORK = "DETACHED_WORK"
ON_BATTERY_IDLE = "ON_BATTERY_IDLE"
POLL_S = 5
BRIEF_MAX_S = 300

ClientFactory = Callable[[Config], ApiClient]


def default_client(cfg: Config) -> ApiClient:
    return ApiClient(cfg.server.url, cfg.server.token)


class Daemon:
    def __init__(
        self,
        cfg: Config,
        platform: Platform,
        power: PowerSource,
        state: State,
        client_factory: ClientFactory = default_client,
        last_cycle_log: Path | None = None,
    ) -> None:
        self.cfg = cfg
        self.p = platform
        self.power = power
        self.db = state
        self.client_factory = client_factory
        self.last_cycle_log = last_cycle_log
        self.state = RECORDING
        self.stability = StabilityTracker(cfg.storage.settle_s)
        self.lost_since: float | None = None
        self.last_live = -1e12
        self.backoff_until = 0.0
        self.pending_files = 0
        self.undeleted_bytes = 0
        self.last_free: int | None = None
        self.last_idle_attempt = 0.0
        self.stopped = False
        self.last_summary = ""

    # -- helpers ----------------------------------------------------------------
    def set_state(self, new: str) -> None:
        if new != self.state:
            log.get().info("state %s -> %s", self.state, new)
        self.state = new
        self._publish()

    def _publish(self, extra: dict | None = None) -> None:
        info = {
            "version": __version__,
            "state": self.state,
            "time": self.p.now(),
            "pending_files": self.pending_files,
            "last_summary": self.last_summary,
            "gadget_up": self.p.gadget_is_up(),
        }
        info.update(extra or {})
        try:
            self.db.set_meta("status", json.dumps(info))
        except Exception:  # pragma: no cover
            pass

    def ping_body(self) -> dict:
        body: dict = {
            "version": __version__,
            "state": self.state,
            "car_power": self.power.car_power(),
            "pending_files": self.pending_files,
        }
        vin, vbat = getattr(self.power, "vin_v", lambda: None)(), self.power.battery_v()
        if vin is not None:
            body["vin_v"] = round(vin, 2)
        if vbat is not None:
            body["battery_v"] = round(vbat, 2)
        if self.last_free is not None:
            body["free_bytes"] = self.last_free
        return body

    def network_ok(self, client: ApiClient | None = None) -> ApiClient | None:
        """Return a connected client if we are on an upload network and the server accepts."""
        ssid = self.p.current_ssid()
        if not ssid or ssid not in self.cfg.upload_ssids():
            return None
        c = client or self.client_factory(self.cfg)
        try:
            r = c.ping(self.ping_body())
        except CycleAbort:
            c.close()
            return None
        if r.status == 200 and r.body.get("accepting") is True:
            return c
        c.close()
        return None

    def battery_low(self) -> bool:
        v = self.power.battery_v()
        return v is not None and v < self.cfg.ups.vbat_low_v

    def battery_critical(self) -> bool:
        v = self.power.battery_v()
        return v is not None and v < self.cfg.ups.vbat_critical_v

    def _finish_cycle_log(self) -> None:
        if self.last_cycle_log:
            log.RING.dump(self.last_cycle_log)

    def critical_shutdown(self) -> None:
        log.get().error("battery critical: shutting down")
        if self.p.is_mounted():
            self.p.unmount()
        self.p.poweroff()
        self.stopped = True

    # -- startup ----------------------------------------------------------------
    def startup(self) -> None:
        if self.p.is_mounted():
            log.get().warning("stale mount found at start; unmounting")
            self.p.unmount()
        if not self.p.gadget_is_up():
            log.get().info("gadget not bound; binding")
            self.p.gadget_up()
        self.p.wifi_unblock()  # a stale rfkill block from a previous standby must not survive a reboot
        self.set_state(RECORDING)

    # -- main loop --------------------------------------------------------------
    def run(self) -> None:
        self.startup()
        while not self.stopped:
            self.step()

    def step(self) -> None:
        """One iteration of the current state."""
        car = self.power.car_power()
        if not car and self.battery_critical():
            self.critical_shutdown()
            return
        if self.state == RECORDING:
            self._step_recording(car)
        elif self.state == DETACHED_WORK:
            self._detached_and_next()
        elif self.state == ON_BATTERY_IDLE:
            self._step_idle(car)
        else:  # pragma: no cover
            self.set_state(RECORDING)

    def _step_recording(self, car: bool) -> None:
        now = self.p.now()
        if car:
            self.lost_since = None
        else:
            if self.lost_since is None:
                self.lost_since = now
            if now - self.lost_since >= self.cfg.power.debounce_s:
                log.get().info("car power lost for %ss", self.cfg.power.debounce_s)
                self.lost_since = None
                self.set_state(DETACHED_WORK)
                return
        if car and now >= self.backoff_until:
            if self.cfg.live.enabled and now - self.last_live >= self.cfg.live.interval_s:
                self.last_live = now
                self.live_cycle()
                return
            if self.cfg.live.enabled and self._reclaim_needed():
                client = self.network_ok()
                if client is not None:
                    client.close()
                    log.get().info("reclaiming space: brief eject")
                    self.detached_cycle(brief=True)
                    return
        self.p.sleep(POLL_S)

    def _reclaim_needed(self) -> bool:
        s, lv = self.cfg.storage, self.cfg.live
        if self.last_free is not None and self.last_free < s.min_free_gb * 1024**3:
            return True
        return lv.reclaim_eject and self.undeleted_bytes >= lv.reclaim_gb * 1024**3

    def _detached_and_next(self) -> None:
        reason = self.detached_cycle(brief=False)
        if reason == "car_back":
            self.set_state(RECORDING)
        elif self.power.car_power():
            self.set_state(RECORDING)
        else:
            self.set_state(ON_BATTERY_IDLE)
            self.last_idle_attempt = self.p.now()
            if self.battery_low() or self.cfg.power.on_battery_idle == "poweroff":
                log.get().info("work done on battery (or battery low): powering off")
                self.p.poweroff()
                self.stopped = True
            else:
                if getattr(self.power, "trusted", lambda: True)():
                    log.get().info("work done on battery: standby (Wi-Fi off)")
                    self.p.wifi_block()
                else:
                    # Uncalibrated: 'car power lost' may just mean no USB host (bench/desk).
                    # Keep Wi-Fi on so the Pi stays reachable over SSH.
                    log.get().info("work done on battery: standby (Wi-Fi kept on, UPS not calibrated)")

    # -- LIVE_UPLOAD --------------------------------------------------------------
    def live_cycle(self) -> CycleStats | None:
        """Read-only upload while the car is attached. Never writes to the image."""
        client = self.network_ok()
        if client is None:
            return None
        self.set_state(LIVE_UPLOAD)
        log.RING.reset()
        stats = CycleStats()
        try:
            mount = self.p.mount_ro()
            try:
                events = scan(mount)
                self.last_free = self.p.free_bytes()
                self.undeleted_bytes = self._undeleted_bytes(events)
                stable = self.stability.update(events, self.p.now())
                log.get().info("live scan: %d events, %d stable", len(events), len(stable))
                up = Uploader(
                    client, self.db, self.cfg.server.chunk_mb * 1024 * 1024,
                    stop_check=self._live_stop, delete=False, record_invalid=False,
                )
                try:
                    stats = up.run(stable)
                except Interrupted as exc:
                    stats = up.stats
                    log.get().info("live cycle interrupted: %s", exc.reason)
                except CycleAbort as exc:
                    stats = up.stats
                    self._abort(exc)
                self.undeleted_bytes = self._undeleted_bytes(scan(mount))
            finally:
                self.p.unmount()
        except Exception as exc:
            log.get().error("live cycle failed: %s", exc)
            stats.errors += 1
            if self.p.is_mounted():
                self.p.unmount()
        finally:
            client.close()
        self.last_summary = "live: " + stats.summary()
        log.get().info(self.last_summary)
        self._finish_cycle_log()
        self.set_state(RECORDING)
        return stats

    def _live_stop(self) -> str | None:
        return None

    def _undeleted_bytes(self, events: list[ScanEvent]) -> int:
        total = 0
        for ev in events:
            for f in ev.files:
                rec = self.db.get(f.rel)
                if rec and rec.size == f.size and rec.mtime == f.mtime:
                    total += f.size
        return total

    def _abort(self, exc: CycleAbort) -> None:
        log.get().warning("cycle aborted: %s (back off %ss)", exc.reason, exc.backoff_s)
        self.backoff_until = self.p.now() + exc.backoff_s

    # -- DETACHED_WORK --------------------------------------------------------------
    def detached_cycle(self, brief: bool = False) -> str:
        """Exclusive access: fsck, delete uploaded, upload remainder, purge, rebind.

        Returns done | car_back | low_battery | cap | aborted | brief.
        """
        started = self.p.now()
        log.RING.reset()
        stats = CycleStats()
        reason = "done"
        deadline = started + (BRIEF_MAX_S if brief else self.cfg.power.max_battery_min * 60)

        def stop_check() -> str | None:
            if not brief and self.power.car_power():
                return "car_back"
            if not brief and self.battery_low():
                return "low_battery"
            if self.p.now() > deadline:
                return "cap"
            return None

        self.set_state(DETACHED_WORK)
        self.p.gadget_down()
        try:
            if not brief:
                try:
                    self.p.fsck()
                except Exception as exc:
                    log.get().warning("fsck failed (ignored): %s", exc)
            mount = self.p.mount_rw()
            try:
                events = scan(mount, self.cfg.storage.upload_recent)
                stats.deleted += self._delete_known(events)
                events = scan(mount, self.cfg.storage.upload_recent)
                client = None if brief else self._wait_network(stop_check)
                if client is not None:
                    up = Uploader(
                        client, self.db, self.cfg.server.chunk_mb * 1024 * 1024,
                        stop_check=stop_check, delete=True, record_invalid=True,
                    )
                    up.stats.deleted = stats.deleted
                    try:
                        stats = up.run(events)
                    except Interrupted as exc:
                        stats = up.stats
                        reason = exc.reason
                    except CycleAbort as exc:
                        stats = up.stats
                        reason = "aborted"
                        self._abort(exc)
                    finally:
                        client.close()
                elif not brief:
                    reason = stop_check() or "done"
                    log.get().info("no upload network; nothing uploaded")
                stats.deleted += self._purge_low_space(mount)
                remaining = scan(mount, self.cfg.storage.upload_recent)
                self.pending_files = sum(len(e.upload_order()) for e in remaining)
                self.undeleted_bytes = 0
                self.last_free = self.p.free_bytes()
            finally:
                try:
                    os.sync()
                except OSError:  # pragma: no cover
                    pass
                self.p.unmount()
        except Exception as exc:
            log.get().error("detached cycle failed: %s", exc)
            stats.errors += 1
            reason = "aborted"
            if self.p.is_mounted():
                self.p.unmount()
        finally:
            self.p.gadget_up()
        self.last_summary = f"detached({'brief' if brief else 'full'}) {reason}: " + stats.summary()
        log.get().info(self.last_summary)
        self._finish_cycle_log()
        if brief:
            self.set_state(RECORDING)
            return "brief"
        if reason == "car_back":
            self.set_state(RECORDING)
        return reason

    def _delete_known(self, events: list[ScanEvent]) -> int:
        """Delete files recorded as uploaded (size+mtime unchanged) and junk files."""
        n = 0
        for ev in events:
            if ev.kind == "RecentClips" and not self.cfg.storage.upload_recent:
                continue
            for f in ev.files:
                rec = self.db.get(f.rel)
                if f.junk or (rec and rec.size == f.size and rec.mtime == f.mtime):
                    try:
                        os.unlink(f.abs)
                        n += 1
                    except OSError:
                        pass
            if ev.folder is not None and ev.kind != "RecentClips":
                try:
                    os.rmdir(ev.folder)
                except OSError:
                    pass
        return n

    def _wait_network(self, stop_check: Callable[[], str | None]) -> ApiClient | None:
        waited = 0.0
        while True:
            if stop_check():
                return None
            client = self.network_ok()
            if client is not None:
                return client
            if waited >= self.cfg.power.wifi_wait_s:
                return None
            self.p.sleep(2)
            waited += 2

    def _purge_low_space(self, mount: Path) -> int:
        """Delete oldest SentryClips events until free space is above the floor."""
        floor = int(self.cfg.storage.min_free_gb * 1024**3)
        if self.p.free_bytes() >= floor:
            return 0
        n = 0
        events = [e for e in scan(mount) if e.kind == "SentryClips"]
        for ev in sorted(events, key=lambda e: e.name):  # oldest first
            if self.p.free_bytes() >= floor:
                break
            log.get().warning("DATA LOSS: free space low, deleting un-uploaded event %s", ev.key)
            for f in ev.files:
                try:
                    os.unlink(f.abs)
                    n += 1
                except OSError:
                    pass
            if ev.folder is not None:
                try:
                    os.rmdir(ev.folder)
                except OSError:
                    pass
        return n

    # -- ON_BATTERY_IDLE --------------------------------------------------------------
    def _step_idle(self, car: bool) -> None:
        if car:
            self.p.wifi_unblock()
            self.set_state(RECORDING)
            return
        if self.battery_low():
            log.get().warning("battery low in idle: powering off")
            self.p.poweroff()
            self.stopped = True
            return
        now = self.p.now()
        if self.pending_files and now - self.last_idle_attempt >= self.cfg.power.idle_retry_min * 60:
            self.last_idle_attempt = now
            self.p.wifi_unblock()
            self._detached_and_next()
            return
        self.p.sleep(POLL_S)

    # -- one-shot (CLI) --------------------------------------------------------------
    def once(self, mode: str) -> str:
        if self.p.is_mounted():
            self.p.unmount()
        if mode == "live":
            stats = self.live_cycle()
            return self.last_summary if stats else "live: no upload network"
        reason = self.detached_cycle(brief=False)
        return self.last_summary or reason
