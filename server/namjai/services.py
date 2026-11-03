import hashlib
import secrets
from datetime import datetime, timedelta

import cv2
import numpy as np
from sqlalchemy import select

from namjai_ocr import read_counter
from namjai_ocr.validate import check

from . import analytics as A
from . import config
from .models import Alert, Device, Heartbeat, Meter, Photo, Reading, Village, utcnow

TRUSTED = ("auto", "confirmed")
LEVELS = {"green": 0, "yellow": 1, "red": 2}


def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


def new_token():
    return secrets.token_urlsafe(24)


def decode(jpeg):
    return cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR) if jpeg else None


def last_trusted(db, meter_id, before, exclude=None):
    q = select(Reading).where(Reading.meter_id == meter_id, Reading.status.in_(TRUSTED), Reading.taken_at <= before)
    if exclude:
        q = q.where(Reading.id != exclude)
    return db.scalars(q.order_by(Reading.taken_at.desc(), Reading.id.desc()).limit(1)).first()


def series(db, meter_id, since=None, until=None):
    q = select(Reading.taken_at, Reading.value).where(Reading.meter_id == meter_id, Reading.status.in_(TRUSTED))
    if since:
        q = q.where(Reading.taken_at >= since)
    if until:
        q = q.where(Reading.taken_at <= until)
    return A.Series(db.execute(q).all())


def expand(roi, img, k):
    h, w = img.shape[:2]
    x0, y0, x1, y1 = roi
    dx, dy = (x1 - x0) * k, (y1 - y0) * k
    return [max(0, x0 - dx), max(0, y0 - dy), min(w, x1 + dx), min(h, y1 + dy)]


def run_ocr(meter, img, prev, taken_at, guide=None):
    units = round(prev.value / meter.scale) if prev else None
    hours = (taken_at - prev.taken_at).total_seconds() / 3600 if prev else None
    args = dict(prev=units, hours=hours, max_flow=meter.max_flow / meter.scale)
    if guide is None:
        return read_counter(img, meter.n_digits, roi=meter.roi, **args)
    tries = [read_counter(img, meter.n_digits, roi=guide, **args)]
    x0, y0, x1, y1 = [int(v) for v in expand(guide, img, 0.2)]
    loose = read_counter(img[y0:y1, x0:x1], meter.n_digits, **args)
    tries.append(loose)
    return max(tries, key=lambda r: (not r.issues, r.confidence))


def _rank(status, confidence):
    return (status == "auto", confidence or 0.0)


def ingest_clip_photo(db, device, jpeg, seq, light, taken_at, estimated):
    if db.scalars(select(Photo.id).where(Photo.device_id == device.id, Photo.seq == seq, Photo.light == light)).first():
        return None
    meter = device.meter
    img = decode(jpeg)
    prev = last_trusted(db, meter.id, taken_at)
    result = run_ocr(meter, img, prev, taken_at) if img is not None else None
    photo = Photo(meter_id=meter.id, device_id=device.id, seq=seq, light=light, taken_at=taken_at, time_estimated=estimated,
                  jpeg=jpeg, ocr=result.to_dict() if result else {"error": "decode"})
    db.add(photo)
    db.flush()
    if result is None:
        db.commit()
        return None
    value = round(result.value * meter.scale, 4)
    status = "auto" if result.auto_ok else "pending"
    reading = db.scalars(select(Reading).where(Reading.device_id == device.id, Reading.seq == seq)).first()
    if reading is None:
        reading = Reading(meter_id=meter.id, device_id=device.id, seq=seq, taken_at=taken_at, source="clip")
        db.add(reading)
    elif reading.status == "confirmed" or _rank(status, result.confidence) <= _rank(reading.status, reading.confidence):
        db.commit()
        return reading
    reading.value = value if status == "auto" else None
    reading.suggested = value
    reading.confidence = result.confidence
    reading.status = status
    reading.photo_id = photo.id
    reading.issues = result.issues
    db.commit()
    return reading


def ingest_phone_photo(db, meter, jpeg, taken_at, by=None, guide=None):
    img = decode(jpeg)
    if img is None:
        raise ValueError("not an image")
    prev = last_trusted(db, meter.id, taken_at)
    result = run_ocr(meter, img, prev, taken_at, guide)
    photo = Photo(meter_id=meter.id, taken_at=taken_at, jpeg=jpeg, ocr=result.to_dict())
    db.add(photo)
    db.flush()
    reading = Reading(meter_id=meter.id, taken_at=taken_at, suggested=round(result.value * meter.scale, 4), confidence=result.confidence,
                      source="phone", status="pending", photo_id=photo.id, issues=result.issues, confirmed_by=by)
    db.add(reading)
    db.commit()
    return reading, result


def reading_issues(db, meter, value, taken_at, exclude=None):
    prev = last_trusted(db, meter.id, taken_at, exclude)
    if prev is None:
        return []
    hours = (taken_at - prev.taken_at).total_seconds() / 3600
    return check(round(value / meter.scale), round(prev.value / meter.scale), hours, meter.max_flow / meter.scale, meter.n_digits)


def confirm(db, reading, value, by, force=False):
    meter = db.get(Meter, reading.meter_id)
    issues = reading_issues(db, meter, value, reading.taken_at, reading.id)
    if issues and not force:
        return issues
    reading.value, reading.status, reading.confirmed_by, reading.issues = value, "confirmed", by, issues
    db.commit()
    return []


def add_value(db, meter, value, taken_at, source, by, force=False):
    issues = reading_issues(db, meter, value, taken_at)
    if issues and not force:
        return None, issues
    r = Reading(meter_id=meter.id, taken_at=taken_at, value=value, suggested=value, source=source, status="confirmed",
                confirmed_by=by, issues=issues)
    db.add(r)
    db.commit()
    return r, issues


def heartbeat(db, device, data, now=None):
    now = now or utcnow()
    db.add(Heartbeat(device_id=device.id, at=now, data=data))
    device.last_seen, device.last_status = now, data
    cmds = dict(device.commands or {})
    reply = {k: cmds[k] for k in ("interval", "led") if k in cmds}
    if cmds.pop("capture_now", False):
        reply["capture_now"] = True
    device.commands = cmds
    db.commit()
    return reply


def set_alert(db, village_id, kind, key, level, data, now):
    a = db.scalars(select(Alert).where(Alert.village_id == village_id, Alert.kind == kind, Alert.key == key, Alert.resolved.is_(None))).first()
    if level == "green":
        if a:
            a.resolved = now
        return None
    if a is None:
        a = Alert(village_id=village_id, kind=kind, key=key, started=now)
        db.add(a)
    a.level, a.data, a.updated = level, data, now
    return a


def leak_state(db, village, meter, now, days=45):
    cfg = A.settings(village.settings)
    s = series(db, meter.id, now - timedelta(days=days + 1), now)
    if len(s) < 2:
        return A.LeakState(learning=True)
    first = A.local(s.t[0], village.tz).date()
    last = A.local(now, village.tz).date() - timedelta(days=1)
    return A.detect_leak(A.night_flows(s, village.tz, first, last, cfg), meter.scale, cfg)


def evaluate(db, village, now=None):
    now = now or utcnow()
    cfg = A.settings(village.settings)
    meters = db.scalars(select(Meter).where(Meter.village_id == village.id)).all()
    for m in meters:
        if m.kind == "main":
            st = leak_state(db, village, m, now)
            data = {"meter_id": m.id, "started": st.started.isoformat() if st.started else None, "nights": st.streak,
                    "excess_m3h": st.excess_m3h, "litres_per_day": st.litres_per_day, "baseline_m3h": st.baseline}
            set_alert(db, village.id, "leak", f"meter:{m.id}", st.level, data, now)
        else:
            hit = A.house_anomaly(series(db, m.id), cfg)
            set_alert(db, village.id, "house_high", f"meter:{m.id}", "yellow" if hit else "green", {"meter_id": m.id, **(hit or {})}, now)
    for d in db.scalars(select(Device).join(Meter).where(Meter.village_id == village.id)).all():
        silent = d.last_seen is None or now - d.last_seen > timedelta(hours=config.SILENT_AFTER_H)
        set_alert(db, village.id, "clip_silent", f"device:{d.id}", "yellow" if silent else "green",
                  {"device_id": d.id, "meter_id": d.meter_id, "last_seen": d.last_seen.isoformat() + "Z" if d.last_seen else None,
                   "action": "photograph_main_meter"}, now)
    db.commit()
    from .community import sync_leak_jobs
    sync_leak_jobs(db, village)


def open_alerts(db, village_id):
    return db.scalars(select(Alert).where(Alert.village_id == village_id, Alert.resolved.is_(None)).order_by(Alert.started)).all()


def village_level(alerts):
    return max((a.level for a in alerts), key=LEVELS.get, default="green")


def evaluate_all(db, now=None):
    for v in db.scalars(select(Village)).all():
        evaluate(db, v, now)
