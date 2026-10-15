from datetime import datetime, timedelta

import pytest

from app.models.models import ChecklistTemplate, ChecklistTemplateItem


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def make_wo(client, auth, machine, who="supervisor", assign="tech", users=None, **kw):
    body = {"machine_id": machine.id, "title": "Replace bearing", "priority": "HIGH"}
    if assign and users:
        body["assigned_to"] = users[assign].id
    body.update(kw)
    r = client.post("/api/work-orders", json=body, headers=auth(who))
    assert r.status_code == 200, r.text
    return r.json()["id"]


def start(client, auth, wid, who="tech"):
    r = client.post(f"/api/work-orders/{wid}/worklog", json={"event": "START"}, headers=auth(who))
    assert r.status_code == 200, r.text


def fill_completion(client, auth, wid, who="tech", **extra):
    body = {"repair_summary": "Bearing replaced", "resolution_code": "REPLACED_PART", "diagnosis": "Seized bearing",
            "action_taken": "Swapped bearing", "downtime_minutes": 90}
    body.update(extra)
    r = client.put(f"/api/work-orders/{wid}", json=body, headers=auth(who))
    assert r.status_code == 200, r.text


def test_numbers_and_initial_status(client, auth, machine, users):
    a = make_wo(client, auth, machine, users=users)
    b = make_wo(client, auth, machine, assign=None, users=users)
    da = client.get(f"/api/work-orders/{a}", headers=auth("viewer")).json()
    db_ = client.get(f"/api/work-orders/{b}", headers=auth("viewer")).json()
    assert da["status"] == "ASSIGNED" and db_["status"] == "OPEN"
    assert db_["number"] == da["number"] + 1


def test_cannot_complete_until_everything_recorded(client, auth, machine, users):
    wid = make_wo(client, auth, machine, users=users)
    start(client, auth, wid)
    r = client.post(f"/api/work-orders/{wid}/status", json={"status": "COMPLETED"}, headers=auth("tech"))
    assert r.status_code == 400
    blockers = r.json()["detail"]["blockers"]
    assert any("repair summary" in b.lower() for b in blockers)
    assert any("labour" in b.lower() for b in blockers)
    fill_completion(client, auth, wid)
    t0 = datetime.utcnow() - timedelta(hours=3)
    r = client.post(f"/api/work-orders/{wid}/labour", json={"started_at": iso(t0), "ended_at": iso(t0 + timedelta(hours=2))},
                    headers=auth("tech"))
    assert r.status_code == 200, r.text
    assert r.json()["hours"] == 2 and r.json()["hourly_rate"] == 200
    # duplicate submit is rejected
    r2 = client.post(f"/api/work-orders/{wid}/labour", json={"started_at": iso(t0), "ended_at": iso(t0 + timedelta(hours=2))},
                     headers=auth("tech"))
    assert r2.status_code == 409
    r = client.post(f"/api/work-orders/{wid}/status", json={"status": "COMPLETED"}, headers=auth("tech"))
    assert r.status_code == 200, r.text


def test_labour_rate_is_snapshotted(client, auth, machine, users, db):
    wid = make_wo(client, auth, machine, users=users)
    start(client, auth, wid)
    client.post(f"/api/work-orders/{wid}/labour", json={"hours": 2}, headers=auth("tech"))
    users["tech"].hourly_rate = 999
    db.add(users["tech"])
    db.commit()
    client.post(f"/api/work-orders/{wid}/labour", json={"hours": 1, "technician_id": users["tech2"].id}, headers=auth("supervisor"))
    d = client.get(f"/api/work-orders/{wid}/detail", headers=auth("manager")).json()
    assert d["cost_summary"]["labour"] == 2 * 200 + 1 * 300   # first entry keeps the old 200 rate
    assert d["cost_summary"]["labour_hours"] == 3


def test_labour_validation_and_permissions(client, auth, machine, users):
    wid = make_wo(client, auth, machine, users=users)
    start(client, auth, wid)
    assert client.post(f"/api/work-orders/{wid}/labour", json={"hours": 0}, headers=auth("tech")).status_code == 400
    assert client.post(f"/api/work-orders/{wid}/labour", json={"hours": 25}, headers=auth("tech")).status_code == 400
    # a technician can't book hours for someone else
    r = client.post(f"/api/work-orders/{wid}/labour", json={"hours": 1, "technician_id": users["tech2"].id}, headers=auth("tech"))
    assert r.status_code == 403
    assert client.post(f"/api/work-orders/{wid}/labour", json={"hours": 1}, headers=auth("viewer")).status_code == 403


def test_assignment_enforced(client, auth, machine, users):
    wid = make_wo(client, auth, machine, users=users)
    r = client.post(f"/api/work-orders/{wid}/worklog", json={"event": "START"}, headers=auth("tech2"))
    assert r.status_code == 403


def test_waiting_and_resume(client, auth, machine, users):
    wid = make_wo(client, auth, machine, users=users)
    start(client, auth, wid)
    r = client.post(f"/api/work-orders/{wid}/status", json={"status": "WAITING_PARTS"}, headers=auth("tech"))
    assert r.status_code == 200 and r.json()["waiting_reason"] == "PARTS"
    r = client.post(f"/api/work-orders/{wid}/status", json={"status": "WAITING_APPROVAL", "reason": "PARTS"}, headers=auth("tech"))
    assert r.status_code == 400   # from WAITING_PARTS only resume is allowed
    r = client.post(f"/api/work-orders/{wid}/worklog", json={"event": "RESUME"}, headers=auth("tech"))
    assert r.status_code == 200 and r.json()["status"] == "IN_PROGRESS"
    r = client.post(f"/api/work-orders/{wid}/status", json={"status": "WAITING_APPROVAL"}, headers=auth("tech"))
    assert r.status_code == 400  # needs a non-parts reason
    r = client.post(f"/api/work-orders/{wid}/status", json={"status": "WAITING_APPROVAL", "reason": "VENDOR"}, headers=auth("tech"))
    assert r.status_code == 200


def test_safety_permit_blocks_start(client, auth, machine, users):
    wid = make_wo(client, auth, machine, users=users, loto_required=True, safety_risk="HIGH")
    r = client.post(f"/api/work-orders/{wid}/worklog", json={"event": "START"}, headers=auth("tech"))
    assert r.status_code == 400
    assert client.put(f"/api/work-orders/{wid}", json={"safety_confirmed": True}, headers=auth("tech")).status_code == 200
    start(client, auth, wid)


def test_complete_verify_close_and_four_eyes(client, auth, machine, users):
    wid = make_wo(client, auth, machine, users=users, safety_risk="HIGH")
    start(client, auth, wid)
    fill_completion(client, auth, wid)
    client.post(f"/api/work-orders/{wid}/labour", json={"hours": 1}, headers=auth("tech"))
    assert client.post(f"/api/work-orders/{wid}/status", json={"status": "COMPLETED"}, headers=auth("tech")).status_code == 200
    # HIGH safety jobs cannot be closed straight away
    assert client.post(f"/api/work-orders/{wid}/status", json={"status": "CLOSED"}, headers=auth("supervisor")).status_code == 400
    assert client.post(f"/api/work-orders/{wid}/status", json={"status": "VERIFIED"}, headers=auth("tech")).status_code == 403
    assert client.post(f"/api/work-orders/{wid}/status", json={"status": "VERIFIED"}, headers=auth("supervisor")).status_code == 200
    assert client.post(f"/api/work-orders/{wid}/status", json={"status": "CLOSED"}, headers=auth("supervisor")).status_code == 200
    # closed is locked
    assert client.put(f"/api/work-orders/{wid}", json={"title": "x"}, headers=auth("supervisor")).status_code == 400
    # reopen: manager only, with a reason, audited
    assert client.post(f"/api/work-orders/{wid}/reopen", json={"reason": "leak again"}, headers=auth("supervisor")).status_code == 403
    assert client.post(f"/api/work-orders/{wid}/reopen", json={"reason": "no"}, headers=auth("manager")).status_code == 400
    r = client.post(f"/api/work-orders/{wid}/reopen", json={"reason": "Leak is back after test run"}, headers=auth("manager"))
    assert r.status_code == 200 and r.json()["status"] == "IN_PROGRESS" and r.json()["reopen_count"] == 1
    logs = client.get("/api/audit-logs?action=WORK_ORDER_REOPENED", headers=auth("manager")).json()
    assert len(logs) == 1


def test_cancel_needs_reason_and_is_final(client, auth, machine, users):
    wid = make_wo(client, auth, machine, users=users)
    assert client.post(f"/api/work-orders/{wid}/cancel", json={"reason": "x"}, headers=auth("supervisor")).status_code == 400
    assert client.post(f"/api/work-orders/{wid}/cancel", json={"reason": "Duplicate of another job"}, headers=auth("tech")).status_code == 403
    assert client.post(f"/api/work-orders/{wid}/cancel", json={"reason": "Duplicate of another job"}, headers=auth("supervisor")).status_code == 200
    assert client.post(f"/api/work-orders/{wid}/reopen", json={"reason": "try to reopen"}, headers=auth("manager")).status_code == 400
    d = client.get(f"/api/work-orders/{wid}", headers=auth("viewer")).json()
    assert d["cancelled"] is True and d["cancel_reason"]


def test_parts_consume_return_idempotent_no_negative(client, auth, machine, users, part, db):
    wid = make_wo(client, auth, machine, users=users)
    # must be started first
    r = client.post(f"/api/work-orders/{wid}/consume-part", json={"spare_part_id": part.id, "quantity": 1}, headers=auth("tech"))
    assert r.status_code == 400
    start(client, auth, wid)
    body = {"spare_part_id": part.id, "quantity": 4, "request_id": "abc"}
    assert client.post(f"/api/work-orders/{wid}/consume-part", json=body, headers=auth("tech")).status_code == 200
    assert client.post(f"/api/work-orders/{wid}/consume-part", json=body, headers=auth("tech")).status_code == 200  # repeat
    db.expire_all()
    assert db.get(type(part), part.id).stock_on_hand == 6      # consumed once only
    # cannot take more than is available
    r = client.post(f"/api/work-orders/{wid}/consume-part", json={"spare_part_id": part.id, "quantity": 7}, headers=auth("tech"))
    assert r.status_code == 400
    # cannot return more than booked
    r = client.post(f"/api/work-orders/{wid}/return-part", json={"spare_part_id": part.id, "quantity": 5}, headers=auth("tech"))
    assert r.status_code == 400
    r = client.post(f"/api/work-orders/{wid}/return-part", json={"spare_part_id": part.id, "quantity": 1, "request_id": "r1"}, headers=auth("tech"))
    assert r.status_code == 200
    client.post(f"/api/work-orders/{wid}/return-part", json={"spare_part_id": part.id, "quantity": 1, "request_id": "r1"}, headers=auth("tech"))
    db.expire_all()
    assert db.get(type(part), part.id).stock_on_hand == 7
    # price changes later do not reprice the work order
    part.unit_cost = 500
    db.add(part)
    db.commit()
    d = client.get(f"/api/work-orders/{wid}/detail", headers=auth("manager")).json()
    assert d["cost_summary"]["parts"] == 3 * 100


def test_external_cost_approval_rules(client, auth, machine, users):
    wid = make_wo(client, auth, machine, users=users)
    start(client, auth, wid)
    bad = client.post(f"/api/work-orders/{wid}/costs", json={"category": "EXTERNAL_SERVICE", "description": "Rewind", "amount": 1000}, headers=auth("tech"))
    assert bad.status_code == 400   # vendor missing
    r = client.post(f"/api/work-orders/{wid}/costs", json={"category": "EXTERNAL_SERVICE", "description": "Rewind", "amount": 1000,
                                                          "tax_amount": 180, "vendor": "ABC Motors"}, headers=auth("tech"))
    cid = r.json()["id"]
    d = client.get(f"/api/work-orders/{wid}/detail", headers=auth("manager")).json()
    assert d["cost_summary"]["external_services"] == 0 and d["cost_summary"]["pending_approval"] == 1180   # not counted until approved
    assert client.post(f"/api/work-orders/{wid}/costs/{cid}/approve", json={}, headers=auth("tech")).status_code == 403
    assert client.post(f"/api/work-orders/{wid}/costs/{cid}/approve", json={}, headers=auth("supervisor")).status_code == 200
    d = client.get(f"/api/work-orders/{wid}/detail", headers=auth("manager")).json()
    assert d["cost_summary"]["external_services"] == 1180 and d["cost_summary"]["actual_total"] == 1180


def test_high_value_cost_needs_manager(client, auth, machine, users):
    wid = make_wo(client, auth, machine, users=users)
    start(client, auth, wid)
    r = client.post(f"/api/work-orders/{wid}/costs", json={"category": "OTHER", "description": "Crane hire", "amount": 90000}, headers=auth("tech"))
    cid = r.json()["id"]
    assert client.post(f"/api/work-orders/{wid}/costs/{cid}/approve", json={}, headers=auth("supervisor")).status_code == 403
    assert client.post(f"/api/work-orders/{wid}/costs/{cid}/approve", json={}, headers=auth("manager")).status_code == 200


def test_estimated_and_actual_kept_separate(client, auth, machine, users):
    wid = make_wo(client, auth, machine, users=users, estimated_cost=5000)
    start(client, auth, wid)
    client.post(f"/api/work-orders/{wid}/labour", json={"hours": 1}, headers=auth("tech"))
    d = client.get(f"/api/work-orders/{wid}/detail", headers=auth("manager")).json()
    assert d["cost_summary"]["estimated_total"] == 5000 and d["cost_summary"]["actual_total"] == 200


def _template(db, machine_type="Press", task="REPAIR"):
    t = ChecklistTemplate(name="Repair check", task_type=task, machine_type=machine_type, version=1, active=True)
    db.add(t)
    db.flush()
    items = [
        ChecklistTemplateItem(template_id=t.id, sequence=0, text="Guard refitted", required=True, active=True),
        ChecklistTemplateItem(template_id=t.id, sequence=1, text="Motor current", required=True, requires_reading=True, reading_unit="A", active=True),
        ChecklistTemplateItem(template_id=t.id, sequence=2, text="Emergency stop works", required=True, critical=True, active=True),
    ]
    db.add_all(items)
    db.commit()
    return t, items


def test_repair_checklist_enforced(client, auth, machine, users, db):
    t, items = _template(db)
    wid = make_wo(client, auth, machine, users=users)
    start(client, auth, wid)
    fill_completion(client, auth, wid)
    client.post(f"/api/work-orders/{wid}/labour", json={"hours": 1}, headers=auth("tech"))
    r = client.post(f"/api/work-orders/{wid}/status", json={"status": "COMPLETED"}, headers=auth("tech"))
    assert r.status_code == 400 and any("Not answered" in b for b in r.json()["detail"]["blockers"])
    ans = [{"item_id": items[0].id, "result": "PASS"},
           {"item_id": items[1].id, "result": "PASS"},               # reading missing
           {"item_id": items[2].id, "result": "NA"}]                 # critical cannot be NA
    assert client.post(f"/api/work-orders/{wid}/checklist", json={"answers": ans}, headers=auth("tech")).status_code == 200
    r = client.post(f"/api/work-orders/{wid}/status", json={"status": "COMPLETED"}, headers=auth("tech"))
    blockers = r.json()["detail"]["blockers"]
    assert any("Reading required" in b for b in blockers) and any("cannot be N/A" in b for b in blockers)
    ans = [{"item_id": items[0].id, "result": "PASS"}, {"item_id": items[1].id, "result": "PASS", "reading": "12.4"},
           {"item_id": items[2].id, "result": "PASS"}]
    assert client.post(f"/api/work-orders/{wid}/checklist", json={"answers": ans}, headers=auth("tech")).status_code == 200
    assert client.post(f"/api/work-orders/{wid}/status", json={"status": "COMPLETED"}, headers=auth("tech")).status_code == 200


def test_search_filters_and_totals(client, auth, machine, machine2, users):
    for i in range(6):
        make_wo(client, auth, machine if i < 4 else machine2, users=users, title=f"Job {i}", priority="LOW" if i % 2 else "HIGH")
    r = client.get("/api/work-orders/search?page_size=4", headers=auth("viewer")).json()
    assert r["total"] == 6 and len(r["items"]) == 4 and r["pages"] == 2
    assert client.get("/api/work-orders/search?q=Job 5", headers=auth("viewer")).json()["total"] == 1
    assert client.get("/api/work-orders/search?priority=HIGH", headers=auth("viewer")).json()["total"] == 3
    assert client.get(f"/api/work-orders/search?machine_id={machine2.id}", headers=auth("viewer")).json()["total"] == 2
    csv = client.get("/api/work-orders/export?format=csv", headers=auth("manager"))
    assert csv.status_code == 200 and csv.text.count("Job ") == 6
    assert client.get("/api/work-orders/export?format=csv", headers=auth("viewer")).status_code == 403
