from pathlib import Path

import make_fake_teslacam
from badcam import scanner
from badcam.scanner import StabilityTracker, scan, valid_path


def test_path_grammar():
    ok = [
        "SentryClips/2026-11-20_18-22-10/event.json",
        "SavedClips/2026-11-20_18-22-10/2026-11-20_18-21-00-left_repeater.mp4",
        "RecentClips/2026-11-20_18-21-00-front.mp4",
    ]
    bad = [
        "SentryClips/2026-11-20_18-22-10/sub/x.mp4",
        "SentryClips/2026-11-20/event.json",
        "Other/2026-11-20_18-22-10/event.json",
        "SentryClips/2026-11-20_18-22-10/a b.mp4",
        "../SentryClips/2026-11-20_18-22-10/event.json",
        "RecentClips/" + "a" * 81,
        "RecentClips/x/y.mp4",
    ]
    assert all(valid_path(p) for p in ok)
    assert not any(valid_path(p) for p in bad)


def test_junk_rule():
    assert scanner.is_junk("SentryClips/2026-11-20_18-22-10/x-front.mp4", 99_999)
    assert not scanner.is_junk("SentryClips/2026-11-20_18-22-10/x-front.mp4", 100_000)
    assert not scanner.is_junk("SentryClips/2026-11-20_18-22-10/event.json", 150)  # small non-clips are fine
    assert scanner.is_junk("SentryClips/2026-11-20_18-22-10/event.json", 0)


def test_scan_order_and_filtering(tmp_path):
    make_fake_teslacam.build(tmp_path, 2, 2, "SentryClips", use_ffmpeg=False, junk=True)
    make_fake_teslacam.build(tmp_path, 1, 1, "SavedClips", use_ffmpeg=False, start="2026-11-21_08-00-00")
    (tmp_path / "TeslaCam/SentryClips/2026-11-20_18-00-00/notes weird.txt").write_text("x")
    (tmp_path / "TeslaCam/SentryClips/not-an-event").mkdir()
    (tmp_path / "TeslaCam/RecentClips/2026-11-22_10-00-00-front.mp4").write_bytes(b"x" * 200_000)
    events = scan(tmp_path)
    assert [e.kind for e in events] == ["SavedClips", "SentryClips", "SentryClips"]
    assert [e.name for e in events[1:]] == ["2026-11-20_18-30-00", "2026-11-20_18-00-00"]  # newest first
    order = [f.name for f in events[2].upload_order()]
    assert order[:2] == ["event.json", "thumb.png"]
    assert order[2:] == sorted(order[2:])
    assert all("weird" not in n for n in order)
    assert not any(f.junk for f in events[2].upload_order())
    assert any(f.junk for f in events[2].files)
    with_recent = scan(tmp_path, upload_recent=True)
    assert with_recent[-1].kind == "RecentClips" and with_recent[-1].name == "2026-11-22_10"


def test_stability_rule(tmp_path):
    make_fake_teslacam.build(tmp_path, 1, 1, use_ffmpeg=False)
    tr = StabilityTracker(settle_s=120)
    ev = scan(tmp_path)
    assert tr.update(ev, 1000) == []  # first sight
    assert tr.update(scan(tmp_path), 1060) == []  # unchanged but not long enough
    assert len(tr.update(scan(tmp_path), 1125)) == 1  # unchanged for >= 120 s
    clip = next(Path(tmp_path).rglob("*-front.mp4"))
    with open(clip, "ab") as fh:
        fh.write(b"more")
    assert tr.update(scan(tmp_path), 1200) == []  # changed: clock restarts
    assert len(tr.update(scan(tmp_path), 1330)) == 1


def test_event_without_event_json_is_never_stable(tmp_path):
    make_fake_teslacam.build(tmp_path, 1, 1, use_ffmpeg=False)
    (next(Path(tmp_path).rglob("event.json"))).unlink()
    tr = StabilityTracker(settle_s=0)
    assert tr.update(scan(tmp_path), 1) == []
    assert tr.update(scan(tmp_path), 100) == []
