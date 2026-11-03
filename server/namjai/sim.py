import argparse
import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import cv2
import numpy as np

from namjai_ocr import synth

from . import db as D
from . import services as S
from . import community as C
from .models import Depot, Device, FundEntry, Heartbeat, Meter, Network, Person, Reading, RepairJob, ThankYou, Village, Zone, utcnow

PROFILE = np.array([0.15, 0.1, 0.08, 0.08, 0.15, 0.6, 1.8, 2.2, 1.6, 1.1, 0.9, 1.0,
                    1.2, 0.9, 0.8, 0.9, 1.3, 1.9, 2.1, 1.8, 1.3, 0.9, 0.5, 0.3])
PROFILE = PROFILE / PROFILE.mean()
STEP = timedelta(minutes=15)


@dataclass
class Leak:
    start: datetime
    m3h: float
    end: datetime | None = None
    house: int | None = None


@dataclass
class VillageModel:
    houses: int
    start: datetime
    days: int
    tz: str = "Asia/Bangkok"
    seed: int = 0
    background_m3h: float = 0.03
    leaks: list = field(default_factory=list)

    def __post_init__(self):
        rng = np.random.default_rng(self.seed)
        n = int(self.days * 24 * 4) + 8
        self.t = [self.start + i * STEP for i in range(n)]
        tz = ZoneInfo(self.tz)
        hours = np.array([t.replace(tzinfo=ZoneInfo("UTC")).astimezone(tz).hour for t in self.t])
        day = np.array([(t - self.start).days for t in self.t])
        daily = rng.lognormal(math.log(0.5), 0.4, self.houses)
        weather = rng.normal(1, 0.08, self.days + 2)[day]
        flow = daily[:, None] / 24 * PROFILE[hours][None, :] * weather[None, :] * rng.lognormal(0, 0.35, (self.houses, n))
        for lk in self.leaks:
            on = np.array([(t >= lk.start) and (lk.end is None or t < lk.end) for t in self.t])
            if lk.house is not None:
                flow[lk.house] += lk.m3h * on
        main = flow.sum(0) + self.background_m3h
        for lk in self.leaks:
            if lk.house is None:
                main += lk.m3h * np.array([(t >= lk.start) and (lk.end is None or t < lk.end) for t in self.t])
        dt = STEP.total_seconds() / 3600
        self.house_cum = np.concatenate([np.zeros((self.houses, 1)), np.cumsum(flow * dt, 1)[:, :-1]], 1) + rng.uniform(100, 3000, (self.houses, 1))
        self.main_cum = np.concatenate([[0.0], np.cumsum(main * dt)[:-1]]) + rng.uniform(10000, 60000)

    def _at(self, arr, when):
        x = (when - self.start) / STEP
        i = min(max(int(x), 0), len(self.t) - 2)
        return float(arr[i] + (arr[i + 1] - arr[i]) * (x - i))

    def main_at(self, when):
        return self._at(self.main_cum, when)

    def house_at(self, i, when):
        return self._at(self.house_cum[i], when)


def floor_to(v, scale):
    return math.floor(v / scale + 1e-9) * scale


def seed_village(db, name, model, zones=4, lat=None, lon=None, outages=(), silent=False, now=None, house_rounds=True, network_id=None):
    now = now or utcnow()
    v = Village(name=name, tz=model.tz, lat=lat, lon=lon, simulated=True, settings={}, network_id=network_id)
    db.add(v)
    db.flush()
    zs = [Zone(village_id=v.id, name=f"Soi {i + 1}") for i in range(zones)]
    db.add_all(zs)
    db.flush()
    rng = np.random.default_rng(model.seed + 1)
    main = Meter(village_id=v.id, kind="main", label="Main meter", n_digits=6, scale=0.1, max_flow=40,
                 lat=lat, lon=lon)
    db.add(main)
    houses = []
    for i in range(model.houses):
        z = zs[i % zones]
        houses.append(Meter(village_id=v.id, zone_id=z.id, kind="house", label=f"House {i + 1}", n_digits=5, scale=1.0,
                            lat=None if lat is None else lat + rng.normal(0, 0.002) + 0.003 * (i % zones),
                            lon=None if lon is None else lon + rng.normal(0, 0.003)))
    db.add_all(houses)
    db.flush()
    dev = Device(id=f"clip-sim-{v.id}", meter_id=main.id, token_hash=S.hash_token(f"sim-{v.id}"), commands={})
    db.add(dev)
    end = min(now, model.start + timedelta(days=model.days))
    t = model.start.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    seq = 0
    while t <= end:
        seq += 1
        if not any(a <= t < b for a, b in outages) and not (silent and t > end - timedelta(hours=6)):
            db.add(Reading(meter_id=main.id, device_id=dev.id, seq=seq, taken_at=t, value=round(floor_to(model.main_at(t), 0.1), 1),
                           confidence=0.99, source="clip", status="auto"))
            dev.last_seen = t
        t += timedelta(hours=1)
    if dev.last_seen:
        db.add(Heartbeat(device_id=dev.id, at=dev.last_seen, data={"fw": "sim", "camera": True, "queue": 0}))
    if house_rounds:
        tz = ZoneInfo(model.tz)
        day = model.start.replace(tzinfo=ZoneInfo("UTC")).astimezone(tz).replace(day=5, hour=9, minute=0, second=0, microsecond=0)
        while day.replace(tzinfo=None) < model.start.replace(tzinfo=None):
            day = (day + timedelta(days=32)).replace(day=5)
        while day.astimezone(ZoneInfo("UTC")).replace(tzinfo=None) <= end:
            for i, h in enumerate(houses):
                when = (day + timedelta(days=int(rng.integers(-2, 3)), minutes=int(rng.integers(0, 480)))).astimezone(ZoneInfo("UTC")).replace(tzinfo=None)
                if when <= end:
                    db.add(Reading(meter_id=h.id, taken_at=when, value=float(floor_to(model.house_at(i, when), 1.0)), source="phone",
                                   status="confirmed", confirmed_by="sim"))
            day = (day + timedelta(days=32)).replace(day=5)
    db.commit()
    return v, main, houses, dev


class ClipSim:
    def __init__(self, post, device_id, token, n_digits=6, scale=0.1, seed=0):
        self.post, self.device_id, self.token = post, device_id, token
        self.n, self.scale = n_digits, scale
        self.rng = np.random.default_rng(seed)
        fonts = synth.fonts(synth.TRAIN_FONTS)
        self.style = synth.style(self.rng, fonts)
        self.style["red"] = 1
        h, w = synth.counter(0, n_digits, 0.0, self.style).shape[:2]
        self.margin = (int(w * 0.15), int(h * 0.6))
        self.size = (w + 2 * self.margin[0], h + 2 * self.margin[1])
        self.roi = [self.margin[0], self.margin[1], self.margin[0] + w, self.margin[1] + h]
        self.face = np.array(self.rng.integers(180, 230, 3), np.uint8)
        self.seq = 0
        self.queue = []

    def photo(self, value, night, light):
        units = value / self.scale
        win = synth.counter(int(units) % 10 ** self.n, self.n, units - int(units), self.style)
        img = np.empty((self.size[1], self.size[0], 3), np.uint8)
        img[:] = self.face
        x, y = self.margin
        img[y:y + win.shape[0], x:x + win.shape[1]] = win
        cond = "night" if night else str(self.rng.choice(["clear"] * 8 + ["dust", "fog"]))
        out = synth.degrade(img, cond, self.rng)
        return cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 85])[1].tobytes()

    def headers(self, extra=None):
        return {"Authorization": f"Bearer {self.token}", "X-Device": self.device_id, **(extra or {})}

    def capture(self, when, value, tz="Asia/Bangkok", online=True):
        self.seq += 1
        hour = when.replace(tzinfo=ZoneInfo("UTC")).astimezone(ZoneInfo(tz)).hour
        stamp = int(when.replace(tzinfo=ZoneInfo("UTC")).timestamp())
        for light in "ab":
            self.queue.append((self.seq, light, stamp, self.photo(value, hour >= 19 or hour < 6, light)))
        if not online:
            return []
        results = []
        while self.queue:
            seq, light, stamp, jpeg = self.queue[0]
            r = self.post("/api/clip/photo", content=jpeg,
                          headers=self.headers({"X-Seq": str(seq), "X-Light": light, "X-Captured-At": str(stamp), "Content-Type": "image/jpeg"}))
            if r.status_code not in (200, 201, 409):
                break
            results.append(r)
            self.queue.pop(0)
        self.post("/api/clip/heartbeat", json={"fw": "sim", "seq": self.seq, "queue": len(self.queue), "camera": True}, headers=self.headers())
        return results


NAMES = ["Malee", "Somchai", "Wichai", "Pranee", "Bua", "Kanya", "Niran", "Sompong", "Lamai", "Prasit", "Duang", "Arun",
         "Ratana", "Chuen", "Jintana", "Thong", "Mali", "Somsak", "Noi", "Kasem"]
DONORS = [("Lamai's family", 1500, False), ("Kasem shop", 800, False), ("A neighbour", 300, True), ("Teacher Ratana", 500, False),
          ("Grandpa Thong", 200, False), ("Temple fair", 2500, False)]
THANKS = ["Thank you for helping my family this month.", "We will pay it forward when the harvest comes.",
          "Thank you, kind neighbours. Water is life."]


def person(db, village, name, role, meter=None, demo=False, network_id=None, lat=None, lon=None, phone=None):
    p = Person(village_id=village.id if village else None, network_id=network_id, name=name, role=role,
               meter_id=meter.id if meter else None, demo=demo, lat=lat, lon=lon, phone=phone)
    db.add(p)
    db.flush()
    return p


def seed_community(db, v, houses, rng, now, network_id):
    resident = person(db, v, "Malee", "resident", houses[0], demo=True, phone=f"080000{v.id}001")
    caretaker = person(db, v, "Somchai", "caretaker", houses[1], demo=True, phone=f"080000{v.id}002")
    committee = [person(db, v, "Wichai", "committee", houses[2], demo=True), person(db, v, "Pranee", "committee", houses[3])]
    others = [person(db, v, NAMES[4 + i % (len(NAMES) - 4)], "resident", h) for i, h in enumerate(houses[4:16])]
    add = lambda *a, **k: C.add_entry(db, v, *a, **k)
    start = min(r.taken_at for r in db.query(Reading).filter(Reading.meter_id == houses[0].id))
    add("repair", "income", 5000, "local_budget", caretaker, "Tambon budget (example)", when=start)
    add("rewards", "income", 1000, "sponsor", caretaker, "Kasem shop sponsorship (example)", when=start)
    if network_id:
        add("network", "income", 500, "contribution", caretaker, f"{v.name} share", when=start)
    month = start.replace(day=12, hour=5)
    while month <= now:
        bills = C.run_bills(db, v, month)
        for b in bills:
            roll = rng.random()
            when = b.issued + timedelta(days=int(rng.integers(1, 13))) if roll < 0.8 else b.due + timedelta(days=int(rng.integers(3, 20)))
            if roll < 0.92 and when <= now:
                C.pay_bill(db, b, caretaker, when)
        month = (month + timedelta(days=32)).replace(day=12)
    for name, amount, anon in DONORS:
        add("namjai", "income", amount, "donation", caretaker, data={"donor": name, "anonymous": anon}, when=start + timedelta(days=int(rng.integers(5, 60))))
    unpaid = sorted(db.query(C.Bill).filter(C.Bill.village_id == v.id, C.Bill.status == "unpaid", C.Bill.due < now).all(), key=lambda b: b.due)
    for b in unpaid[:2]:
        e = add("namjai", "expense", b.amount, "namjai_bill", committee[0], "Namjai support", f"bill:{b.id}")
        e.approvals = [committee[0].id, committee[1].id]
        C.settle(db, v, e)
    for text in THANKS[: 1 + v.id % 3]:
        db.add(ThankYou(village_id=v.id, text=text, created=now - timedelta(days=int(rng.integers(1, 30)))))
    zones = [z.id for z in v.zones]
    jobs = [("leak", others[0], 12, True, "large", 1800.0), ("broken_tap", others[1], 20, False, "small", 60.0),
            ("wet_ground", others[2], 35, True, "large", 2500.0), ("no_water", resident, 50, False, "large", None)]
    for kind, who, ago, verified, size, lpd in jobs:
        when = now - timedelta(days=ago)
        j = RepairJob(village_id=v.id, zone_id=zones[ago % len(zones)], kind=kind, reported_by=who.id, size=size, status="done",
                      verified=verified, litres_per_day=lpd, created=when, updated=when + timedelta(days=1),
                      lat=v.lat + rng.normal(0, 0.002), lon=v.lon + rng.normal(0, 0.002),
                      history=[{"at": C.iso(when), "status": "open", "by": C.first_name(who)},
                               {"at": C.iso(when + timedelta(days=1)), "status": "done", "by": "Anan"}])
        db.add(j)
        db.flush()
        if verified:
            C.award(db, who.id, v.id, "verified_report", f"job:{j.id}", when=when + timedelta(days=1))
        if size == "large":
            e = add("repair", "expense", 450.0, "repair_cost", caretaker, f"Repair job #{j.id}", f"job:{j.id}", when=when + timedelta(days=1))
            e.approvals = [caretaker.id, committee[0].id]
            C.settle(db, v, e)
    if v.id % 2:
        db.add(RepairJob(village_id=v.id, zone_id=zones[1 % len(zones)], kind="wet_ground", reported_by=others[3].id,
                         note="Wet ground next to the road, near the big tamarind tree", lat=v.lat + 0.001, lon=v.lon - 0.001,
                         created=now - timedelta(hours=20), updated=now - timedelta(hours=20),
                         history=[{"at": C.iso(now - timedelta(hours=20)), "status": "open", "by": C.first_name(others[3])}]))
    for d in range(1, 8, 3):
        C.award(db, others[(d + v.id) % len(others)].id, v.id, "main_photo", f"day:{(now - timedelta(days=d)).date()}", when=now - timedelta(days=d))
    db.commit()


DEMO = [
    ("Village A (pilot)", 19.905, 99.83, [], (), False),
    ("Village B", 19.93, 99.87, [("night", 4, 0.6)], (), False),
    ("Village C", 19.88, 99.90, [("night", 2, 0.35)], (), False),
    ("Village D", 19.95, 99.80, [("house", 45, 0.05)], (), True),
]


def seed_demo(db, days=150, houses=60, now=None, community=True):
    now = (now or utcnow()).replace(minute=0, second=0, microsecond=0)
    start = now - timedelta(days=days)
    net = Network(name="Demo district network (simulated)", lat=19.92, lon=99.85)
    db.add(net)
    db.flush()
    rng = np.random.default_rng(7)
    db.add(Depot(network_id=net.id, name="Tambon office parts store", lat=19.915, lon=99.86,
                 items={"PVC pipe 1/2in (4 m)": 12, "PVC pipe 1in (4 m)": 6, "Coupling 1/2in": 30, "Coupling 1in": 15,
                        "Tap": 8, "Valve 1in": 3, "PVC glue": 5}))
    for name, lat, lon in [("Anan", 19.91, 99.84), ("Boonmee", 19.94, 99.88), ("Chai", 19.89, 99.89)]:
        person(db, None, name, "technician", network_id=net.id, demo=name == "Anan", lat=lat, lon=lon)
    out = []
    for k, (name, lat, lon, leaks, outages, silent) in enumerate(DEMO):
        lk = []
        tz = ZoneInfo("Asia/Bangkok")
        local_now = now.replace(tzinfo=ZoneInfo("UTC")).astimezone(tz)
        last_night = (local_now - timedelta(hours=5)).date() - timedelta(days=1)
        for kind, ago, m3h in leaks:
            if kind == "night":
                first = last_night - timedelta(days=ago - 1)
                when = datetime(first.year, first.month, first.day, 19, tzinfo=tz).astimezone(ZoneInfo("UTC")).replace(tzinfo=None)
            else:
                when = now - timedelta(days=ago)
            lk.append(Leak(when, m3h, house=3 if kind == "house" else None))
        model = VillageModel(houses, start, days + 1, seed=100 + k, leaks=lk)
        v, main, hs, dev = seed_village(db, name, model, lat=lat, lon=lon, outages=outages, silent=silent, now=now, network_id=net.id)
        if community:
            seed_community(db, v, hs, rng, now, net.id)
        S.evaluate(db, v, now)
        out.append(v)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["seed"])
    ap.add_argument("--days", type=int, default=150)
    ap.add_argument("--houses", type=int, default=60)
    a = ap.parse_args()
    D.init()
    with D.Session() as db:
        for v in seed_demo(db, a.days, a.houses):
            alerts = S.open_alerts(db, v.id)
            print(f"{v.id}: {v.name} -> {S.village_level(alerts)} {[(x.kind, x.level) for x in alerts]}")


if __name__ == "__main__":
    main()
