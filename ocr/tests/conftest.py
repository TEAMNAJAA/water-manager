import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from namjai_ocr import synth as S


@pytest.fixture
def fonts():
    f = S.fonts(S.TRAIN_FONTS)
    if not f:
        pytest.skip("no fonts installed")
    return f
