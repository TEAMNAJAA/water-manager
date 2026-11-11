import math
from datetime import date, datetime, timedelta

from namjai import analytics as A

CFG = A.settings()
START = datetime(2026, 9, 30, 17)


def main_series(nights_flow, scale=0.1, day_flow=2.0):
    pts, v, t = [], 1000.0, START
    for d, nf in enumerate(nights_flow):
        for h in range(24):
            local_h = (t.hour + 7) % 24
            v += nf if CFG["night_start"] <= local_h < CFG["night_end"] else day_flow
            t += timedelta(hours=1)
            pts.append((t, math.floor(v / scale) * scale))
    return A.Series(pts)


def state(flows, scale=0.1):
    s = main_series(flows, scale)
    return A.detect_leak(A.night_flows(s, "Asia/Bangkok", date(2026, 10, 1), date(2026, 10, len(flows) - 1), CFG), scale, CFG)


def test_normal_nights_stay_green():
    assert state([0.15] * 20).level == "green"


def test_single_high_night_is_ignored():
    assert state([0.15] * 15 + [1.0] + [0.15] * 3).level == "green"


def test_two_then_three_high_nights():
    assert state([0.15] * 15 + [0.8] * 2 + [0.15]).level == "yellow"
    st = state([0.15] * 15 + [0.8] * 3 + [0.15])
    assert st.level == "red"
    assert st.started == date(2026, 10, 15)
    assert abs(st.excess_m3h - 0.65) < 0.06


def test_repair_clears_after_calm_nights():
    assert state([0.15] * 15 + [0.8] * 4 + [0.15] * 3).level == "green"


def test_coarse_meter_does_not_false_alarm():
    assert state([0.3] * 25, scale=1.0).level == "green"


def test_learning_without_history():
    assert state([0.15] * 3).learning
    assert not state([0.15] * 4).learning


def test_water_balance():
    t0, t1 = datetime(2026, 10, 1), datetime(2026, 11, 1)
    main = A.Series([(t0, 1000.0), (t1, 1100.0)])
    houses = {1: A.Series([(t0, 10.0), (t1, 50.0)]), 2: A.Series([(t0, 5.0), (t1, 35.0)]), 3: A.Series([(t1, 9.0)])}
    b = A.water_balance(main, houses, t0, t1)
    assert (b["supplied_m3"], b["billed_m3"], b["loss_m3"], b["loss_pct"]) == (100.0, 70.0, 30.0, 30.0)
    assert b["houses_missing"] == [3]


def test_house_anomaly():
    t = datetime(2026, 6, 1)
    pts = [(t + timedelta(days=30 * i), 10.0 * i) for i in range(5)] + [(t + timedelta(days=150), 40.0 + 25.0)]
    hit = A.house_anomaly(A.Series(pts), CFG)
    assert hit and hit["m3_per_day"] > hit["usual_m3_per_day"]
    assert A.house_anomaly(A.Series(pts[:-1]), CFG) is None


def test_night_test_finds_house_and_pipe():
    ev, mo = datetime(2026, 10, 10, 14), datetime(2026, 10, 10, 23)
    main = A.Series([(ev - timedelta(hours=1), 0.0), (mo + timedelta(hours=1), 11.0)])
    houses = {1: A.Series([(ev, 5.0), (mo, 5.001)]), 2: A.Series([(ev, 7.0), (mo, 7.5)]), 3: A.Series([(ev, 1.0)])}
    r = A.night_test(main, houses, CFG, baseline_m3h=0.2)
    assert r["moved"] == [2]
    assert [h["status"] for h in r["houses"]] == ["still", "moved", "missing"]
    assert set(r["verdict"]) == {"leak_inside_houses", "pipe_leak_likely"}
