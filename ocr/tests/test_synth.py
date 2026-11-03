from namjai_ocr.synth import positions


def test_carry_moves_higher_wheels_only_after_nines():
    assert positions(1299, 4, 0.5) == [1, 2.5, 9.5, 9.5]
    assert positions(1234, 4, 0.5) == [1, 2, 3, 4.5]
