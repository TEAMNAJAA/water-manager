import numpy as np

from namjai_ocr import synth as S
from namjai_ocr.model import MLP
from namjai_ocr.quality import assess
from namjai_ocr.reader import model, read_counter, read_dial


def test_reads_clear_counter(fonts):
    rng = np.random.default_rng(0)
    hits = 0
    for _ in range(20):
        img, box, value, n = S.sample_counter(rng, fonts, "clear", False, 5)
        r = read_counter(img, n, roi=box)
        hits += abs(r.value - value) <= 1
    assert hits >= 17


def test_auto_accept_needs_history(fonts):
    rng = np.random.default_rng(1)
    img, box, value, n = S.sample_counter(rng, fonts, "clear", False, 5)
    assert not read_counter(img, n, roi=box).auto_ok
    assert "decreased" in read_counter(img, n, roi=box, prev=value + 50).issues


def test_quality_gate_flags_spoiled(fonts):
    rng = np.random.default_rng(2)
    img, *_ = S.sample_counter(rng, fonts, "clear", True, 5)
    assert assess(S.spoil(img, "dark", rng))["issues"] == ["too_dark"]
    assert "blurry" in assess(S.spoil(img, "blur", rng))["issues"]


def test_reads_needle():
    rng = np.random.default_rng(3)
    for v in (0.4, 3.0, 7.7):
        assert abs(read_dial(S.dial(v, rng, 150))["value"] - v) < 0.3


def test_model_roundtrip(tmp_path):
    m = model()
    m.save(tmp_path / "m.json")
    x = np.random.default_rng(4).random((3, m.mean.size), dtype=np.float32)
    assert np.allclose(MLP.load(tmp_path / "m.json").proba(x), m.proba(x), atol=1e-6)
