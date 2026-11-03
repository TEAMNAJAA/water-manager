from namjai_ocr.validate import check


def test_first_reading_has_no_history():
    assert check(120) == []


def test_decrease_is_rejected():
    assert check(119, prev=120) == ["decreased"]


def test_rollover_is_allowed():
    assert check(3, prev=99998, digits=5) == []


def test_jump_beyond_max_flow():
    assert check(150, prev=120, hours=2, max_flow=3.125) == ["jump_too_large"]
    assert check(125, prev=120, hours=2, max_flow=3.125) == []
