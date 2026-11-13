from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from . import analytics as A
from . import community as C
from . import services as S
from .models import Meter, Person, RepairJob, Village, Zone

router = APIRouter(prefix="/api")
KINDS = ("government", "local", "volunteer", "foundation", "technician", "other")
WEIGHT = {"red": 1000, "yellow": 300, "green": 0}


def job_brief(j, names):
    notes = [{"at": h["at"], "by": h.get("by"), "text": h["problem"]} for h in j.history or [] if h.get("problem")]
    return {"id": j.id, "kind": j.kind, "status": j.status, "zone_id": j.zone_id, "technician": names.get(j.technician_id),
            "eta": C.iso(j.eta), "litres_per_day": j.litres_per_day, "people_per_day": A.people(j.litres_per_day),
            "note": j.note, "problems": notes[-5:], "created": C.iso(j.created), "updated": C.iso(j.updated), "proof": j.proof or {}}


def village_card(db, v, names):
    alerts = S.open_alerts(db, v.id)
    level = S.village_level(alerts)
    by = {a.kind: a.data for a in alerts}
    jobs = db.scalars(select(RepairJob).where(RepairJob.village_id == v.id)).all()
    active = [j for j in jobs if j.status not in ("done", "cancelled")]
    done = sorted([j for j in jobs if j.status == "done"], key=lambda j: j.updated, reverse=True)
    saved = sum((j.proof or {}).get("litres_stopped_per_day") or 0 for j in done)
    lost = (by.get("leak") or {}).get("litres_per_day") or 0
    burst = (by.get("burst") or {}).get("litres_per_hour")
    houses = sum(1 for m in v.meters if m.kind == "house") or int((v.settings or {}).get("households") or 0)
    settings = v.settings or {}
    waiting = sum(1 for j in active if j.status == "open")
    score = WEIGHT[level] + lost / 10 + (burst or 0) + 60 * waiting + 20 * len(active)
    return {"id": v.id, "name": v.name, "simulated": v.simulated, "lat": v.lat, "lon": v.lon, "network_id": v.network_id,
            "level": level, "score": round(score, 1), "households": houses, "zones": [{"id": z.id, "name": z.name} for z in v.zones],
            "alerts": sorted(by), "litres_lost_per_day": lost or None, "people_lost": A.people(lost) if lost else None,
            "burst_litres_per_hour": burst, "leak_started": (by.get("leak") or {}).get("started"),
            "nights": (by.get("leak") or {}).get("nights"),
            "jobs": [job_brief(j, names) for j in C.sort_jobs(active)],
            "recent_done": [job_brief(j, names) for j in done[:3]],
            "litres_saved_per_day": round(saved) or None, "people_saved": A.people(saved) if saved else None,
            "repair_fund": C.balance(db, "repair", v, v.network_id), "has_main_meter": any(m.kind == "main" for m in v.meters),
            "agencies": settings.get("agencies", []), "currency": settings.get("currency", "THB")}


@router.get("/triage")
def triage(db=Depends(C.get_db)):
    vs = db.scalars(select(Village).order_by(Village.id)).all()
    names = {p.id: C.first_name(p) for p in db.scalars(select(Person).where(Person.role.in_(("technician", *C.STAFF))))}
    cards = sorted((village_card(db, v, names) for v in vs), key=lambda c: -c["score"])
    for i, c in enumerate(cards, 1):
        c["rank"] = i
    return {"villages": cards, "litres_saved_per_day": sum(c["litres_saved_per_day"] or 0 for c in cards),
            "litres_lost_per_day": sum(c["litres_lost_per_day"] or 0 for c in cards)}


class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    households: int = Field(ge=1, le=5000)
    zones: list[str] = Field(default_factory=list, max_length=12)
    caretaker: str = Field(min_length=1, max_length=80)
    phone: str = Field(pattern=r"^\+?[0-9]{9,15}$")
    pin: str = Field(pattern=r"^[0-9]{4,8}$")
    lat: float | None = Field(None, ge=-90, le=90)
    lon: float | None = Field(None, ge=-180, le=180)
    network_id: int | None = None


@router.post("/villages/register", status_code=201)
def register(body: RegisterIn, db=Depends(C.get_db)):
    if db.scalars(select(Person).where(Person.phone == body.phone)).first():
        raise HTTPException(409, "phone already used")
    v = Village(name=body.name.strip(), lat=body.lat, lon=body.lon, network_id=body.network_id, simulated=False,
                settings={"households": body.households, "agencies": []})
    db.add(v)
    db.flush()
    for z in dict.fromkeys(n.strip()[:80] for n in body.zones if n.strip()):
        db.add(Zone(village_id=v.id, name=z))
    db.add(Meter(village_id=v.id, kind="main", label="Main meter", lat=body.lat, lon=body.lon))
    p = Person(village_id=v.id, network_id=body.network_id, name=body.caretaker.strip(), phone=body.phone,
               pin_hash=C.hash_pin(body.pin), role="caretaker")
    db.add(p)
    db.commit()
    return {"village_id": v.id, "token": C.make_token(p.id), "person": C.person_dict(p)}


class AgencyIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    kind: str = Field("other", pattern="^(" + "|".join(KINDS) + ")$")
    phone: str | None = Field(None, max_length=30)
    email: str | None = Field(None, max_length=120)
    helps_with: str | None = Field(None, max_length=200)


@router.post("/villages/{vid}/agencies", status_code=201)
def add_agency(vid: int, body: AgencyIn, db=Depends(C.get_db)):
    v = C.find(db, Village, vid)
    have = list((v.settings or {}).get("agencies", []))
    if len(have) >= 20:
        raise HTTPException(409, "too many agencies")
    if any(a.get("name", "").lower() == body.name.strip().lower() for a in have):
        raise HTTPException(409, "agency already listed")
    item = {**body.model_dump(exclude_none=True), "name": body.name.strip(), "verified": False}
    v.settings = {**(v.settings or {}), "agencies": [*have, item]}
    db.commit()
    return item
