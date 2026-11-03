import hashlib
import hmac
import math
import os
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, File, Header, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from . import config
from . import db as D
from .models import (Alert, Bill, Depot, FundEntry, Meter, Person, PointEntry, Reading, RepairJob, ThankYou, Village,
                     utcnow)

SECRET = os.getenv("SECRET_KEY") or hashlib.sha256(f"namjai:{config.ADMIN_TOKEN}".encode()).hexdigest()
STAFF = ("caretaker", "committee", "admin")
WALLETS = {
    "repair": {"income": {"water_fee", "local_budget"}, "expense": {"repair_cost", "parts", "operations"}},
    "network": {"income": {"contribution", "district"}, "expense": {"repair_cost", "parts"}},
    "rewards": {"income": {"sponsor"}, "expense": {"reward_cost"}},
    "namjai": {"income": {"donation"}, "expense": {"namjai_bill"}},
}
BILLING = {"price_per_m3": 10.0, "min_charge": 30.0, "due_days": 15, "approvals": 2}
POINTS = {"main_photo": 5, "on_time": 10, "verified_report": 50, "saving": 5}
REWARDS = [
    {"id": "guardian_board", "points": 0, "en": "Name on the monthly Water Guardian board", "th": "ชื่อบนบอร์ดผู้พิทักษ์น้ำประจำเดือน"},
    {"id": "volunteer_hours", "points": 50, "en": "Volunteer hours certificate", "th": "ใบรับรองชั่วโมงจิตอาสา"},
    {"id": "tambon_certificate", "points": 100, "en": "Certificate from the Tambon office", "th": "ใบประกาศจาก อบต."},
    {"id": "shop_discount", "points": 80, "en": "Local shop discount (when a sponsor joins)", "th": "ส่วนลดร้านค้า (เมื่อมีสปอนเซอร์)"},
]
TITLES = [(2000, "Namjai Guardian"), (500, "Namjai Hero"), (1, "Namjai Friend")]
REPAIR_KINDS = {"no_water", "leak", "wet_ground", "broken_tap", "low_pressure", "other", "leak_detected"}
REPAIR_STATUS = ("open", "assigned", "fixing", "done", "cancelled")

router = APIRouter(prefix="/api")


def get_db():
    with D.Session() as db:
        yield db


def cfg(village):
    return {**BILLING, **(village.settings or {})}


def make_token(pid):
    return f"{pid}.{hmac.new(SECRET.encode(), str(pid).encode(), hashlib.sha256).hexdigest()[:32]}"


def hash_pin(pin, salt=None):
    salt = salt or os.urandom(8).hex()
    return salt + "$" + hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), 60000).hex()


def check_pin(pin, stored):
    return bool(stored) and hmac.compare_digest(hash_pin(pin, stored.split("$")[0]), stored)


def current(authorization: str = Header(""), db=Depends(get_db)):
    tok = authorization.removeprefix("Bearer ")
    pid = tok.split(".")[0]
    if not pid.isdigit() or not hmac.compare_digest(make_token(int(pid)), tok):
        return None
    return db.get(Person, int(pid))


def need(*roles):
    def dep(p: Person | None = Depends(current)):
        if p is None:
            raise HTTPException(401, "login required")
        if roles and p.role not in roles:
            raise HTTPException(403, f"needs role: {', '.join(roles)}")
        return p
    return dep


def find(db, model, key):
    obj = db.get(model, key)
    if obj is None:
        raise HTTPException(404, f"{model.__name__.lower()} not found")
    return obj


def same_village(p, village_id):
    if p.role != "admin" and p.village_id != village_id:
        raise HTTPException(403, "other village")


def iso(dt):
    return dt.isoformat() + "Z" if dt else None


def first_name(p):
    return p.name.split()[0] if p and p.name else "Neighbour"


def person_dict(p):
    return {"id": p.id, "name": p.name, "role": p.role, "village_id": p.village_id, "meter_id": p.meter_id, "demo": p.demo}


def award(db, person_id, village_id, reason, ref=None, points=None, when=None):
    if ref and db.scalars(select(PointEntry.id).where(PointEntry.person_id == person_id, PointEntry.reason == reason, PointEntry.ref == ref)).first():
        return None
    e = PointEntry(person_id=person_id, village_id=village_id, points=POINTS[reason] if points is None else points, reason=reason, ref=ref,
                   created=when or utcnow())
    db.add(e)
    return e


def residents(db, meter_id):
    return db.scalars(select(Person).where(Person.meter_id == meter_id)).all()


def balance(db, wallet, village=None, network_id=None):
    q = select(func.coalesce(func.sum(FundEntry.amount), 0.0)).where(FundEntry.wallet == wallet, FundEntry.status == "approved")
    q = q.where(FundEntry.network_id == network_id) if wallet == "network" else q.where(FundEntry.village_id == village.id)
    return round(float(db.scalar(q)), 2)


def add_entry(db, village, wallet, direction, amount, kind, by=None, note=None, ref=None, data=None, when=None):
    if wallet not in WALLETS or kind not in WALLETS[wallet][direction]:
        raise HTTPException(422, f"'{kind}' is not allowed as {direction} of the {wallet} wallet")
    if amount <= 0:
        raise HTTPException(422, "amount must be positive")
    if wallet == "network" and not village.network_id:
        raise HTTPException(422, "village is not in a network")
    e = FundEntry(village_id=None if wallet == "network" else village.id, network_id=village.network_id if wallet == "network" else None,
                  wallet=wallet, amount=amount if direction == "income" else -amount, kind=kind, note=note, ref=ref, data=data or {},
                  status="approved" if direction == "income" else "pending", created_by=by.id if by else None,
                  approvals=[by.id] if by and direction == "expense" else [], created=when or utcnow())
    db.add(e)
    db.flush()
    settle(db, village, e)
    return e


def settle(db, village, e):
    if e.status != "pending" or len(set(e.approvals)) < cfg(village)["approvals"]:
        return
    if balance(db, e.wallet, village, village.network_id) + e.amount < 0:
        raise HTTPException(409, f"not enough money in the {e.wallet} wallet")
    e.status = "approved"
    if e.ref and e.ref.startswith("bill:"):
        bill = db.get(Bill, int(e.ref[5:]))
        if bill and bill.status == "unpaid":
            bill.status, bill.paid_at, bill.paid_via = "paid", utcnow(), "namjai"


def run_bills(db, village, now=None):
    now = now or utcnow()
    c = cfg(village)
    created = []
    for m in db.scalars(select(Meter).where(Meter.village_id == village.id, Meter.kind == "house")).all():
        last_bill = db.scalars(select(Bill).where(Bill.meter_id == m.id).order_by(Bill.issued.desc()).limit(1)).first()
        latest = db.scalars(select(Reading).where(Reading.meter_id == m.id, Reading.status == "confirmed", Reading.taken_at <= now)
                            .order_by(Reading.taken_at.desc()).limit(1)).first()
        if latest is None or (last_bill and last_bill.reading_id == latest.id):
            continue
        if last_bill:
            prev = last_bill.value
        else:
            first = db.scalars(select(Reading).where(Reading.meter_id == m.id, Reading.status == "confirmed",
                                                     Reading.taken_at <= latest.taken_at - timedelta(days=20))
                               .order_by(Reading.taken_at.desc()).limit(1)).first()
            if first is None:
                continue
            prev = first.value
        m3 = round(max(0.0, latest.value - prev), 3)
        bill = Bill(village_id=village.id, meter_id=m.id, reading_id=latest.id, prev_value=prev, value=latest.value, m3=m3,
                    amount=round(max(c["min_charge"], m3 * c["price_per_m3"]), 2), issued=latest.taken_at,
                    due=latest.taken_at + timedelta(days=c["due_days"]))
        db.add(bill)
        db.flush()
        if last_bill and m3 < last_bill.m3:
            for p in residents(db, m.id):
                award(db, p.id, village.id, "saving", f"bill:{bill.id}", when=latest.taken_at)
        created.append(bill)
    db.commit()
    return created


def pay_bill(db, bill, by=None, when=None):
    if bill.status != "unpaid":
        raise HTTPException(409, "bill is not unpaid")
    when = when or utcnow()
    village = db.get(Village, bill.village_id)
    bill.status, bill.paid_at, bill.paid_via = "paid", when, "self"
    add_entry(db, village, "repair", "income", bill.amount, "water_fee", by, ref=f"bill:{bill.id}", when=when)
    if when <= bill.due:
        for p in residents(db, bill.meter_id):
            award(db, p.id, village.id, "on_time", f"bill:{bill.id}", when=when)
    db.commit()


def bill_dict(b, meter=None):
    return {"id": b.id, "meter_id": b.meter_id, "meter": meter.label if meter else None, "prev": b.prev_value, "value": b.value,
            "m3": b.m3, "amount": b.amount, "issued": iso(b.issued), "due": iso(b.due), "status": b.status,
            "paid_at": iso(b.paid_at), "paid_via": b.paid_via, "overdue": b.status == "unpaid" and b.due < utcnow()}


def entry_dict(e, people):
    data = dict(e.data or {})
    if data.get("anonymous"):
        data.pop("donor", None)
    return {"id": e.id, "wallet": e.wallet, "amount": e.amount, "kind": e.kind, "note": e.note, "status": e.status,
            "created": iso(e.created), "by": first_name(people.get(e.created_by)) if e.created_by else None,
            "approvals": len(set(e.approvals or [])), "ref": e.ref if e.wallet != "namjai" else None, "data": data}


def km(a_lat, a_lon, b_lat, b_lon):
    if None in (a_lat, a_lon, b_lat, b_lon):
        return None
    p = math.pi / 180
    h = math.sin((b_lat - a_lat) * p / 2) ** 2 + math.cos(a_lat * p) * math.cos(b_lat * p) * math.sin((b_lon - a_lon) * p / 2) ** 2
    return round(12742 * math.asin(math.sqrt(h)), 2)


def job_dict(j, people=None):
    people = people or {}
    return {"id": j.id, "village_id": j.village_id, "zone_id": j.zone_id, "kind": j.kind, "source": j.source, "note": j.note,
            "lat": j.lat, "lon": j.lon, "photo": f"/api/repairs/{j.id}/photo.jpg" if j.photo else None,
            "litres_per_day": j.litres_per_day, "size": j.size, "status": j.status,
            "technician": first_name(people.get(j.technician_id)) if j.technician_id else None, "technician_id": j.technician_id,
            "depot_id": j.depot_id, "parts": j.parts, "verified": j.verified, "created": iso(j.created), "updated": iso(j.updated),
            "history": j.history}


def sync_leak_jobs(db, village):
    for a in db.scalars(select(Alert).where(Alert.village_id == village.id, Alert.kind == "leak", Alert.level == "red", Alert.resolved.is_(None))):
        job = db.scalars(select(RepairJob).where(RepairJob.alert_id == a.id)).first()
        lpd = a.data.get("litres_per_day")
        if job is None:
            main = db.get(Meter, a.data.get("meter_id"))
            db.add(RepairJob(village_id=village.id, kind="leak_detected", source="system", alert_id=a.id, litres_per_day=lpd, size="large",
                             lat=main.lat if main else village.lat, lon=main.lon if main else village.lon,
                             note=f"Night flow high since {a.data.get('started')}: about {lpd} L/day lost",
                             history=[{"at": iso(utcnow()), "status": "open", "by": "NamJai"}]))
        elif job.status not in ("done", "cancelled"):
            job.litres_per_day = lpd
    db.commit()


def award_main_photo(db, reading, meter):
    if meter.kind != "main" or reading.source != "phone" or not (reading.confirmed_by or "").startswith("person:"):
        return
    pid = int(reading.confirmed_by.split(":")[1])
    day = reading.taken_at.date().isoformat()
    if db.scalars(select(PointEntry.id).where(PointEntry.village_id == meter.village_id, PointEntry.reason == "main_photo",
                                              PointEntry.ref == f"day:{day}")).first():
        return
    award(db, pid, meter.village_id, "main_photo", f"day:{day}")
    db.commit()


class LoginIn(BaseModel):
    phone: str
    pin: str


@router.post("/login")
def login(body: LoginIn, db=Depends(get_db)):
    p = db.scalars(select(Person).where(Person.phone == body.phone)).first()
    if not p or not check_pin(body.pin, p.pin_hash):
        raise HTTPException(401, "wrong phone or PIN")
    return {"token": make_token(p.id), "person": person_dict(p)}


class DemoIn(BaseModel):
    village_id: int
    role: str = "resident"


@router.post("/demo/login")
def demo_login(body: DemoIn, db=Depends(get_db)):
    p = db.scalars(select(Person).where(Person.demo.is_(True), Person.role == body.role,
                                        (Person.village_id == body.village_id) | (Person.role == "technician"))).first()
    v = db.get(Village, body.village_id)
    if not p or not v or not v.simulated:
        raise HTTPException(404, "no demo account for this village and role")
    return {"token": make_token(p.id), "person": person_dict(p)}


@router.get("/me")
def me(p: Person = Depends(need()), db=Depends(get_db)):
    points = db.scalar(select(func.coalesce(func.sum(PointEntry.points), 0)).where(PointEntry.person_id == p.id))
    unpaid = db.scalars(select(Bill).where(Bill.meter_id == p.meter_id, Bill.status == "unpaid")).all() if p.meter_id else []
    meter = db.get(Meter, p.meter_id) if p.meter_id else None
    return {**person_dict(p), "points": int(points), "unpaid": len(unpaid), "unpaid_amount": round(sum(b.amount for b in unpaid), 2),
            "meter": {"id": meter.id, "label": meter.label, "n_digits": meter.n_digits} if meter else None}


@router.post("/villages/{vid}/bills/run")
def bills_run(vid: int, p: Person = Depends(need(*STAFF)), db=Depends(get_db)):
    same_village(p, vid)
    return {"created": [b.id for b in run_bills(db, find(db, Village, vid))]}


@router.get("/villages/{vid}/bills")
def bills(vid: int, status: str | None = None, p: Person = Depends(need(*STAFF)), db=Depends(get_db)):
    same_village(p, vid)
    q = select(Bill, Meter).join(Meter, Bill.meter_id == Meter.id).where(Bill.village_id == vid)
    if status:
        q = q.where(Bill.status == status)
    return [bill_dict(b, m) for b, m in db.execute(q.order_by(Bill.issued.desc()).limit(300))]


@router.get("/me/bills")
def my_bills(p: Person = Depends(need()), db=Depends(get_db)):
    if not p.meter_id:
        return []
    m = db.get(Meter, p.meter_id)
    return [bill_dict(b, m) for b in db.scalars(select(Bill).where(Bill.meter_id == p.meter_id).order_by(Bill.issued.desc()).limit(24))]


@router.post("/bills/{bid}/pay")
def bills_pay(bid: int, p: Person = Depends(need(*STAFF)), db=Depends(get_db)):
    b = find(db, Bill, bid)
    same_village(p, b.village_id)
    pay_bill(db, b, p)
    return bill_dict(b)


@router.post("/bills/{bid}/namjai", status_code=201)
def bills_namjai(bid: int, p: Person = Depends(need("committee", "admin")), db=Depends(get_db)):
    b = find(db, Bill, bid)
    same_village(p, b.village_id)
    if b.status != "unpaid":
        raise HTTPException(409, "bill is not unpaid")
    if db.scalars(select(FundEntry.id).where(FundEntry.ref == f"bill:{b.id}", FundEntry.status == "pending")).first():
        raise HTTPException(409, "already proposed")
    e = add_entry(db, db.get(Village, b.village_id), "namjai", "expense", b.amount, "namjai_bill", p, "Namjai support", f"bill:{b.id}")
    db.commit()
    return {"fund_entry": e.id, "status": e.status}


@router.get("/villages/{vid}/namjai/candidates")
def namjai_candidates(vid: int, p: Person = Depends(need("committee", "admin")), db=Depends(get_db)):
    same_village(p, vid)
    q = select(Bill, Meter).join(Meter, Bill.meter_id == Meter.id).where(Bill.village_id == vid, Bill.status == "unpaid")
    return [bill_dict(b, m) for b, m in db.execute(q.order_by(Bill.due))]


@router.get("/villages/{vid}/funds")
def funds(vid: int, db=Depends(get_db)):
    v = find(db, Village, vid)
    wallets = {w: balance(db, w, v, v.network_id) for w in WALLETS if w != "network" or v.network_id}
    q = select(FundEntry).where((FundEntry.village_id == vid) | ((FundEntry.network_id == v.network_id) & FundEntry.network_id.is_not(None)))
    entries = db.scalars(q.order_by(FundEntry.created.desc()).limit(40)).all()
    people = {x.id: x for x in db.scalars(select(Person).where(Person.id.in_({e.created_by for e in entries if e.created_by})))}
    return {"wallets": wallets, "rules": {w: {k: sorted(v) for k, v in r.items()} for w, r in WALLETS.items()},
            "approvals_needed": cfg(v)["approvals"],
            "entries": [entry_dict(e, people) for e in entries if e.status == "approved"],
            "pending": [entry_dict(e, people) for e in entries if e.status == "pending"]}


class EntryIn(BaseModel):
    wallet: str
    direction: str = Field(pattern="^(income|expense)$")
    amount: float
    kind: str
    note: str | None = None
    ref: str | None = None


@router.post("/villages/{vid}/funds", status_code=201)
def funds_add(vid: int, body: EntryIn, p: Person = Depends(need(*STAFF)), db=Depends(get_db)):
    same_village(p, vid)
    if body.kind == "water_fee":
        raise HTTPException(422, "water fees are recorded by paying a bill")
    e = add_entry(db, find(db, Village, vid), body.wallet, body.direction, body.amount, body.kind, p, body.note, body.ref)
    db.commit()
    return {"id": e.id, "status": e.status}


@router.post("/funds/{eid}/approve")
def funds_approve(eid: int, p: Person = Depends(need("committee", "caretaker", "admin")), db=Depends(get_db)):
    e = find(db, FundEntry, eid)
    v = db.get(Village, e.village_id) if e.village_id else db.scalars(select(Village).where(Village.network_id == e.network_id, Village.id == p.village_id)).first()
    if v is None:
        raise HTTPException(403, "other village")
    same_village(p, v.id)
    if e.status != "pending":
        raise HTTPException(409, "not pending")
    if p.id in e.approvals:
        raise HTTPException(409, "you already approved; another person must approve")
    e.approvals = [*e.approvals, p.id]
    settle(db, v, e)
    db.commit()
    return {"id": e.id, "status": e.status, "approvals": len(e.approvals)}


class RepairIn(BaseModel):
    kind: str
    note: str | None = Field(None, max_length=500)
    lat: float | None = None
    lon: float | None = None
    zone_id: int | None = None


@router.post("/villages/{vid}/repairs", status_code=201)
def repairs_add(vid: int, body: RepairIn, p: Person = Depends(need()), db=Depends(get_db)):
    same_village(p, vid)
    if body.kind not in REPAIR_KINDS - {"leak_detected"}:
        raise HTTPException(422, "unknown problem type")
    size = "small" if body.kind == "broken_tap" else None
    j = RepairJob(village_id=vid, reported_by=p.id, size=size, history=[{"at": iso(utcnow()), "status": "open", "by": first_name(p)}],
                  **body.model_dump())
    db.add(j)
    db.commit()
    return job_dict(j)


@router.post("/repairs/{jid}/photo")
async def repairs_photo(jid: int, file: UploadFile = File(...), p: Person = Depends(need()), db=Depends(get_db)):
    j = find(db, RepairJob, jid)
    same_village(p, j.village_id)
    j.photo = await file.read()
    db.commit()
    return {"ok": True}


@router.get("/repairs/{jid}/photo.jpg")
def repairs_photo_get(jid: int, db=Depends(get_db)):
    j = find(db, RepairJob, jid)
    if not j.photo:
        raise HTTPException(404, "no photo")
    return Response(j.photo, media_type="image/jpeg")


def sort_jobs(jobs):
    active = [j for j in jobs if j.status not in ("done", "cancelled")]
    rest = [j for j in jobs if j.status in ("done", "cancelled")]
    active.sort(key=lambda j: (-(j.litres_per_day or 0), j.created))
    rest.sort(key=lambda j: j.updated, reverse=True)
    return active + rest


@router.get("/villages/{vid}/repairs")
def repairs(vid: int, include_done: bool = True, db=Depends(get_db)):
    jobs = db.scalars(select(RepairJob).where(RepairJob.village_id == vid)).all()
    if not include_done:
        jobs = [j for j in jobs if j.status not in ("done", "cancelled")]
    people = {x.id: x for x in db.scalars(select(Person).where(Person.id.in_({j.technician_id for j in jobs if j.technician_id})))}
    return [job_dict(j, people) for j in sort_jobs(jobs)[:100]]


@router.get("/repairs/{jid}")
def repair(jid: int, db=Depends(get_db)):
    j = find(db, RepairJob, jid)
    return job_dict(j, {x.id: x for x in db.scalars(select(Person).where(Person.id == j.technician_id))})


class RepairPatch(BaseModel):
    status: str | None = None
    technician_id: int | None = None
    size: str | None = None
    depot_id: int | None = None
    parts: list[dict] | None = None
    verified: bool | None = None
    litres_per_day: float | None = None
    note: str | None = None


@router.patch("/repairs/{jid}")
def repairs_update(jid: int, body: RepairPatch, p: Person = Depends(need(*STAFF, "technician")), db=Depends(get_db)):
    j = find(db, RepairJob, jid)
    if p.role != "technician":
        same_village(p, j.village_id)
    changes = body.model_dump(exclude_none=True)
    if "status" in changes and changes["status"] not in REPAIR_STATUS:
        raise HTTPException(422, "unknown status")
    if p.role == "technician" and "technician_id" not in changes and j.technician_id is None:
        changes["technician_id"] = p.id
    for k, val in changes.items():
        setattr(j, k, val)
    if changes.get("technician_id") and j.status == "open":
        j.status = "assigned"
    if j.status == "done" and j.depot_id and j.parts and not any(h.get("parts_taken") for h in j.history):
        depot = db.get(Depot, j.depot_id)
        items = dict(depot.items or {})
        for part in j.parts:
            items[part["name"]] = max(0, items.get(part["name"], 0) - int(part.get("qty", 1)))
        depot.items = items
        depot.log = [*(depot.log or []), {"at": iso(utcnow()), "job": j.id, "parts": j.parts, "by": first_name(p)}]
        changes["parts_taken"] = True
    j.updated = utcnow()
    j.history = [*j.history, {"at": iso(j.updated), "status": j.status, "by": first_name(p), **({"parts_taken": True} if changes.get("parts_taken") else {})}]
    if j.status == "done" and j.verified and j.reported_by:
        award(db, j.reported_by, j.village_id, "verified_report", f"job:{j.id}")
    db.commit()
    return job_dict(j, {x.id: x for x in db.scalars(select(Person).where(Person.id == j.technician_id))})


@router.get("/repairs/{jid}/technicians")
def repairs_technicians(jid: int, db=Depends(get_db)):
    j = find(db, RepairJob, jid)
    v = db.get(Village, j.village_id)
    lat, lon = j.lat or v.lat, j.lon or v.lon
    techs = db.scalars(select(Person).where(Person.role == "technician", (Person.network_id == v.network_id) | (Person.village_id == v.id))).all()
    busy = dict(db.execute(select(RepairJob.technician_id, func.count()).where(RepairJob.status.in_(("assigned", "fixing")))
                           .group_by(RepairJob.technician_id)).all())
    out = [{"id": t.id, "name": first_name(t), "km": km(lat, lon, t.lat, t.lon), "active_jobs": busy.get(t.id, 0)} for t in techs]
    depots = db.scalars(select(Depot).where(Depot.network_id == v.network_id)).all()
    return {"technicians": sorted(out, key=lambda t: (t["km"] is None, t["km"] or 0)),
            "depots": sorted([{"id": d.id, "name": d.name, "km": km(lat, lon, d.lat, d.lon), "items": d.items} for d in depots],
                             key=lambda d: (d["km"] is None, d["km"] or 0))}


@router.get("/villages/{vid}/leaderboard")
def leaderboard(vid: int, month: str | None = None, db=Depends(get_db)):
    now = utcnow()
    y, m = map(int, (month or f"{now.year}-{now.month:02d}").split("-"))
    start, end = datetime(y, m, 1), datetime(y + (m == 12), m % 12 + 1, 1)
    rows = db.execute(select(PointEntry.person_id, func.sum(PointEntry.points)).where(
        PointEntry.village_id == vid, PointEntry.points > 0, PointEntry.created >= start, PointEntry.created < end)
        .group_by(PointEntry.person_id).order_by(func.sum(PointEntry.points).desc()).limit(10)).all()
    people = {x.id: x for x in db.scalars(select(Person).where(Person.id.in_([r[0] for r in rows])))}
    return {"month": f"{y}-{m:02d}", "guardians": [{"name": first_name(people.get(pid)), "points": int(pts)} for pid, pts in rows]}


@router.get("/me/points")
def my_points(p: Person = Depends(need()), db=Depends(get_db)):
    es = db.scalars(select(PointEntry).where(PointEntry.person_id == p.id).order_by(PointEntry.created.desc()).limit(50)).all()
    total = db.scalar(select(func.coalesce(func.sum(PointEntry.points), 0)).where(PointEntry.person_id == p.id))
    return {"total": int(total), "rules": POINTS, "rewards": REWARDS,
            "entries": [{"points": e.points, "reason": e.reason, "created": iso(e.created)} for e in es]}


class RedeemIn(BaseModel):
    reward_id: str


@router.post("/me/redeem", status_code=201)
def redeem(body: RedeemIn, p: Person = Depends(need()), db=Depends(get_db)):
    r = next((r for r in REWARDS if r["id"] == body.reward_id), None)
    if r is None:
        raise HTTPException(404, "unknown reward")
    total = db.scalar(select(func.coalesce(func.sum(PointEntry.points), 0)).where(PointEntry.person_id == p.id))
    if total < r["points"]:
        raise HTTPException(409, "not enough points")
    if r["points"]:
        db.add(PointEntry(person_id=p.id, village_id=p.village_id, points=-r["points"], reason="redeem", ref=r["id"]))
    db.commit()
    return {"ok": True, "reward": r["id"], "note": "The committee will contact you."}


def donor_title(total):
    return next(t for floor, t in TITLES if total >= floor) if total >= 1 else None


@router.get("/villages/{vid}/namjai")
def namjai(vid: int, db=Depends(get_db)):
    v = find(db, Village, vid)
    gifts = db.scalars(select(FundEntry).where(FundEntry.village_id == vid, FundEntry.wallet == "namjai", FundEntry.kind == "donation")).all()
    donors = {}
    for g in gifts:
        name = "Anonymous" if g.data.get("anonymous") else g.data.get("donor", "Neighbour")
        key = f"anon-{g.id}" if name == "Anonymous" else name
        donors.setdefault(key, {"name": name, "total": 0.0})["total"] += g.amount
    helped = db.scalars(select(Bill).where(Bill.village_id == vid, Bill.paid_via == "namjai")).all()
    thanks = db.scalars(select(ThankYou).where(ThankYou.village_id == vid).order_by(ThankYou.created.desc()).limit(20)).all()
    board = sorted(donors.values(), key=lambda d: -d["total"])
    return {"balance": balance(db, "namjai", v), "donated": round(sum(g.amount for g in gifts), 2), "donors": len(board),
            "bills_covered": len(helped), "households_helped": len({b.meter_id for b in helped}),
            "amount_covered": round(sum(b.amount for b in helped), 2),
            "board": [{"name": d["name"], "title": donor_title(d["total"])} for d in board[:30]],
            "thanks": [{"text": t.text, "created": iso(t.created)} for t in thanks]}


class DonationIn(BaseModel):
    amount: float
    donor: str = Field(max_length=60)
    anonymous: bool = False


@router.post("/villages/{vid}/namjai/donations", status_code=201)
def namjai_donate(vid: int, body: DonationIn, p: Person = Depends(need(*STAFF)), db=Depends(get_db)):
    same_village(p, vid)
    e = add_entry(db, find(db, Village, vid), "namjai", "income", body.amount, "donation", p, data={"donor": body.donor, "anonymous": body.anonymous})
    db.commit()
    return {"id": e.id}


class ThanksIn(BaseModel):
    text: str = Field(min_length=1, max_length=280)


@router.post("/villages/{vid}/namjai/thanks", status_code=201)
def namjai_thanks(vid: int, body: ThanksIn, p: Person = Depends(need()), db=Depends(get_db)):
    same_village(p, vid)
    db.add(ThankYou(village_id=vid, text=body.text.strip()))
    db.commit()
    return {"ok": True}


class PersonIn(BaseModel):
    village_id: int | None = None
    network_id: int | None = None
    name: str
    phone: str
    pin: str = Field(min_length=4, max_length=8)
    role: str = "resident"
    meter_id: int | None = None
    lat: float | None = None
    lon: float | None = None


def admin(authorization: str = Header("")):
    if authorization != f"Bearer {config.ADMIN_TOKEN}":
        raise HTTPException(401, "admin token required")


@router.post("/admin/people", status_code=201, dependencies=[Depends(admin)])
def admin_person(body: PersonIn, db=Depends(get_db)):
    data = body.model_dump()
    p = Person(pin_hash=hash_pin(data.pop("pin")), **data)
    db.add(p)
    db.commit()
    return person_dict(p)


class DepotIn(BaseModel):
    network_id: int
    name: str
    lat: float | None = None
    lon: float | None = None
    items: dict = {}


@router.post("/admin/depots", status_code=201, dependencies=[Depends(admin)])
def admin_depot(body: DepotIn, db=Depends(get_db)):
    d = Depot(**body.model_dump())
    db.add(d)
    db.commit()
    return {"id": d.id}
