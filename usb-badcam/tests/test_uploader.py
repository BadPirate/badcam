import hashlib

import pytest

from badcam.scanner import scan
from badcam.uploader import CycleAbort, Uploader, sha256_file


def run_detached_uploader(env, delete=True, **kw):
    up = Uploader(env.client(env.cfg), env.state, env.cfg.server.chunk_mb * 1024 * 1024, delete=delete, **kw)
    up.run(scan(env.root))
    return up


def test_full_upload_matches_and_completes(env):
    clips = env.build(events=2, minutes=2)
    expected = {str(p.relative_to(env.root / "TeslaCam")): hashlib.sha256(p.read_bytes()).hexdigest() for p in env.root.rglob("*") if p.is_file()}
    run_detached_uploader(env, delete=False)
    assert set(env.mock.index) == set(expected)
    for rel, (size, sha) in env.mock.index.items():
        assert sha == expected[rel]
        assert env.mock.fpath(rel).stat().st_size == size
    assert len(env.mock.completed) == 2
    assert all(c["files"] == 2 + 8 for c in env.mock.completed)


def test_resume_after_connection_drop_mid_chunk(env):
    env.build(events=1, minutes=1)
    env.mock.drop_mid_chunk = 1
    run_detached_uploader(env, delete=False)
    assert len(env.mock.index) == 6
    for rel, (size, sha) in env.mock.index.items():
        assert sha == sha256_file(env.root / "TeslaCam" / rel)  # file intact despite the drop


def test_409_offset_recovery(env):
    env.build(events=1, minutes=1)
    env.mock.force_409 = 3
    run_detached_uploader(env, delete=False)
    assert len(env.mock.index) == 6 and len(env.mock.completed) == 1


def test_422_restarts_then_succeeds(env):
    env.build(events=1, minutes=1)
    env.mock.fail_422 = 2
    run_detached_uploader(env, delete=False)
    assert len(env.mock.index) == 6


def test_422_three_times_gives_up_on_that_file(env):
    env.build(events=1, minutes=1)
    env.mock.fail_422 = 3  # event.json is first: it exhausts its 3 attempts
    up = run_detached_uploader(env, delete=True)
    assert up.stats.errors == 1
    assert not any(r.endswith("event.json") for r in env.mock.index)
    assert len(env.mock.index) == 5
    assert env.mock.completed == []  # event incomplete, so no events/complete
    left = [p.name for p in env.files_left()]
    assert left == ["event.json"]  # failed file stays on the drive, everything else deleted


def test_507_stops_cycle_and_deletes_nothing(env):
    env.build(events=2, minutes=1)
    before = sorted(env.files_left())
    env.mock.storage_full = True
    with pytest.raises(CycleAbort) as ei:
        run_detached_uploader(env, delete=True)
    assert ei.value.backoff_s == 1800
    assert sorted(env.files_left()) == before


def test_401_stops(env):
    env.build(events=1, minutes=1)
    env.mock.unauthorized = True
    before = sorted(env.files_left())
    with pytest.raises(CycleAbort) as ei:
        run_detached_uploader(env, delete=True)
    assert ei.value.backoff_s == 600
    assert sorted(env.files_left()) == before


def test_413_halves_chunk(env):
    env.build(events=1, minutes=1)
    env.mock.max_chunk = 256 * 1024
    run_detached_uploader(env, delete=False)
    assert len(env.mock.index) == 6


def test_already_complete_files_are_not_resent(env):
    env.build(events=1, minutes=1)
    run_detached_uploader(env, delete=False)
    puts = sum(1 for m, _, _ in env.mock.requests if m == "PUT")
    run_detached_uploader(env, delete=False)
    assert sum(1 for m, _, _ in env.mock.requests if m == "PUT") == puts


def test_unknown_state_db_hashes_and_compares(env):
    env.build(events=1, minutes=1)
    run_detached_uploader(env, delete=False)
    env.state.db.execute("DELETE FROM uploaded")
    puts = sum(1 for m, _, _ in env.mock.requests if m == "PUT")
    run_detached_uploader(env, delete=False)
    assert sum(1 for m, _, _ in env.mock.requests if m == "PUT") == puts  # same sha: just recorded
    assert env.state.count() == 6


def test_complete_with_different_sha_is_reuploaded(env):
    env.build(events=1, minutes=1)
    run_detached_uploader(env, delete=False)
    rel = sorted(env.mock.index)[-1]
    env.mock.index[rel] = (env.mock.index[rel][0], "0" * 64)
    env.state.db.execute("DELETE FROM uploaded")
    run_detached_uploader(env, delete=False)
    assert env.mock.index[rel][1] == sha256_file(env.root / "TeslaCam" / rel)
