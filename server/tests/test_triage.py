from datetime import datetime

import pytest

from namjai.sim import seed_demo

NOW = datetime(2026, 11, 3, 6)


@pytest.fixture
def demo(client, session):
    return {v.name.split(" (")[0]: v for v in seed_demo(session, days=100, houses=20, now=NOW)}


def login(client, vid, role):
    return {"Authorization": f"Bearer {client.post('/api/demo/login', json={'village_id': vid, 'role': role}).json()['token']}"}


def test_triage_ranks_villages(client, demo):
    t = client.get("/api/triage").json()
    vs = t["villages"]
    assert [v["rank"] for v in vs] == list(range(1, len(vs) + 1))
    assert [v["score"] for v in vs] == sorted((v["score"] for v in vs), reverse=True)
    assert vs[0]["level"] != "green" and vs[0]["households"] > 0


def test_register_village_and_agency(client, demo):
    body = {"name": "Ban Test", "households": 42, "zones": ["North", "South", "North"], "caretaker": "Somchai", "phone": "0899990000", "pin": "1234"}
    r = client.post("/api/villages/register", json=body)
    assert r.status_code == 201, r.text
    vid, h = r.json()["village_id"], {"Authorization": f"Bearer {r.json()['token']}"}
    assert client.post("/api/villages/register", json=body).status_code == 409
    me = client.get("/api/me", headers=h).json()
    assert me["role"] == "caretaker" and me["village_id"] == vid
    card = next(v for v in client.get("/api/triage").json()["villages"] if v["id"] == vid)
    assert card["households"] == 42 and [z["name"] for z in card["zones"]] == ["North", "South"] and card["has_main_meter"]
    a = client.post(f"/api/villages/{vid}/agencies", json={"name": "Tambon office", "kind": "local", "helps_with": "pipes"})
    assert a.status_code == 201 and a.json()["verified"] is False
    assert client.post(f"/api/villages/{vid}/agencies", json={"name": "tambon office"}).status_code == 409
    assert client.post(f"/api/villages/{vid}/agencies", json={"name": "X", "kind": "army"}).status_code == 422


def test_problem_note_reaches_triage_and_chat(client, demo):
    a = demo["Village A"].id
    res, tech = login(client, a, "resident"), login(client, a, "technician")
    jid = client.post(f"/api/villages/{a}/repairs", json={"kind": "leak", "note": "road"}, headers=res).json()["id"]
    client.patch(f"/api/repairs/{jid}", json={"status": "fixing", "problem": "Pipe is under the concrete road, need a cutter"}, headers=tech)
    card = next(v for v in client.get("/api/triage").json()["villages"] if v["id"] == a)
    job = next(j for j in card["jobs"] if j["id"] == jid)
    assert job["problems"][0]["text"].startswith("Pipe is under") and job["technician"]
    chat = client.get(f"/api/villages/{a}/comments", headers=res).json()
    assert any("need a cutter" in c["text"] for c in chat)
