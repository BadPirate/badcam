import pytest

from badcam.daemon import DETACHED_WORK, ON_BATTERY_IDLE, RECORDING


def drive(env, steps=200, until=None):
    for _ in range(steps):
        if env.daemon.stopped or (until and until()):
            return
        env.daemon.step()


def test_detached_cycle_uploads_deletes_and_completes(env):
    env.build(events=2, minutes=2)
    (env.root / "TeslaCam/SentryClips/2026-11-20_18-00-00/2026-11-20_18-02-00-front.mp4").write_bytes(b"x" * 500)  # junk
    env.daemon.startup()
    reason = env.daemon.detached_cycle()
    assert reason == "done"
    assert len(env.mock.index) == 2 * 10
    assert len(env.mock.completed) == 2
    assert env.files_left() == []
    assert not list((env.root / "TeslaCam/SentryClips").iterdir())  # empty folders removed
    assert env.p.gadget  # rebound
    assert env.p.calls[:3] == ["gadget_down", "fsck", "mount_rw"] or "gadget_down" in env.p.calls


def test_never_mount_rw_while_gadget_up(env):
    env.build(events=1, minutes=1)
    env.daemon.startup()
    env.daemon.detached_cycle()
    env.daemon.live_cycle()
    env.daemon.detached_cycle(brief=True)
    assert env.p.rw_while_gadget_up == 0
    downs = [i for i, c in enumerate(env.p.calls) if c == "gadget_down"]
    rws = [i for i, c in enumerate(env.p.calls) if c == "mount_rw"]
    for rw in rws:
        last = max(d for d in downs if d < rw)
        assert "gadget_up" not in env.p.calls[last:rw]


def test_live_cycle_deletes_nothing_and_skips_invalid(env):
    env.build(events=1, minutes=1)
    env.power.car = True
    env.mock.invalid_substrings = ["-back.mp4"]
    before = sorted(env.files_left())
    env.daemon.startup()
    env.daemon.live_cycle()
    assert sorted(env.files_left()) == before  # nothing deleted
    assert "mount_ro" in env.p.calls and "mount_rw" not in env.p.calls
    recorded = [r[0] for r in env.state.db.execute("SELECT path FROM uploaded")]
    assert recorded and not any(r.endswith("-back.mp4") for r in recorded)
    assert env.mock.completed == []  # an invalid file means the event is not complete yet
    assert env.p.gadget  # live mode never unbinds
    # detached mode counts valid:false as uploaded and cleans up
    env.power.car = False
    env.daemon.detached_cycle()
    assert env.files_left() == []
    assert len(env.mock.completed) == 1


def test_live_requires_stability(env):
    env.cfg.storage.settle_s = 120
    env.daemon.stability.settle_s = 120
    env.build(events=1, minutes=1)
    env.power.car = True
    env.daemon.startup()
    env.daemon.live_cycle()
    assert env.mock.index == {}  # first sight: not yet stable
    env.p.t += 130
    env.daemon.live_cycle()
    assert len(env.mock.index) == 6


def test_only_upload_ssids(env):
    env.build(events=1, minutes=1)
    env.p.ssid = "Guest"  # connected but upload = false
    env.daemon.startup()
    env.cfg.power.wifi_wait_s = 2
    env.daemon.detached_cycle()
    assert env.mock.index == {}
    assert len(env.files_left()) == 6  # nothing deleted
    env.p.ssid = "HomeNet"
    env.mock.accepting = False  # server says not accepting
    env.daemon.detached_cycle()
    assert env.mock.index == {}
    env.mock.accepting = True
    env.daemon.detached_cycle()
    assert len(env.mock.index) == 6


def test_power_return_mid_cycle_rebinds_and_stops(env):
    env.build(events=3, minutes=2)
    env.daemon.startup()
    sent = {"n": 0}

    def on_call(p, name):
        pass

    # car comes back after the second PUT
    def car():
        puts = sum(1 for m, _, _ in env.mock.requests if m == "PUT")
        return puts >= 2

    env.power.car_fn = car
    reason = env.daemon.detached_cycle()
    assert reason == "car_back"
    assert env.p.calls[-2:] == ["unmount", "gadget_up"]
    assert env.p.gadget and env.daemon.state == RECORDING
    assert 0 < len(env.mock.index) < 30
    assert env.p.poweroffs == 0


def test_low_battery_aborts_and_poweroff(env):
    env.build(events=3, minutes=2)
    env.daemon.startup()
    env.power.vbat_fn = lambda: 3.3 if sum(1 for m, _, _ in env.mock.requests if m == "PUT") >= 2 else 4.0
    env.power.car = False
    env.daemon.state = DETACHED_WORK
    drive(env)
    assert env.p.poweroffs == 1
    assert env.p.calls.count("unmount") >= 1 and env.p.gadget
    assert len(env.mock.index) < 30


def test_critical_battery_in_any_state_unmounts_and_powers_off(env):
    env.daemon.startup()
    env.power.vbat = 3.1
    env.p.mounted = "ro"
    env.daemon.step()
    assert env.p.poweroffs == 1 and env.p.mounted is None


def test_standby_vs_poweroff(env):
    env.build(events=1, minutes=1)
    env.daemon.startup()
    # standby (default): Wi-Fi off, no poweroff, stays up
    env.daemon.set_state(DETACHED_WORK)
    env.daemon.step()
    assert env.daemon.state == ON_BATTERY_IDLE and env.p.wifi_blocked and env.p.poweroffs == 0
    env.daemon.step()
    assert env.daemon.state == ON_BATTERY_IDLE and env.p.poweroffs == 0
    # car power returns: Wi-Fi back, recording
    env.power.car = True
    env.daemon.step()
    assert env.daemon.state == RECORDING and not env.p.wifi_blocked


def test_poweroff_option(env):
    env.cfg.power.on_battery_idle = "poweroff"
    env.build(events=1, minutes=1)
    env.daemon.startup()
    env.daemon.set_state(DETACHED_WORK)
    env.daemon.step()
    assert env.p.poweroffs == 1 and env.daemon.stopped


def test_recording_to_detached_after_debounce(env):
    env.build(events=1, minutes=1)
    env.power.car = True
    env.cfg.live.enabled = False
    env.daemon.startup()
    env.daemon.step()
    env.power.car = False
    drive(env, until=lambda: env.daemon.state != RECORDING)
    assert env.daemon.state == DETACHED_WORK
    assert env.p.t - 1000 >= env.cfg.power.debounce_s
    env.daemon.step()
    assert env.files_left() == [] and env.daemon.state == ON_BATTERY_IDLE


def test_standby_retries_pending_files_periodically(env):
    env.build(events=1, minutes=1)
    env.p.ssid = None  # no network at all
    env.cfg.power.wifi_wait_s = 2
    env.daemon.startup()
    env.daemon.set_state(DETACHED_WORK)
    env.daemon.step()
    assert env.daemon.pending_files == 6 and env.daemon.state == ON_BATTERY_IDLE
    env.p.ssid = "HomeNet"
    drive(env, steps=2000, until=lambda: not env.files_left())
    assert env.files_left() == []
    assert env.daemon.state == ON_BATTERY_IDLE


def test_server_unreachable_deletes_nothing(env):
    env.build(events=1, minutes=1)
    env.srv.shutdown()
    env.srv.server_close()
    env.cfg.power.wifi_wait_s = 2
    env.daemon.startup()
    env.daemon.detached_cycle()
    assert len(env.files_left()) == 6


def test_507_in_detached_deletes_nothing(env):
    env.build(events=2, minutes=1)
    env.mock.storage_full = True
    env.daemon.startup()
    env.daemon.detached_cycle()
    assert len(env.files_left()) == 12
    assert env.daemon.backoff_until > env.p.t


def test_low_space_purges_oldest_sentry_first(env):
    env.build(events=3, minutes=1)
    env.p.ssid = None
    env.cfg.power.wifi_wait_s = 0
    env.cfg.storage.size_gb = 40
    env.cfg.storage.min_free_gb = 1
    # free space is below the floor until only one event is left
    def free():
        folders = {p.parent.name for p in env.files_left()}
        return 0 if len(folders) > 1 else 10**10

    env.p.free_bytes = free
    env.daemon.startup()
    env.daemon.detached_cycle()
    left = {p.parent.name for p in env.files_left()}
    assert "2026-11-20_18-00-00" not in left  # oldest purged first
    assert "2026-11-20_19-00-00" in left


def test_brief_eject_reclaims_uploaded_files(env):
    env.build(events=1, minutes=1)
    env.power.car = True
    env.cfg.live.reclaim_gb = 0.000001
    env.daemon.startup()
    env.daemon.live_cycle()  # uploads, records, keeps files
    assert len(env.files_left()) == 6 and env.daemon.undeleted_bytes > 0
    env.daemon.last_live = env.p.t
    env.daemon.step()  # sees reclaim condition and does a brief detached cycle
    assert env.files_left() == []
    assert env.daemon.state == RECORDING and env.p.gadget


def test_reclaim_can_be_disabled(env):
    env.build(events=1, minutes=1)
    env.power.car = True
    env.cfg.live.reclaim_eject = False
    env.cfg.live.reclaim_gb = 0.000001
    env.daemon.startup()
    env.daemon.live_cycle()
    env.daemon.last_live = env.p.t
    env.daemon.step()
    assert len(env.files_left()) == 6


def test_startup_unmounts_stale_and_binds_gadget(env):
    env.p.mounted = "rw"
    env.p.gadget = False
    env.daemon.startup()
    assert env.p.mounted is None and env.p.gadget


def test_recent_clips_only_when_enabled(env):
    env.build(events=0)
    (env.root / "TeslaCam/RecentClips/2026-11-22_10-00-00-front.mp4").write_bytes(b"x" * 200_000)
    env.daemon.startup()
    env.daemon.detached_cycle()
    assert env.mock.index == {} and len(env.files_left()) == 1
    env.cfg.storage.upload_recent = True
    env.daemon.detached_cycle()
    assert "RecentClips/2026-11-22_10-00-00-front.mp4" in env.mock.index
    assert env.files_left() == []


def test_fsck_skipped_when_clean_and_recent(env):
    env.build(events=1, minutes=1)
    env.daemon.startup()
    env.p.dirty, env.p.fsck_age = False, 1.0
    env.daemon.detached_cycle()
    assert "fsck" not in env.p.calls  # saves ~6 min per cycle on a Zero W with a 20 GB image


def test_fsck_runs_when_dirty_stale_or_forced(env):
    env.build(events=1, minutes=1)
    env.daemon.startup()
    for dirty, age, mode, expect in [
        (True, 1.0, "auto", True),
        (False, 31.0, "auto", True),
        (False, 1.0, "always", True),
        (True, 99.0, "never", False),
        (False, None, "auto", False),  # fresh image: stamp, do not check
    ]:
        env.p.calls.clear()
        env.p.dirty, env.p.fsck_age = dirty, age
        env.cfg.storage.fsck = mode
        env.daemon.detached_cycle()
        assert ("fsck" in env.p.calls) is expect, (dirty, age, mode)
    assert env.p.fsck_age == 0.0


def test_fs_dirty_flag_parsing(tmp_path):
    from badcam.config import Config
    from badcam.platform import LinuxPlatform

    cfg = Config()
    cfg.storage.image = str(tmp_path / "img")
    p = LinuxPlatform(cfg)

    def image(boot: bytes) -> None:
        (tmp_path / "img").write_bytes(b"\0" * p.PART_OFFSET + boot.ljust(512, b"\0"))

    ex = bytearray(512)
    ex[3:11] = b"EXFAT   "
    image(bytes(ex))
    assert p.fs_dirty() is False
    ex[106] = 0x02
    image(bytes(ex))
    assert p.fs_dirty() is True
    fat = bytearray(512)
    fat[3:11] = b"mkfs.fat"
    image(bytes(fat))
    assert p.fs_dirty() is False
    fat[0x41] = 1
    image(bytes(fat))
    assert p.fs_dirty() is True
    (tmp_path / "img").unlink()
    assert p.fs_dirty() is True  # unreadable: assume dirty
