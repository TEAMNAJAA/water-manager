import asyncio
import hmac
import os
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import select

from . import analytics as A
from . import community as C
from . import config, db as D
from . import services as S
from .models import Alert, Device, Meter, Network, NightTest, Person, Photo, Reading, Village, Zone, utcnow


def j(x):
    if isinstance(x, datetime):
        return x.isoformat() + "Z"
    if isinstance(x, date):
        return x.isoformat()
    if isinstance(x, dict):
        return {k: j(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [j(v) for v in x]
    return x


async def evaluator():
    while True:
        await asyncio.sleep(config.EVAL_EVERY_S)
        with D.Session() as db:
            S.evaluate_all(db)


@asynccontextmanager
async def lifespan(app):
    D.init()
    task = None if os.getenv("DISABLE_SCHEDULER") else asyncio.create_task(evaluator())
    yield
    if task:
        task.cancel()


app = FastAPI(title="NamJai", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(C.router)


def get_db():
    with D.Session() as db:
        yield db


def admin(authorization: str = Header("")):
    if authorization != f"Bearer {config.ADMIN_TOKEN}":
        raise HTTPException(401, "admin token required")


def device(authorization: str = Header(""), x_device: str = Header(""), db=Depends(get_db)):
    token = authorization.removeprefix("Bearer ")
    d = db.get(Device, x_device)
    if not d or token == authorization or not hmac.compare_digest(S.hash_token(token), d.token_hash):
        raise HTTPException(401, "unknown device or token")
    return d


def find(db, model, key):
    obj = db.get(model, key)
    if obj is None:
        raise HTTPException(404, f"{model.__name__.lower()} not found")
    return obj


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/api/clip/photo", status_code=201)
async def clip_photo(request: Request, response: Response, x_seq: int = Header(), x_light: str = Header("a"),
                     x_captured_at: int = Header(0), d: Device = Depends(device), db=Depends(get_db)):
    body = await request.body()
    estimated = x_captured_at <= 0
    taken = utcnow() if estimated else datetime.fromtimestamp(x_captured_at, UTC).replace(tzinfo=None)
    if db.scalars(select(Photo.id).where(Photo.device_id == d.id, Photo.seq == x_seq, Photo.light == x_light)).first():
        response.status_code = 409
        return {"duplicate": True}
    r = S.ingest_clip_photo(db, d, body, x_seq, x_light[:1], taken, estimated)
    return j({"reading_id": r.id if r else None, "status": r.status if r else None, "value": r.value if r else None})


@app.post("/api/clip/heartbeat")
def clip_heartbeat(data: dict, d: Device = Depends(device), db=Depends(get_db)):
    return S.heartbeat(db, d, data)


def summary(db, v):
    alerts = S.open_alerts(db, v.id)
    return {"id": v.id, "name": v.name, "simulated": v.simulated, "lat": v.lat, "lon": v.lon, "network_id": v.network_id,
            "level": S.village_level(alerts), "alerts": len(alerts)}


@app.get("/api/villages")
def villages(db=Depends(get_db)):
    return j([summary(db, v) for v in db.scalars(select(Village).order_by(Village.id))])


def alert_dict(a):
    return {"id": a.id, "kind": a.kind, "level": a.level, "started": a.started, "updated": a.updated, "data": a.data}


@app.get("/api/networks/{nid}")
def network(nid: int, db=Depends(get_db)):
    n = find(db, Network, nid)
    vs = db.scalars(select(Village).where(Village.network_id == nid).order_by(Village.id)).all()
    items = []
    for v in vs:
        alerts = S.open_alerts(db, v.id)
        leak = next((a.data for a in alerts if a.kind == "leak"), None)
        items.append({**summary(db, v), "kinds": sorted({a.kind for a in alerts}), "litres_per_day": leak and leak.get("litres_per_day")})
    from .models import Depot
    depots = db.scalars(select(Depot).where(Depot.network_id == nid)).all()
    techs = db.scalars(select(Person).where(Person.role == "technician", Person.network_id == nid)).all()
    return j({"id": n.id, "name": n.name, "lat": n.lat, "lon": n.lon, "villages": items,
              "depots": [{"id": d.id, "name": d.name, "lat": d.lat, "lon": d.lon, "items": d.items} for d in depots],
              "technicians": [{"id": t.id, "name": t.name.split()[0], "lat": t.lat, "lon": t.lon} for t in techs]})


@app.get("/api/villages/{vid}/status")
def status(vid: int, db=Depends(get_db)):
    v = find(db, Village, vid)
    alerts = S.open_alerts(db, vid)
    mains = [m for m in v.meters if m.kind == "main"]
    leak = S.leak_state(db, v, mains[0], utcnow()).to_dict() if mains else None
    if leak:
        leak["nights"] = leak["nights"][-14:]
    devices = db.scalars(select(Device).join(Meter).where(Meter.village_id == vid)).all()
    return j({**summary(db, v), "alerts": [alert_dict(a) for a in alerts], "leak": leak,
              "devices": [{"id": d.id, "meter_id": d.meter_id, "last_seen": d.last_seen, "status": d.last_status} for d in devices],
              "zones": [{"id": z.id, "name": z.name} for z in v.zones],
              "meters": [{"id": m.id, "kind": m.kind, "label": m.label, "zone_id": m.zone_id, "lat": m.lat, "lon": m.lon, "scale": m.scale, "n_digits": m.n_digits} for m in v.meters]})


def main_meter(v, meter_id=None):
    for m in v.meters:
        if (meter_id and m.id == meter_id) or (not meter_id and m.kind == "main"):
            return m
    raise HTTPException(404, "main meter not found")


@app.get("/api/villages/{vid}/hourly")
def hourly(vid: int, days: int = 7, meter_id: int | None = None, db=Depends(get_db)):
    v = find(db, Village, vid)
    m = main_meter(v, meter_id)
    end = utcnow().replace(minute=0, second=0)
    s = S.series(db, m.id, end - timedelta(days=days, hours=4), end)
    return j({"meter_id": m.id, "unit": "m3/h", "points": s.hourly(end - timedelta(days=days), end)})


@app.get("/api/villages/{vid}/nights")
def nights(vid: int, days: int = 30, db=Depends(get_db)):
    v = find(db, Village, vid)
    st = S.leak_state(db, v, main_meter(v), utcnow(), days)
    return j(st.to_dict())


def month_bounds(v, month):
    y, m = map(int, month.split("-"))
    tz = ZoneInfo(v.tz)
    start = datetime(y, m, 1, tzinfo=tz)
    end = datetime(y + (m == 12), m % 12 + 1, 1, tzinfo=tz)
    return A.to_utc(start), A.to_utc(end)


def compute_balance(db, v, start, end):
    houses = {m.id: S.series(db, m.id, start - timedelta(days=62), end + timedelta(days=62)) for m in v.meters if m.kind == "house"}
    out = A.water_balance(S.series(db, main_meter(v).id, start - timedelta(days=2), end + timedelta(days=2)), houses, start, end)
    out["complete"] = bool(houses) and out["houses_read"] >= 0.8 * len(houses) and out["main_coverage"] >= 0.8
    zone_of = {m.id: m.zone_id for m in v.meters}
    zones = {}
    for h in out["houses"]:
        zones[zone_of[h["meter_id"]]] = zones.get(zone_of[h["meter_id"]], 0.0) + h["m3"]
    out["zones"] = [{"zone_id": z, "m3": round(m3, 3)} for z, m3 in zones.items()]
    return out


@app.get("/api/villages/{vid}/balance")
def balance(vid: int, month: str | None = None, start: datetime | None = None, end: datetime | None = None, db=Depends(get_db)):
    v = find(db, Village, vid)
    if month:
        start, end = month_bounds(v, month)
    if start and end:
        return j({"month": month, **compute_balance(db, v, start.replace(tzinfo=None), end.replace(tzinfo=None))})
    now = A.local(utcnow(), v.tz)
    y, m = now.year, now.month
    first = None
    for _ in range(6):
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
        label = f"{y}-{m:02d}"
        out = compute_balance(db, v, *month_bounds(v, label))
        first = first or (label, out)
        if out["complete"]:
            return j({"month": label, **out})
    return j({"month": first[0], **first[1]})


@app.get("/api/villages/{vid}/alerts")
def alerts(vid: int, include_resolved: bool = False, db=Depends(get_db)):
    q = select(Alert).where(Alert.village_id == vid)
    if not include_resolved:
        q = q.where(Alert.resolved.is_(None))
    return j([{**alert_dict(a), "resolved": a.resolved} for a in db.scalars(q.order_by(Alert.started.desc()))])


class NightTestIn(BaseModel):
    zone_id: int | None = None
    night_of: date


@app.post("/api/villages/{vid}/night-tests", status_code=201)
def create_night_test(vid: int, body: NightTestIn, db=Depends(get_db)):
    find(db, Village, vid)
    t = NightTest(village_id=vid, zone_id=body.zone_id, night_of=body.night_of.isoformat())
    db.add(t)
    db.commit()
    return {"id": t.id}


@app.get("/api/villages/{vid}/night-tests")
def night_tests(vid: int, db=Depends(get_db)):
    ts = db.scalars(select(NightTest).where(NightTest.village_id == vid).order_by(NightTest.created.desc()).limit(10)).all()
    return j([{"id": t.id, "zone_id": t.zone_id, "night_of": t.night_of} for t in ts])


@app.get("/api/night-tests/{tid}")
def night_test(tid: int, db=Depends(get_db)):
    t = find(db, NightTest, tid)
    v = db.get(Village, t.village_id)
    tz = ZoneInfo(v.tz)
    d = date.fromisoformat(t.night_of)
    lo = A.to_utc(datetime.combine(d, time(17), tz))
    hi = A.to_utc(datetime.combine(d + timedelta(days=1), time(11), tz))
    houses = {m.id: S.series(db, m.id, lo, hi) for m in v.meters if m.kind == "house" and (t.zone_id is None or m.zone_id == t.zone_id)}
    main = main_meter(v)
    base = S.leak_state(db, v, main, lo).baseline
    out = A.night_test(S.series(db, main.id, lo - timedelta(hours=3), hi + timedelta(hours=3)), houses, A.settings(v.settings), base)
    return j({"id": t.id, "zone_id": t.zone_id, "night_of": t.night_of, "baseline_m3h": base, **out})


def reading_dict(r):
    return {"id": r.id, "meter_id": r.meter_id, "taken_at": r.taken_at, "value": r.value, "suggested": r.suggested,
            "confidence": r.confidence, "source": r.source, "status": r.status, "issues": r.issues,
            "photo": f"/api/photos/{r.photo_id}.jpg" if r.photo_id else None}


@app.get("/api/meters/{mid}/readings")
def meter_readings(mid: int, limit: int = 50, db=Depends(get_db)):
    find(db, Meter, mid)
    rs = db.scalars(select(Reading).where(Reading.meter_id == mid).order_by(Reading.taken_at.desc()).limit(limit))
    return j([reading_dict(r) for r in rs])


def may_read(p, m, db):
    if p.role in ("caretaker", "committee", "admin"):
        if p.role != "admin" and p.village_id != m.village_id:
            raise HTTPException(403, "other village")
        return
    if m.kind == "main" and p.village_id == m.village_id:
        return
    if p.meter_id != m.id:
        raise HTTPException(403, "you can only read your own meter")


@app.post("/api/meters/{mid}/photo", status_code=201)
async def meter_photo(mid: int, file: UploadFile = File(...), taken_at: datetime | None = None, roi: str | None = None,
                      p: Person = Depends(C.need()), db=Depends(get_db)):
    m = find(db, Meter, mid)
    may_read(p, m, db)
    when = taken_at.replace(tzinfo=None) if taken_at else utcnow()
    guide = [float(v) for v in roi.split(",")] if roi else None
    try:
        r, result = S.ingest_phone_photo(db, m, await file.read(), when, f"person:{p.id}", guide)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return j({**reading_dict(r), "quality": result.quality, "cells": result.cells, "digits": result.digits,
              "alternative": round(result.alternative * m.scale, 4) if result.alternative is not None else None})


class ValueIn(BaseModel):
    value: float
    taken_at: datetime | None = None
    source: str = "manual"
    by: str | None = None
    force: bool = False


@app.post("/api/meters/{mid}/readings", status_code=201)
def add_reading(mid: int, body: ValueIn, p: Person = Depends(C.need("caretaker", "committee", "admin")), db=Depends(get_db)):
    m = find(db, Meter, mid)
    may_read(p, m, db)
    when = body.taken_at.replace(tzinfo=None) if body.taken_at else utcnow()
    r, issues = S.add_value(db, m, body.value, when, body.source, f"person:{p.id}", body.force)
    if r is None:
        raise HTTPException(409, {"issues": issues})
    return j(reading_dict(r))


class ConfirmIn(BaseModel):
    value: float
    force: bool = False


@app.post("/api/readings/{rid}/confirm")
def confirm_reading(rid: int, body: ConfirmIn, p: Person = Depends(C.need()), db=Depends(get_db)):
    r = find(db, Reading, rid)
    m = db.get(Meter, r.meter_id)
    staff = p.role in ("caretaker", "committee", "admin")
    if not staff and r.confirmed_by != f"person:{p.id}":
        raise HTTPException(403, "only the person who took the photo or a caretaker can confirm")
    if staff:
        may_read(p, m, db)
    by = r.confirmed_by if (r.confirmed_by or "").startswith("person:") else f"person:{p.id}"
    issues = S.confirm(db, r, body.value, by, body.force and staff)
    if issues:
        raise HTTPException(409, {"issues": issues})
    C.award_main_photo(db, r, m)
    return j(reading_dict(r))


@app.get("/api/readings/pending")
def pending(village_id: int, limit: int = 50, db=Depends(get_db)):
    rs = db.scalars(select(Reading).join(Meter).where(Meter.village_id == village_id, Reading.status == "pending")
                    .order_by(Reading.taken_at.desc()).limit(limit))
    return j([reading_dict(r) for r in rs])


@app.get("/api/photos/{pid}.jpg")
def photo(pid: int, db=Depends(get_db)):
    return Response(find(db, Photo, pid).jpeg, media_type="image/jpeg")


class NetworkIn(BaseModel):
    name: str
    lat: float | None = None
    lon: float | None = None


class VillageIn(BaseModel):
    name: str
    network_id: int | None = None
    tz: str = "Asia/Bangkok"
    lat: float | None = None
    lon: float | None = None
    simulated: bool = False
    settings: dict = {}


class ZoneIn(BaseModel):
    village_id: int
    name: str


class MeterIn(BaseModel):
    village_id: int
    kind: str
    label: str
    zone_id: int | None = None
    n_digits: int = 5
    scale: float = 1.0
    max_flow: float = 3.125
    roi: list[float] | None = None
    lat: float | None = None
    lon: float | None = None


class DeviceIn(BaseModel):
    id: str
    meter_id: int


def create(db, obj):
    db.add(obj)
    db.commit()
    return {"id": obj.id}


@app.post("/api/admin/villages", status_code=201, dependencies=[Depends(admin)])
def admin_village(body: VillageIn, db=Depends(get_db)):
    return create(db, Village(**body.model_dump()))


@app.post("/api/admin/networks", status_code=201, dependencies=[Depends(admin)])
def admin_network(body: NetworkIn, db=Depends(get_db)):
    return create(db, Network(**body.model_dump()))


@app.post("/api/admin/zones", status_code=201, dependencies=[Depends(admin)])
def admin_zone(body: ZoneIn, db=Depends(get_db)):
    return create(db, Zone(**body.model_dump()))


@app.post("/api/admin/meters", status_code=201, dependencies=[Depends(admin)])
def admin_meter(body: MeterIn, db=Depends(get_db)):
    return create(db, Meter(**body.model_dump()))


@app.patch("/api/admin/meters/{mid}", dependencies=[Depends(admin)])
def admin_meter_update(mid: int, body: dict, db=Depends(get_db)):
    m = find(db, Meter, mid)
    for k in ("label", "zone_id", "n_digits", "scale", "max_flow", "roi", "lat", "lon"):
        if k in body:
            setattr(m, k, body[k])
    db.commit()
    return {"id": m.id}


@app.post("/api/admin/devices", status_code=201, dependencies=[Depends(admin)])
def admin_device(body: DeviceIn, db=Depends(get_db)):
    find(db, Meter, body.meter_id)
    token = S.new_token()
    db.add(Device(id=body.id, meter_id=body.meter_id, token_hash=S.hash_token(token), commands={}))
    db.commit()
    return {"id": body.id, "token": token}


@app.patch("/api/admin/devices/{did}", dependencies=[Depends(admin)])
def admin_device_update(did: str, body: dict, db=Depends(get_db)):
    d = find(db, Device, did)
    d.commands = {**(d.commands or {}), **{k: body[k] for k in ("interval", "led", "capture_now") if k in body}}
    db.commit()
    return {"id": d.id, "commands": d.commands}


@app.post("/api/admin/evaluate", dependencies=[Depends(admin)])
def admin_evaluate(db=Depends(get_db)):
    S.evaluate_all(db)
    return {"ok": True}
