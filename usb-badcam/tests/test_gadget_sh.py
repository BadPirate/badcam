"""gadget.sh against a fake configfs tree (no hardware needed)."""
import os
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "system" / "gadget.sh"


@pytest.fixture
def env(tmp_path):
    cfs = tmp_path / "cfs"
    lun = cfs / "usb_gadget" / "badcam" / "functions" / "mass_storage.0" / "lun.0"
    lun.mkdir(parents=True)
    (cfs / "usb_gadget" / "badcam" / "UDC").write_text("")
    (lun / "file").write_text("/old/image\n")
    udc = tmp_path / "udc"
    (udc / "fake.usb").mkdir(parents=True)
    e = dict(os.environ, BADCAM_CONFIGFS=str(cfs), BADCAM_UDC_DIR=str(udc), BADCAM_IMAGE="/x/cam.img")
    return e, cfs / "usb_gadget" / "badcam", lun


def run(e, arg):
    return subprocess.run(["bash", str(SCRIPT), arg], env=e, capture_output=True, text=True)


def test_down_when_already_unbound_is_idempotent(env):
    e, g, lun = env
    assert run(e, "down").returncode == 0
    assert run(e, "down").returncode == 0
    assert (lun / "file").read_text().strip() == ""


def test_down_releases_lun_and_unbinds(env):
    e, g, lun = env
    (g / "UDC").write_text("fake.usb")
    assert run(e, "down").returncode == 0
    assert (g / "UDC").read_text().strip() == ""
    assert (lun / "forced_eject").read_text().strip() == "1"
    assert (lun / "file").read_text().strip() == ""


def test_up_repoints_lun_at_current_image(env):
    e, g, lun = env
    (g / "configs" / "c.1").mkdir(parents=True)
    r = run(e, "up")
    assert r.returncode == 0, r.stderr
    assert (lun / "file").read_text().strip() == "/x/cam.img"
    assert (g / "UDC").read_text().strip() == "fake.usb"
    assert run(e, "down").returncode == 0
    assert run(e, "down").returncode == 0
