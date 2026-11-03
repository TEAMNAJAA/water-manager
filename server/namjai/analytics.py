from bisect import bisect_left
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, time, timedelta
from statistics import median
from zoneinfo import ZoneInfo

UTC = ZoneInfo("UTC")

DEFAULTS = {
    "night_start": 1,
    "night_end": 5,
    "baseline_nights": 14,
    "min_history": 5,
    "high_ratio": 1.5,
    "min_excess": 0.2,
    "watch_nights": 2,
    "repair_nights": 3,
    "clear_nights": 2,
    "max_gap_h": 3.0,
    "house_ratio": 1.5,
    "house_min_extra": 0.1,
    "nighttest_moved_m3": 0.02,
}


def settings(village_settings=None):
    return {**DEFAULTS, **(village_settings or {})}


def local(dt, tz):
    return dt.replace(tzinfo=UTC).astimezone(ZoneInfo(tz))


def to_utc(dt_local):
    return dt_local.astimezone(UTC).replace(tzinfo=None)


class Series:
    def __init__(self, points):
        pts = sorted((t, v) for t, v in points if v is not None)
        self.t = [p[0] for p in pts]
        self.v = [p[1] for p in pts]

    def __len__(self):
        return len(self.t)

    def at(self, when, max_gap_h=3.0):
        i = bisect_left(self.t, when)
        if i < len(self.t) and self.t[i] == when:
            return self.v[i]
        if i == 0 or i == len(self.t):
            return None
        t0, t1 = self.t[i - 1], self.t[i]
        gap = (t1 - t0).total_seconds() / 3600
        if gap > max_gap_h:
            return None
        return self.v[i - 1] + (self.v[i] - self.v[i - 1]) * (when - t0).total_seconds() / (t1 - t0).total_seconds()

    def hourly(self, start, end, max_gap_h=3.0):
        out, h = [], start.replace(minute=0, second=0, microsecond=0)
        while h < end:
            a, b = self.at(h, max_gap_h), self.at(h + timedelta(hours=1), max_gap_h)
            out.append({"hour": h, "flow": None if a is None or b is None else round(b - a, 4)})
            h += timedelta(hours=1)
        return out


@dataclass
class Night:
    night_of: date
    flow: float | None
    baseline: float | None = None
    excess: float | None = None
    high: bool = False


def night_flows(series, tz, first, last, cfg):
    out = []
    d = first
    while d <= last:
        nxt = d + timedelta(days=1)
        a = datetime.combine(nxt, time(cfg["night_start"]), ZoneInfo(tz))
        b = datetime.combine(nxt, time(cfg["night_end"]), ZoneInfo(tz))
        va, vb = series.at(to_utc(a), cfg["max_gap_h"]), series.at(to_utc(b), cfg["max_gap_h"])
        hours = (b - a).total_seconds() / 3600
        out.append(Night(d, None if va is None or vb is None else round(max(0.0, (vb - va) / hours), 4)))
        d = nxt
    return out


def resolution_floor(scale, cfg):
    return max(cfg["min_excess"], 2 * scale / (cfg["night_end"] - cfg["night_start"]))


@dataclass
class LeakState:
    level: str = "green"
    streak: int = 0
    started: date | None = None
    excess_m3h: float | None = None
    litres_per_day: float | None = None
    baseline: float | None = None
    learning: bool = False
    nights: list = field(default_factory=list)

    def to_dict(self):
        d = asdict(self)
        d["nights"] = [{**asdict(n), "night_of": n.night_of.isoformat()} for n in self.nights]
        d["started"] = self.started.isoformat() if self.started else None
        return d


def detect_leak(nights, scale, cfg):
    floor = resolution_floor(scale, cfg)
    history, streak, calm, start, excesses = [], 0, 0, None, []
    state = LeakState()
    for n in nights:
        if n.flow is None:
            continue
        base = median(history[-cfg["baseline_nights"]:]) if len(history) >= cfg["min_history"] else None
        n.baseline = base
        if base is None:
            history.append(n.flow)
            continue
        n.excess = round(n.flow - base, 4)
        n.high = n.flow > base * cfg["high_ratio"] and n.excess > floor
        if n.high:
            streak += 1
            calm = 0
            start = start or n.night_of
            excesses.append(n.excess)
        else:
            calm += 1
            history.append(n.flow)
            if calm >= cfg["clear_nights"] or streak < cfg["watch_nights"]:
                streak, start, excesses = 0, None, []
    state.nights = nights
    state.learning = len(history) < cfg["min_history"]
    state.baseline = round(median(history[-cfg["baseline_nights"]:]), 4) if history else None
    state.streak = streak
    if streak >= cfg["repair_nights"]:
        state.level = "red"
    elif streak >= cfg["watch_nights"]:
        state.level = "yellow"
    if streak >= cfg["watch_nights"]:
        state.started = start
        state.excess_m3h = round(median(excesses), 4)
        state.litres_per_day = round(state.excess_m3h * 24 * 1000)
    return state


def consumption(series, start, end):
    total, covered = 0.0, 0.0
    for (t0, v0), (t1, v1) in zip(zip(series.t, series.v), zip(series.t[1:], series.v[1:])):
        lo, hi = max(t0, start), min(t1, end)
        if hi <= lo:
            continue
        frac = (hi - lo) / (t1 - t0)
        total += max(0.0, v1 - v0) * frac
        covered += (hi - lo).total_seconds()
    span = (end - start).total_seconds()
    return total, covered / span if span else 0.0


def water_balance(main, houses, start, end):
    supplied, main_cov = consumption(main, start, end)
    rows, billed, missing = [], 0.0, []
    for hid, s in houses.items():
        used, cov = consumption(s, start, end)
        if cov < 0.5:
            missing.append(hid)
            continue
        est = used / cov
        billed += est
        rows.append({"meter_id": hid, "m3": round(est, 3), "coverage": round(cov, 2)})
    loss = supplied - billed
    return {
        "start": start.isoformat() + "Z",
        "end": end.isoformat() + "Z",
        "supplied_m3": round(supplied, 3),
        "main_coverage": round(main_cov, 2),
        "billed_m3": round(billed, 3),
        "loss_m3": round(loss, 3),
        "loss_pct": round(100 * loss / supplied, 1) if supplied > 0 else None,
        "houses_read": len(rows),
        "houses_missing": missing,
        "houses": rows,
    }


def daily_rates(series):
    out = []
    for (t0, v0), (t1, v1) in zip(zip(series.t, series.v), zip(series.t[1:], series.v[1:])):
        days = (t1 - t0).total_seconds() / 86400
        if days >= 7:
            out.append({"from": t0, "to": t1, "m3_per_day": max(0.0, v1 - v0) / days})
    return out


def house_anomaly(series, cfg):
    rates = daily_rates(series)
    if len(rates) < 3:
        return None
    last, past = rates[-1]["m3_per_day"], median(r["m3_per_day"] for r in rates[:-1][-6:])
    if last > past * cfg["house_ratio"] and last - past > cfg["house_min_extra"]:
        return {"m3_per_day": round(last, 3), "usual_m3_per_day": round(past, 3), "since": rates[-1]["from"].isoformat() + "Z"}
    return None


def night_test(main, houses, cfg, baseline_m3h=None):
    results, start, end = [], None, None
    for hid, s in houses.items():
        if len(s) < 2:
            results.append({"meter_id": hid, "status": "missing"})
            continue
        d = s.v[-1] - s.v[0]
        start = s.t[0] if start is None else min(start, s.t[0])
        end = s.t[-1] if end is None else max(end, s.t[-1])
        results.append({"meter_id": hid, "status": "moved" if d >= cfg["nighttest_moved_m3"] else "still", "m3": round(d, 4),
                        "from": s.t[0].isoformat() + "Z", "to": s.t[-1].isoformat() + "Z"})
    out = {"houses": results, "moved": [r["meter_id"] for r in results if r["status"] == "moved"],
           "main_m3": None, "expected_m3": None, "excess_m3": None, "inside_m3": None, "pipe_m3": None}
    if start and end:
        a, b = main.at(start, 12), main.at(end, 12)
        if a is not None and b is not None:
            hours = (end - start).total_seconds() / 3600
            expected = (baseline_m3h or 0.0) * hours
            inside = sum(r["m3"] for r in results if r["status"] == "moved")
            out.update(main_m3=round(b - a, 3), expected_m3=round(expected, 3), excess_m3=round(b - a - expected, 3),
                       inside_m3=round(inside, 3), pipe_m3=round(b - a - expected - inside, 3))
    verdict = []
    if out["moved"]:
        verdict.append("leak_inside_houses")
    if out["pipe_m3"] is not None and out["excess_m3"] > 0 and out["pipe_m3"] > max(0.1, 0.3 * out["excess_m3"]):
        verdict.append("pipe_leak_likely")
    out["verdict"] = verdict or ["no_leak_seen"]
    return out
