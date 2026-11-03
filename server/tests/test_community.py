from datetime import datetime

import pytest

from namjai.models import Bill, Person, PointEntry
from namjai.sim import seed_demo

from conftest import ADMIN

NOW = datetime(2026, 11, 3, 6)


@pytest.fixture
def demo(client, session):
    vs = seed_demo(session, days=100, houses=20, now=NOW)
    return {v.name.split(" (")[0]: v for v in vs}


def login(client, vid, role):
    r = client.post("/api/demo/login", json={"village_id": vid, "role": role})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_demo_login_and_me(client, demo):
    a = demo["Village A"].id
    h = login(client, a, "resident")
    me = client.get("/api/me", headers=h).json()
    assert me["role"] == "resident" and me["meter"]["label"] == "House 1"
    assert client.get("/api/me").status_code == 401
    assert len(client.get("/api/me/bills", headers=h).json()) >= 2


def test_pin_login(client, demo):
    client.post("/api/admin/people", json={"village_id": demo["Village A"].id, "name": "Test", "phone": "0812345678", "pin": "4321"}, headers=ADMIN)
    assert client.post("/api/login", json={"phone": "0812345678", "pin": "0000"}).status_code == 401
    assert client.post("/api/login", json={"phone": "0812345678", "pin": "4321"}).json()["person"]["name"] == "Test"


def test_wallet_rules_and_two_approvals(client, demo):
    a = demo["Village A"].id
    care, com = login(client, a, "caretaker"), login(client, a, "committee")
    funds = client.get(f"/api/villages/{a}/funds").json()
    assert set(funds["wallets"]) == {"repair", "network", "rewards", "namjai"} and funds["wallets"]["repair"] > 0
    bad = [{"wallet": "repair", "direction": "income", "amount": 10, "kind": "water_fee"},
           {"wallet": "rewards", "direction": "expense", "amount": 10, "kind": "repair_cost"},
           {"wallet": "rewards", "direction": "income", "amount": 10, "kind": "water_fee"}]
    for body in bad:
        assert client.post(f"/api/villages/{a}/funds", json=body, headers=care).status_code == 422
    assert client.post(f"/api/villages/{a}/funds", json={"wallet": "repair", "direction": "expense", "amount": 100, "kind": "parts"}).status_code == 401
    before = funds["wallets"]["repair"]
    eid = client.post(f"/api/villages/{a}/funds", json={"wallet": "repair", "direction": "expense", "amount": 100, "kind": "parts"}, headers=care).json()["id"]
    assert client.post(f"/api/funds/{eid}/approve", headers=care).status_code == 409
    assert client.get(f"/api/villages/{a}/funds").json()["wallets"]["repair"] == before
    assert client.post(f"/api/funds/{eid}/approve", headers=com).json()["status"] == "approved"
    assert client.get(f"/api/villages/{a}/funds").json()["wallets"]["repair"] == round(before - 100, 2)


def test_namjai_pays_a_bill_and_keeps_people_private(client, demo, session):
    a = demo["Village A"].id
    com = login(client, a, "committee")
    assert client.get(f"/api/villages/{a}/namjai/candidates", headers=login(client, a, "resident")).status_code == 403
    latest = session.query(Bill).filter(Bill.village_id == a, Bill.paid_via.is_(None)).first() or session.query(Bill).filter(Bill.village_id == a, Bill.paid_via == "self").first()
    latest.status, latest.paid_at, latest.paid_via = "unpaid", None, None
    session.commit()
    cands = client.get(f"/api/villages/{a}/namjai/candidates", headers=com).json()
    summary = client.get(f"/api/villages/{a}/namjai").json()
    assert "Anonymous" in [d["name"] for d in summary["board"]] and "A neighbour" not in str(summary)
    bid = cands[0]["id"]
    eid = client.post(f"/api/bills/{bid}/namjai", headers=com).json()["fund_entry"]
    other = session.query(Person).filter(Person.village_id == a, Person.role == "committee", Person.demo.is_(False)).first()
    from namjai.community import make_token
    r = client.post(f"/api/funds/{eid}/approve", headers={"Authorization": f"Bearer {make_token(other.id)}"})
    assert r.json()["status"] == "approved"
    session.expire_all()
    assert session.get(Bill, bid).paid_via == "namjai"
    after = client.get(f"/api/villages/{a}/namjai").json()
    assert after["bills_covered"] == summary["bills_covered"] + 1
    assert all("meter" not in str(t) for t in after["thanks"])


def test_repairs_and_verified_points(client, demo, session):
    b, c = demo["Village B"].id, demo["Village C"].id
    jobs = client.get(f"/api/villages/{b}/repairs").json()
    assert jobs[0]["source"] == "system" and jobs[0]["kind"] == "leak_detected" and jobs[0]["litres_per_day"] > 0
    res = login(client, c, "resident")
    job = client.post(f"/api/villages/{c}/repairs", json={"kind": "leak", "note": "pipe at soi 2"}, headers=res).json()
    assert job["status"] == "open"
    assert client.patch(f"/api/repairs/{job['id']}", json={"status": "done"}, headers=res).status_code == 403
    tech = login(client, c, "technician")
    near = client.get(f"/api/repairs/{job['id']}/technicians").json()
    assert near["technicians"][0]["km"] is not None and near["depots"]
    assigned = client.patch(f"/api/repairs/{job['id']}", json={"status": "fixing"}, headers=tech).json()
    assert assigned["technician"] == "Anan"
    before = client.get("/api/me/points", headers=res).json()["total"]
    done = client.patch(f"/api/repairs/{job['id']}", json={"status": "done", "verified": True, "depot_id": near["depots"][0]["id"],
                                                            "parts": [{"name": "Coupling 1/2in", "qty": 2}]}, headers=tech).json()
    assert done["status"] == "done"
    assert client.get("/api/me/points", headers=res).json()["total"] == before + 50
    client.patch(f"/api/repairs/{job['id']}", json={"status": "done", "verified": True}, headers=tech)
    assert client.get("/api/me/points", headers=res).json()["total"] == before + 50
    depot = client.get(f"/api/repairs/{job['id']}/technicians").json()["depots"][0]
    assert depot["items"]["Coupling 1/2in"] == 28


def test_points_and_bills(client, demo):
    a = demo["Village A"].id
    board = client.get(f"/api/villages/{a}/leaderboard", params={"month": "2026-10"}).json()
    assert board["guardians"] and board["guardians"][0]["points"] > 0
    res = login(client, a, "resident")
    pts = client.get("/api/me/points", headers=res).json()
    assert client.post("/api/me/redeem", json={"reward_id": "tambon_certificate"}, headers=res).status_code == (201 if pts["total"] >= 100 else 409)
    care = login(client, a, "caretaker")
    unpaid = client.get(f"/api/villages/{a}/bills", params={"status": "unpaid"}, headers=care).json()
    assert client.get(f"/api/villages/{a}/bills", headers=res).status_code == 403
    if unpaid:
        paid = client.post(f"/api/bills/{unpaid[0]['id']}/pay", headers=care).json()
        assert paid["status"] == "paid" and paid["paid_via"] == "self"
        assert client.post(f"/api/bills/{unpaid[0]['id']}/pay", headers=care).status_code == 409


def test_network_view(client, demo):
    nid = demo["Village A"].network_id
    n = client.get(f"/api/networks/{nid}").json()
    assert len(n["villages"]) == 4 and n["depots"] and len(n["technicians"]) == 3
    assert {v["level"] for v in n["villages"]} == {"green", "yellow", "red"}
