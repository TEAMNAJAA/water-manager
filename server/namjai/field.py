import csv
import io
import json
import secrets
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select

from . import analytics as A
from . import community as C
from . import services as S
from .models import Alert, Device, FundEntry, Heartbeat, Meter, Person, Photo, Reading, RepairJob, StepTest, Village, Zone, utcnow

router = APIRouter(prefix="/api")
get_db = C.get_db
iso = C.iso
CLIP_RESOLUTION = 0.001


def find(db, model, key):
    obj = db.get(model, key)
    if obj is None:
        raise HTTPException(404, f"{model.__name__.lower()} not found")
    return obj


class ClipIn(BaseModel):
    resolution: float = Field(CLIP_RESOLUTION, gt=0, le=1)


@router.post("/meters/{mid}/clips", status_code=201)
def connect_clip(mid: int, body: ClipIn | None = None, p: Person = Depends(C.need(*C.STAFF_ROLES)), db=Depends(get_db)):
    m = find(db, Meter, mid)
    C.may_read(p, m)
    token = S.new_token()
    device_id = f"clip-{m.id}-{secrets.token_hex(3)}"
    db.add(Device(id=device_id, meter_id=m.id, token_hash=S.hash_token(token), commands={}))
    m.resolution = (body or ClipIn()).resolution
    db.commit()
    return {"device_id": device_id, "api_key": token, "webhook_path": f"/api/hook/aiedge/{device_id}",
            "namjai_firmware": {"server": "<this server>", "token": token}}


def device_by_key(db, device_id, key):
    d = db.get(Device, device_id)
    if d is None or not key or S.hash_token(key) != d.token_hash:
        raise HTTPException(403, "unknown device or API key")
    return d


def pick(items, name):
    items = [i for i in items if isinstance(i, dict)]
    for want in (name, "main"):
        for i in items:
            if want and i.get("name") == want:
                return i
    return items[0] if items else None


def to_float(v):
    try:
        return float(str(v).strip())
    except (TypeError, ValueError):
        return None


def check_value(db, meter, value, taken):
    prev = S.last_trusted(db, meter.id, taken)
    if prev is None:
        return []
    hours = max((taken - prev.taken_at).total_seconds() / 3600, 1 / 60)
    step = max(S.resolution(meter), 0.001)
    if value < prev.value - step:
        return ["decreased"]
    if value - prev.value > meter.max_flow * hours + step:
        return ["jump_too_large"]
    return []


def add_clip_reading(db, d, meter, value, taken, error, source):
    if db.scalars(select(Reading.id).where(Reading.meter_id == meter.id, Reading.taken_at == taken)).first():
        return None
    issues = [] if error in ("", "no error", None) else [f"device: {str(error)[:60]}"]
    issues += check_value(db, meter, value, taken)
    status = "pending" if issues else "auto"
    r = Reading(meter_id=meter.id, device_id=d.id if d else None, seq=int(taken.replace(tzinfo=UTC).timestamp()) if d else None,
                taken_at=taken, value=None if issues else value, suggested=value, source=source, status=status, issues=issues)
    db.add(r)
    db.flush()
    return r


@router.post("/hook/aiedge/{device_id}")
async def aiedge_post(device_id: str, request: Request, name: str | None = None, apikey: str = Header(""), db=Depends(get_db)):
    d = device_by_key(db, device_id, apikey)
    try:
        payload = json.loads(await request.body() or b"null")
    except ValueError:
        raise HTTPException(400, "invalid JSON")
    item = pick(payload if isinstance(payload, list) else [payload], name)
    if item is None:
        raise HTTPException(400, "no reading in payload")
    now = utcnow()
    ts = int(to_float(item.get("timestampLong")) or 0)
    taken = datetime.fromtimestamp(ts, UTC).replace(tzinfo=None) if ts > 1_000_000_000 else now
    d.last_seen = now
    d.last_status = {"source": "aiedge", "error": item.get("error"), "raw": item.get("rawValue"), "rate": item.get("rate")}
    db.add(Heartbeat(device_id=d.id, at=now, data=d.last_status))
    value = to_float(item.get("value"))
    r = add_clip_reading(db, d, d.meter, value, taken, item.get("error"), "aiedge") if value is not None else None
    db.commit()
    return {"status": "stored" if r else "ignored", "reading": r and {"id": r.id, "status": r.status, "issues": r.issues}}


@router.put("/hook/aiedge/{device_id}")
async def aiedge_put(device_id: str, request: Request, timestamp: int = 0, apikey: str = Header(""), db=Depends(get_db)):
    d = device_by_key(db, device_id, apikey)
    body = await request.body()
    if not body:
        raise HTTPException(400, "no image")
    taken = datetime.fromtimestamp(timestamp, UTC).replace(tzinfo=None) if timestamp > 1_000_000_000 else utcnow()
    if db.scalars(select(Photo.id).where(Photo.device_id == d.id, Photo.seq == timestamp, Photo.light == "w")).first():
        return {"status": "duplicate"}
    ph = Photo(meter_id=d.meter_id, device_id=d.id, seq=timestamp, light="w", taken_at=taken, jpeg=body, ocr={"source": "aiedge"})
    db.add(ph)
    db.flush()
    r = db.scalars(select(Reading).where(Reading.meter_id == d.meter_id, Reading.taken_at == taken)).first()
    if r is not None:
        r.photo_id = ph.id
    db.commit()
    return {"status": "stored", "photo_id": ph.id}


def parse_time(text, tz):
    text = text.strip()
    if text.isdigit():
        return datetime.fromtimestamp(int(text), UTC).replace(tzinfo=None)
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S%z", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            t = datetime.strptime(text, fmt)
        except ValueError:
            continue
        t = t if t.tzinfo else t.replace(tzinfo=ZoneInfo(tz))
        return t.astimezone(UTC).replace(tzinfo=None)
    return None


@router.post("/meters/{mid}/import")
async def import_log(mid: int, files: list[UploadFile] = File(...), name: str | None = Form(None),
                     p: Person = Depends(C.need(*C.STAFF_ROLES)), db=Depends(get_db)):
    m = find(db, Meter, mid)
    C.may_read(p, m)
    v = db.get(Village, m.village_id)
    rows = []
    for f in files:
        text = (await f.read()).decode("utf-8", "replace")
        for row in csv.reader(io.StringIO(text)):
            if len(row) < 4 or (name and row[1].strip() != name):
                continue
            t, value = parse_time(row[0], v.tz), to_float(row[3])
            if t is not None and value is not None:
                rows.append((t, value, row[7].strip() if len(row) > 7 else ""))
    added = skipped = 0
    for t, value, error in sorted(rows):
        r = add_clip_reading(db, None, m, value, t, error, "sd")
        added, skipped = (added + 1, skipped) if r else (added, skipped + 1)
    db.commit()
    return {"rows": len(rows), "added": added, "skipped": skipped}


@router.post("/meters/{mid}/typed", status_code=201)
async def typed_reading(mid: int, value: float = Form(...), taken_at: datetime | None = Form(None), force: bool = Form(False),
                        file: UploadFile | None = File(None), p: Person = Depends(C.need()), db=Depends(get_db)):
    m = find(db, Meter, mid)
    C.may_read(p, m)
    staff = p.role in C.STAFF_ROLES
    jpeg = await file.read() if file else b""
    if not jpeg and not staff:
        raise HTTPException(422, "a photo of the meter is required")
    when = (taken_at.astimezone(UTC).replace(tzinfo=None) if taken_at and taken_at.tzinfo else taken_at) or utcnow()
    when = min(when, utcnow())
    issues = check_value(db, m, value, when)
    if issues and not (force and staff):
        raise HTTPException(409, {"issues": issues})
    photo_id = None
    if jpeg:
        ph = Photo(meter_id=m.id, taken_at=when, jpeg=jpeg, ocr={"typed": value})
        db.add(ph)
        db.flush()
        photo_id = ph.id
    r = Reading(meter_id=m.id, taken_at=when, value=value, suggested=value, source="typed", status="confirmed",
                photo_id=photo_id, issues=issues, confirmed_by=f"person:{p.id}")
    db.add(r)
    db.commit()
    C.award_main_photo(db, r, m)
    return {"id": r.id, "value": r.value, "taken_at": iso(r.taken_at), "status": r.status}


class StepIn(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    zone_id: int | None = None


def step_dict(db, t):
    v = db.get(Village, t.village_id)
    cfg = A.settings(v.settings)
    steps = [{**s, "closed_at": datetime.fromisoformat(s["closed_at"].rstrip("Z")),
              "opened_at": datetime.fromisoformat(s["opened_at"].rstrip("Z")) if s.get("opened_at") else None} for s in t.steps]
    lo = min((s["closed_at"] for s in steps), default=t.created) - timedelta(hours=1)
    res = A.step_test(S.series(db, t.meter_id, lo, utcnow() + timedelta(hours=1)), steps, cfg)
    return {"id": t.id, "village_id": t.village_id, "meter_id": t.meter_id, "created": iso(t.created), "finished": iso(t.finished),
            "note": t.note, **res}


@router.post("/villages/{vid}/step-tests", status_code=201)
def step_start(vid: int, p: Person = Depends(C.need(*C.STAFF_ROLES)), db=Depends(get_db)):
    C.same_village(p, vid)
    main = C.main_meter_of(db, vid)
    if main is None:
        raise HTTPException(409, "village has no main meter")
    t = StepTest(village_id=vid, meter_id=main.id, created_by=p.id, steps=[])
    db.add(t)
    db.commit()
    return step_dict(db, t)


@router.get("/villages/{vid}/step-tests")
def step_list(vid: int, db=Depends(get_db)):
    ts = db.scalars(select(StepTest).where(StepTest.village_id == vid).order_by(StepTest.created.desc()).limit(10)).all()
    return [step_dict(db, t) for t in ts]


@router.get("/step-tests/{tid}")
def step_get(tid: int, db=Depends(get_db)):
    return step_dict(db, find(db, StepTest, tid))


def open_step(t):
    return next((s for s in t.steps if not s.get("opened_at")), None)


@router.post("/step-tests/{tid}/close")
def step_close(tid: int, body: StepIn, p: Person = Depends(C.need(*C.STAFF_ROLES)), db=Depends(get_db)):
    t = find(db, StepTest, tid)
    C.same_village(p, t.village_id)
    if t.finished or open_step(t):
        raise HTTPException(409, "open the closed valve first" if open_step(t) else "test finished")
    t.steps = [*t.steps, {"label": body.label, "zone_id": body.zone_id, "closed_at": iso(utcnow())}]
    db.commit()
    return step_dict(db, t)


@router.post("/step-tests/{tid}/open")
def step_open(tid: int, p: Person = Depends(C.need(*C.STAFF_ROLES)), db=Depends(get_db)):
    t = find(db, StepTest, tid)
    C.same_village(p, t.village_id)
    s = open_step(t)
    if s is None:
        raise HTTPException(409, "no valve is closed")
    t.steps = [{**x, "opened_at": iso(utcnow())} if x is s else x for x in t.steps]
    db.commit()
    return step_dict(db, t)


@router.post("/step-tests/{tid}/finish")
def step_finish(tid: int, p: Person = Depends(C.need(*C.STAFF_ROLES)), db=Depends(get_db)):
    t = find(db, StepTest, tid)
    C.same_village(p, t.village_id)
    if open_step(t):
        raise HTTPException(409, "open the closed valve first")
    t.finished = utcnow()
    db.commit()
    return step_dict(db, t)


PUBLIC_SETTINGS = ("currency", "price_per_m3", "min_charge", "agencies", "lang")


def settings_dict(db, v):
    s = {**C.BILLING, "currency": "THB", "agencies": [], "lang": "en", **(v.settings or {})}
    return {**{k: s.get(k) for k in PUBLIC_SETTINGS}, "zones": [{"id": z.id, "name": z.name} for z in v.zones]}


class Agency(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: str | None = Field(None, max_length=120)
    phone: str | None = Field(None, max_length=30)


class SettingsIn(BaseModel):
    currency: str | None = Field(None, pattern="^[A-Z]{3}$")
    price_per_m3: float | None = Field(None, ge=0)
    min_charge: float | None = Field(None, ge=0)
    agencies: list[Agency] | None = Field(None, max_length=10)
    lang: str | None = Field(None, pattern="^(en|th)$")
    new_zones: list[str] | None = Field(None, max_length=20)


@router.get("/villages/{vid}/settings")
def get_settings(vid: int, db=Depends(get_db)):
    return settings_dict(db, find(db, Village, vid))


@router.put("/villages/{vid}/settings")
def put_settings(vid: int, body: SettingsIn, p: Person = Depends(C.need(*C.STAFF_ROLES)), db=Depends(get_db)):
    C.same_village(p, vid)
    v = find(db, Village, vid)
    changes = body.model_dump(exclude_none=True, exclude={"new_zones"})
    if "agencies" in changes:
        changes["agencies"] = [a for a in changes["agencies"]]
    v.settings = {**(v.settings or {}), **changes}
    for name in body.new_zones or []:
        if name.strip() and name.strip() not in {z.name for z in v.zones}:
            db.add(Zone(village_id=vid, name=name.strip()[:80]))
    db.commit()
    db.refresh(v)
    return settings_dict(db, v)


@router.get("/repairs/{jid}/report")
def repair_report(jid: int, db=Depends(get_db)):
    j = find(db, RepairJob, jid)
    v = db.get(Village, j.village_id)
    main = C.main_meter_of(db, v.id)
    alert = db.get(Alert, j.alert_id) if j.alert_id else None
    nights = []
    if main is not None:
        st = S.leak_state(db, v, main, utcnow(), days=30)
        nights = [{"night_of": n.night_of.isoformat(), "flow": n.flow, "baseline": n.baseline, "high": n.high, "coarse": n.coarse}
                  for n in st.nights if n.flow is not None][-21:]
    zone = db.get(Zone, j.zone_id) if j.zone_id else None
    tech = db.get(Person, j.technician_id) if j.technician_id else None
    costs = db.scalars(select(FundEntry).where(FundEntry.ref == f"job:{j.id}")).all()
    tests = db.scalars(select(StepTest).where(StepTest.village_id == v.id).order_by(StepTest.created.desc()).limit(5)).all()
    step = next((d for d in (step_dict(db, t) for t in tests) if d["suspect"]), None)
    job = C.job_dict(j, {tech.id: tech} if tech else {})
    return {"village": {"id": v.id, "name": v.name, "simulated": v.simulated, "lat": v.lat, "lon": v.lon},
            "settings": settings_dict(db, v), "zone": zone and zone.name, "job": job,
            "alert": alert and {"kind": alert.kind, "level": alert.level, "started": iso(alert.started), "resolved": iso(alert.resolved),
                                "data": alert.data},
            "nights": nights, "step_test": step,
            "costs": [{"amount": -e.amount, "status": e.status, "note": e.note, "created": iso(e.created)} for e in costs],
            "generated": iso(utcnow())}
