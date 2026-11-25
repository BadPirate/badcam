import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

import make_fake_teslacam  # noqa: E402
import mock_server  # noqa: E402
from badcam.config import Config, WifiCfg  # noqa: E402
from badcam.daemon import Daemon  # noqa: E402
from badcam.platform import FakePlatform  # noqa: E402
from badcam.power import FakePower  # noqa: E402
from badcam.state import State  # noqa: E402
from badcam.uploader import ApiClient  # noqa: E402

TOKEN = "bc_" + "A" * 43


class Env:
    def __init__(self, tmp: Path) -> None:
        self.tmp = tmp
        self.root = tmp / "mount"
        self.srv, self.mock, self.url = mock_server.start_background(tmp / "server")
        self.cfg = Config()
        self.cfg.server.url = self.url
        self.cfg.server.token = TOKEN
        self.cfg.server.chunk_mb = 1
        self.cfg.wifi = [WifiCfg(ssid="HomeNet", psk="secretsecret"), WifiCfg(ssid="Guest", psk="secretsecret", upload=False)]
        self.cfg.storage.settle_s = 0
        self.cfg.power.wifi_wait_s = 4
        self.p = FakePlatform(self.root)
        self.power = FakePower(car=False)
        self.state = State(tmp / "state.db")
        self.daemon = Daemon(self.cfg, self.p, self.power, self.state, client_factory=self.client)

    def client(self, cfg: Config) -> ApiClient:
        return ApiClient(cfg.server.url, cfg.server.token, timeout=5, sleep=lambda s: None)

    def build(self, events: int = 2, minutes: int = 1, kind: str = "SentryClips", **kw) -> list[Path]:
        return make_fake_teslacam.build(self.root, events, minutes, kind, use_ffmpeg=False, **kw)

    def files_left(self) -> list[Path]:
        return [p for p in (self.root / "TeslaCam").rglob("*") if p.is_file()]

    def close(self) -> None:
        self.srv.shutdown()
        self.state.close()


@pytest.fixture
def env(tmp_path):
    e = Env(tmp_path)
    yield e
    e.close()
