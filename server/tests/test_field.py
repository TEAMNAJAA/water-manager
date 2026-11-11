import time as clock
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from namjai import analytics as A
from namjai import community as C
from namjai import services as S
from namjai.models import Alert, Meter, Reading, RepairJob, Village
from namjai.sim import seed_demo

from conftest import ADMIN, person

TZ = ZoneInfo("Asia/Bangkok")
CFG = A.settings()


def utc(local):
    return local.replace(tzinfo=TZ).astimezone(ZoneInfo("UTC")).replace(tzinfo=None)


def home_flow(t_local, leak_nights=(), leak=0.06):
    h = t_local.hour
    f = 0.05 if 7 <= h < 22 else 0.0
    for d in leak_nights:
        if datetime.combine(d, datetime.min.time()) + timedelta(hours=23) <= t_local < datetime.combine(d, datetime.min.time()) + timedelta(hours=29):
            f += leak
    return f


def build(start_local, end_local, step, flow):
    pts, v, t = [], 100.0, start_local
    while t <= end_local:
        pts.append((utc(t), round(v, 4)))
        v += flow(t) * step.total_seconds() / 3600
        t += step
    return pts


def test_coarse_night_from_bedtime_and_wake_readings():
    pts = []
    for k in range(6):
        d = datetime(2026, 11, 1) + timedelta(days=k)
        pts += [(utc(d.replace(hour=22)), 100 + k), (utc((d + timedelta(days=1)).replace(hour=6)), 100.4 + k)]
    nights = A.night_flows(A.Series(pts), "Asia/Bangkok", date(2026, 11, 1), date(2026, 11, 5), CFG)
    assert all(n.coarse for n in nights) and all(abs(n.flow - 0.05) < 1e-6 for n in nights)


def test_burst_and_no_flow():
    start, end = datetime(2026, 11, 1, 0), datetime(2026, 11, 9, 12)

    def village(t, burst_from=None, dry_from=None):
        f = 1.0 if 7 <= t.hour < 22 else 0.2
        if burst_from and t >= burst_from:
            f += 3.0
        if dry_from and t >= dry_from:
            f = 0.0
        return f

    step = timedelta(minutes=30)
    normal = A.Series(build(start, end, step, village))
    now = utc(end)
    assert A.burst(normal, now, 0.001, CFG) is None and A.no_flow(normal, now, 0.001, "Asia/Bangkok", CFG) is None
    b = A.burst(A.Series(build(start, end, step, lambda t: village(t, burst_from=end - timedelta(hours=2, minutes=30)))), now, 0.001, CFG)
    assert b and b["litres_per_hour"] == 3000 and b["people_per_day"] == 1440
    dry = A.Series(build(start, end, step, lambda t: village(t, dry_from=end - timedelta(hours=3))))
    assert A.no_flow(dry, now, 0.001, "Asia/Bangkok", CFG)["usual_m3h"] == 1.0
    night_end = datetime(2026, 11, 9, 3)
    assert A.no_flow(A.Series(build(start, night_end, step, lambda t: 0.0)), utc(night_end), 0.001, "Asia/Bangkok", CFG) is None


def test_step_test_finds_the_soi():
    base = datetime(2026, 11, 10, 22)
    closed = {"Soi 1": (base + timedelta(minutes=20), 0.05), "Soi 2": (base + timedelta(minutes=50), 0.4), "Soi 3": (base + timedelta(minutes=80), 0.03)}

    def flow(t):
        for c, drop in closed.values():
            if c <= t < c + timedelta(minutes=15):
                return 0.5 - drop
        return 0.5

    s = A.Series(build(base - timedelta(hours=1), base + timedelta(hours=2), timedelta(minutes=5), flow))
    steps = [{"label": k, "zone_id": None, "closed_at": utc(c), "opened_at": utc(c + timedelta(minutes=15))} for k, (c, _) in closed.items()]
    r = A.step_test(s, steps, CFG)
    assert r["suspect"]["label"] == "Soi 2" and abs(r["litres_per_day"] - 9600) < 600
    assert [x["state"] for x in r["steps"]] == ["done"] * 3


def home_village(session):
    v = Village(name="Home test", tz="Asia/Bangkok", settings={})
    session.add(v)
    session.flush()
    m = Meter(village_id=v.id, kind="main", label="Home meter", n_digits=5, scale=1.0, resolution=0.001, max_flow=3.0)
    session.add(m)
    session.flush()
    return v, m


def add(session, m, pts):
    for t, val in pts:
        session.add(Reading(meter_id=m.id, taken_at=t, value=val, suggested=val, source="aiedge", status="auto"))
    session.commit()


@pytest.mark.parametrize("fixed", [True, False])
def test_playbook_leak_test_and_proof_of_repair(session, fixed):
    v, m = home_village(session)
    leak = [date(2026, 11, 4), date(2026, 11, 5), date(2026, 11, 6)] + ([] if fixed else [date(2026, 11, 7), date(2026, 11, 8)])
    add(session, m, build(datetime(2026, 10, 31, 12), datetime(2026, 11, 9, 9), timedelta(minutes=5), lambda t: home_flow(t, leak)))
    S.evaluate(session, v, utc(datetime(2026, 11, 6, 9)))
    assert S.village_level(S.open_alerts(session, v.id)) == "yellow"
    now1 = utc(datetime(2026, 11, 7, 9))
    S.evaluate(session, v, now1)
    alert = next(a for a in S.open_alerts(session, v.id) if a.kind == "leak")
    assert alert.level == "red" and alert.data["started"] == "2026-11-04"
    assert abs(alert.data["litres_per_day"] - 1440) < 80 and alert.data["people_per_day"] in (28, 29, 30)
    job = session.query(RepairJob).filter_by(village_id=v.id, kind="leak_detected").one()
    assert C.start_proof(session, job, now1) and job.status == "checking"
    session.commit()
    S.evaluate(session, v, utc(datetime(2026, 11, 8, 9)))
    assert job.status == "checking" and job.proof["nights_ok" if fixed else "nights_seen"] == 1
    S.evaluate(session, v, utc(datetime(2026, 11, 9, 9)))
    if fixed:
        assert job.status == "done" and job.proof["state"] == "confirmed"
        assert abs(job.proof["litres_stopped_per_day"] - 1440) < 80 and job.proof["people_per_day"] >= 28
        assert not [a for a in S.open_alerts(session, v.id) if a.kind == "leak"]
    else:
        assert job.status == "fixing" and job.proof["state"] == "not_fixed"


def staff_setup(client):
    vid = client.post("/api/admin/villages", json={"name": "Field"}, headers=ADMIN).json()["id"]
    mid = client.post("/api/admin/meters", json={"village_id": vid, "kind": "main", "label": "Main", "max_flow": 3}, headers=ADMIN).json()["id"]
    return vid, mid, person(client, vid)


def item(ts, value, error="no error"):
    return {"timestamp": "2026-11-10T22:00:00+0700", "timestampLong": ts, "name": "main", "rawValue": value, "value": value,
            "preValue": value, "rate": "0.0", "changeAbsolute": "0.0", "error": error}


def test_aiedge_webhook(client):
    vid, mid, staff = staff_setup(client)
    assert client.post(f"/api/meters/{mid}/clips").status_code == 401
    clip = client.post(f"/api/meters/{mid}/clips", headers=staff).json()
    url, key = clip["webhook_path"], {"APIKEY": clip["api_key"]}
    ts = int(clock.time()) - 3600
    assert client.post(url, json=[item(ts, "345.42648")], headers={"APIKEY": "wrong"}).status_code == 403
    first = client.post(url, json=[item(ts, "345.42648"), {**item(ts, "7"), "name": "other"}], headers=key).json()
    assert first["status"] == "stored" and first["reading"]["status"] == "auto"
    assert client.post(url, json=[item(ts, "345.42648")], headers=key).json()["status"] == "ignored"
    assert client.post(url, json=[item(ts + 300, "345.43")], headers=key).json()["reading"]["status"] == "auto"
    bad = client.post(url, json=[item(ts + 600, "345.44", "Rate too high")], headers=key).json()["reading"]
    assert bad["status"] == "pending" and bad["issues"][0].startswith("device")
    assert client.post(url, json=[item(ts + 900, "340.0")], headers=key).json()["reading"]["issues"] == ["decreased"]
    assert client.post(url, json=[item(ts + 1200, "")], headers=key).json()["status"] == "ignored"
    assert client.put(f"{url}?timestamp={ts + 600}", content=b"\xff\xd8jpeg", headers=key).json()["status"] == "stored"
    rows = client.get(f"/api/meters/{mid}/readings").json()
    assert len(rows) == 4 and next(r for r in rows if r["suggested"] == 345.44)["photo"]
    status = client.get(f"/api/villages/{vid}/status").json()
    assert status["meters"][0]["resolution"] == 0.001 and status["devices"][0]["last_seen"]


def test_sd_import_and_typed_readings(client):
    vid, mid, staff = staff_setup(client)
    csv = "\n".join(f"2026-11-10T{h:02d}:00:00+0700,main,{100 + h / 10:.3f},{100 + h / 10:.3f},0,0,0,no error,," for h in range(6))
    files = {"files": ("data_2026-11-10.csv", csv, "text/csv")}
    assert client.post(f"/api/meters/{mid}/import", files=files, headers=staff).json() == {"rows": 6, "added": 6, "skipped": 0}
    assert client.post(f"/api/meters/{mid}/import", files=files, headers=staff).json()["skipped"] == 6
    house = client.post("/api/admin/meters", json={"village_id": vid, "kind": "house", "label": "H1"}, headers=ADMIN).json()["id"]
    me = person(client, vid, "resident", house)
    jpeg = ("m.jpg", b"\xff\xd8jpeg", "image/jpeg")
    assert client.post(f"/api/meters/{house}/typed", data={"value": "120"}, headers=me).status_code == 422
    ok = client.post(f"/api/meters/{house}/typed", data={"value": "120.5", "taken_at": "2026-11-10T22:00:00+07:00"}, files={"file": jpeg}, headers=me)
    assert ok.status_code == 201 and ok.json()["taken_at"] == "2026-11-10T15:00:00Z"
    low = client.post(f"/api/meters/{house}/typed", data={"value": "100"}, files={"file": jpeg}, headers=me)
    assert low.status_code == 409 and low.json()["detail"]["issues"] == ["decreased"]


def test_settings_and_step_test_api(client):
    vid, mid, staff = staff_setup(client)
    body = {"currency": "KES", "price_per_m3": 120, "agencies": [{"name": "County water office", "email": "water@example.org"}],
            "new_zones": ["Lane A", "Lane B"]}
    assert client.put(f"/api/villages/{vid}/settings", json=body, headers=person(client, vid, "resident")).status_code == 403
    s = client.put(f"/api/villages/{vid}/settings", json=body, headers=staff).json()
    assert s["currency"] == "KES" and s["agencies"][0]["name"] == "County water office" and [z["name"] for z in s["zones"]] == ["Lane A", "Lane B"]
    assert client.put(f"/api/villages/{vid}/settings", json={"currency": "baht"}, headers=staff).status_code == 422
    t = client.post(f"/api/villages/{vid}/step-tests", headers=staff).json()
    closed = client.post(f"/api/step-tests/{t['id']}/close", json={"label": "Lane A", "zone_id": s["zones"][0]["id"]}, headers=staff)
    assert closed.json()["steps"][0]["state"] == "closed"
    assert client.post(f"/api/step-tests/{t['id']}/close", json={"label": "Lane B"}, headers=staff).status_code == 409
    assert client.post(f"/api/step-tests/{t['id']}/finish", headers=staff).status_code == 409
    client.post(f"/api/step-tests/{t['id']}/open", headers=staff)
    done = client.post(f"/api/step-tests/{t['id']}/finish", headers=staff).json()
    assert done["finished"] and done["steps"][0]["state"] == "no_data" and done["suspect"] is None


def test_report_and_checking_status(client, session):
    vs = seed_demo(session, days=100, houses=20, now=datetime(2026, 11, 3, 6))
    b = next(v for v in vs if v.name == "Village B")
    job = client.get(f"/api/villages/{b.id}/repairs").json()[0]
    rep = client.get(f"/api/repairs/{job['id']}/report").json()
    assert rep["job"]["people_per_day"] > 0 and rep["alert"]["kind"] == "leak" and any(n["high"] for n in rep["nights"])
    assert rep["village"]["simulated"] and rep["settings"]["currency"] == "THB"
    tech = client.post("/api/demo/login", json={"village_id": b.id, "role": "technician"}).json()["token"]
    done = client.patch(f"/api/repairs/{job['id']}", json={"status": "done", "verified": True}, headers={"Authorization": f"Bearer {tech}"}).json()
    assert done["status"] == "checking" and done["proof"]["state"] == "waiting"
