from datetime import datetime, timedelta

import cv2

from namjai import services as S
from namjai.models import Village
from namjai.sim import ClipSim, VillageModel, seed_demo
from namjai_ocr import synth

from conftest import ADMIN


def setup_village(client, roi=None):
    vid = client.post("/api/admin/villages", json={"name": "Test"}, headers=ADMIN).json()["id"]
    mid = client.post("/api/admin/meters", json={"village_id": vid, "kind": "main", "label": "Main", "n_digits": 6, "scale": 0.1,
                                                 "max_flow": 40, "roi": roi}, headers=ADMIN).json()["id"]
    dev = client.post("/api/admin/devices", json={"id": "clip-test", "meter_id": mid}, headers=ADMIN).json()
    return vid, mid, dev


def test_admin_requires_token(client):
    assert client.post("/api/admin/villages", json={"name": "x"}).status_code == 401


def test_heartbeat_auth_and_commands(client):
    _, _, dev = setup_village(client)
    hdr = {"Authorization": f"Bearer {dev['token']}", "X-Device": dev["id"]}
    assert client.post("/api/clip/heartbeat", json={}, headers={**hdr, "Authorization": "Bearer wrong"}).status_code == 401
    client.patch(f"/api/admin/devices/{dev['id']}", json={"interval": 900, "capture_now": True}, headers=ADMIN)
    assert client.post("/api/clip/heartbeat", json={"fw": "t"}, headers=hdr).json() == {"interval": 900, "capture_now": True}
    assert client.post("/api/clip/heartbeat", json={"fw": "t"}, headers=hdr).json() == {"interval": 900}


def test_clip_end_to_end(client):
    model = VillageModel(30, datetime(2026, 10, 1), 3, seed=5)
    sim = ClipSim(client.post, "clip-test", "", seed=3)
    vid, mid, dev = setup_village(client, sim.roi)
    sim.token = dev["token"]
    t = datetime(2026, 10, 1, 3)
    first = sim.capture(t, model.main_at(t))
    assert [r.status_code for r in first] == [201, 201]
    pending = client.get("/api/readings/pending", params={"village_id": vid}).json()
    assert len(pending) == 1 and pending[0]["status"] == "pending"
    truth = round(int(model.main_at(t) / 0.1) * 0.1, 1)
    assert client.post(f"/api/readings/{pending[0]['id']}/confirm", json={"value": truth, "by": "caretaker"}).status_code == 200
    statuses = []
    for h in range(1, 25):
        when = t + timedelta(hours=h)
        sim.capture(when, model.main_at(when), online=not (5 <= h < 9))
    rows = client.get(f"/api/meters/{mid}/readings", params={"limit": 100}).json()
    statuses = [r["status"] for r in rows]
    assert len(rows) == 25
    assert statuses.count("auto") >= 18
    wrong = [r for r in rows if r["status"] == "auto" and abs(r["value"] - int(model.main_at(datetime.fromisoformat(r["taken_at"][:-1])) / 0.1) * 0.1) > 0.15]
    assert not wrong
    dup = client.post("/api/clip/photo", content=b"x", headers={**sim.headers(), "X-Seq": "1", "X-Light": "a", "X-Captured-At": "0"})
    assert dup.status_code == 409


def test_phone_photo_needs_confirmation(client):
    vid = client.post("/api/admin/villages", json={"name": "T"}, headers=ADMIN).json()["id"]
    mid = client.post("/api/admin/meters", json={"village_id": vid, "kind": "house", "label": "H1"}, headers=ADMIN).json()["id"]
    import numpy as np
    rng = np.random.default_rng(1)
    img, box, value, n = synth.sample_counter(rng, synth.fonts(synth.TRAIN_FONTS), "clear", True, 5)
    jpeg = cv2.imencode(".jpg", img)[1].tobytes()
    r = client.post(f"/api/meters/{mid}/photo", files={"file": ("m.jpg", jpeg, "image/jpeg")})
    assert r.status_code == 201 and r.json()["status"] == "pending" and r.json()["suggested"] is not None
    ok = client.post(f"/api/readings/{r.json()['id']}/confirm", json={"value": value})
    assert ok.json()["status"] == "confirmed"
    bad = client.post(f"/api/meters/{mid}/readings", json={"value": value - 5})
    assert bad.status_code == 409 and "decreased" in bad.json()["detail"]["issues"]


def test_demo_villages(client, session):
    now = datetime(2026, 11, 3, 6)
    vs = seed_demo(session, days=150, houses=40, now=now)
    levels = {v.name.split(" (")[0]: (S.village_level(S.open_alerts(session, v.id)), sorted(a.kind for a in S.open_alerts(session, v.id))) for v in vs}
    assert levels["Village A"] == ("green", [])
    assert levels["Village B"] == ("red", ["leak"])
    assert levels["Village C"] == ("yellow", ["leak"])
    assert levels["Village D"][1] == ["clip_silent", "house_high"]
    b = [v for v in vs if v.name == "Village B"][0]
    bal = client.get(f"/api/villages/{b.id}/balance", params={"month": "2026-09"}).json()
    assert bal["supplied_m3"] > bal["billed_m3"] > 0 and bal["houses_read"] == 40
    st = client.get(f"/api/villages/{b.id}/status").json()
    assert st["level"] == "red" and st["leak"]["litres_per_day"] > 0
    assert len(client.get(f"/api/villages/{b.id}/hourly", params={"days": 2}).json()["points"]) == 48
