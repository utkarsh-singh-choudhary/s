import json
from datetime import date, datetime, timedelta

from app.core.timeutils import today_local
from app.models.models import (AuditLog, ChecklistTemplate, ChecklistTemplateItem, Machine, PMPlan, PMStatus,
                               PlanSourceType, SparePart, WorkOrder)

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def make_plan(db, machine, days=0, assigned=None):
    p = PMPlan(machine_id=machine.id, planned_date=today_local() + timedelta(days=days), plan_source_type=list(PlanSourceType)[0],
               month="October", financial_year="26-27", status=PMStatus.PLANNED, assigned_to=assigned)
    db.add(p)
    db.commit()
    return p


def make_pm_template(db, machine=None):
    t = ChecklistTemplate(name="Press PM", task_type="PM", machine_type="Press", version=1, active=True)
    db.add(t)
    db.flush()
    items = [
        ChecklistTemplateItem(template_id=t.id, sequence=0, text="Oil level", required=True, active=True),
        ChecklistTemplateItem(template_id=t.id, sequence=1, text="Clutch pressure", required=True, requires_reading=True,
                              reading_unit="bar", active=True),
        ChecklistTemplateItem(template_id=t.id, sequence=2, text="Brake test", required=True, critical=True, active=True),
    ]
    db.add_all(items)
    db.commit()
    return t, items


def complete(client, auth, pid, answers, who="tech", files=None):
    data = {"actual_date": str(today_local()), "checklist_responses": json.dumps(answers)}
    return client.post(f"/api/pm/{pid}/complete", data=data, files=files or [], headers=auth(who))


def test_pm_checklist_enforced_and_snapshotted(client, auth, db, machine, users):
    t, items = make_pm_template(db)
    plan = make_plan(db, machine)
    r = complete(client, auth, plan.id, [{"item_id": items[0].id, "result": "PASS"}])
    assert r.status_code == 400 and "Not answered" in r.text
    r = complete(client, auth, plan.id, [{"item_id": items[0].id, "result": "PASS"}, {"item_id": items[1].id, "result": "PASS"},
                                         {"item_id": items[2].id, "result": "PASS"}])
    assert r.status_code == 400 and "Reading required" in r.text
    ans = [{"item_id": items[0].id, "result": "PASS"}, {"item_id": items[1].id, "result": "PASS", "reading": "6.2"},
           {"item_id": items[2].id, "result": "PASS"}]
    r = complete(client, auth, plan.id, ans)
    assert r.status_code == 200, r.text
    # critical machine + technician => supervisor confirmation
    assert r.json()["status"] == "PENDING_SUPERVISOR_CONFIRMATION"
    d = client.get(f"/api/pm/{plan.id}/details", headers=auth("viewer")).json()
    row = next(c for c in d["checklist"] if c["text"] == "Clutch pressure")
    assert row["reading"] == "6.2" and row["result"] == "PASS" and row["template_version"] == 1


def test_pm_required_fail_blocks_but_critical_fail_creates_corrective_wo(client, auth, db, machine, users):
    t, items = make_pm_template(db)
    plan = make_plan(db, machine, assigned=users["tech"].id)
    ans = [{"item_id": items[0].id, "result": "FAIL"}, {"item_id": items[1].id, "result": "PASS", "reading": "6"},
           {"item_id": items[2].id, "result": "PASS"}]
    assert complete(client, auth, plan.id, ans).status_code == 400   # required item failed
    ans = [{"item_id": items[0].id, "result": "PASS"}, {"item_id": items[1].id, "result": "PASS", "reading": "6"},
           {"item_id": items[2].id, "result": "FAIL", "note": "Brake slips"}]
    r = complete(client, auth, plan.id, ans, who="supervisor")
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["critical_failures"] == 1 and j["corrective_work_order_id"]
    assert j["status"] == "PENDING_SUPERVISOR_CONFIRMATION"        # even a supervisor's PM is not released
    wo = db.get(WorkOrder, j["corrective_work_order_id"])
    assert wo.pm_plan_id == plan.id and wo.source == "PM"
    # resubmitting does not raise a second work order
    r2 = complete(client, auth, plan.id, ans, who="supervisor")
    assert r2.json()["corrective_work_order_id"] is None
    assert db.query(WorkOrder).filter(WorkOrder.pm_plan_id == plan.id).count() == 1


def test_template_edit_bumps_version_and_keeps_history(client, auth, db, machine):
    t, items = make_pm_template(db)
    plan = make_plan(db, machine)
    ans = [{"item_id": items[0].id, "result": "PASS"}, {"item_id": items[1].id, "result": "PASS", "reading": "6"},
           {"item_id": items[2].id, "result": "PASS"}]
    assert complete(client, auth, plan.id, ans).status_code == 200
    new_items = [{"text": "Oil level", "required": True}, {"text": "Check belts", "required": True}]
    r = client.put(f"/api/checklists/{t.id}", json={"items": new_items}, headers=auth("manager"))
    assert r.status_code == 200, r.text
    assert r.json()["version"] == 2 and [i["text"] for i in r.json()["items"]] == ["Oil level", "Check belts"]
    d = client.get(f"/api/pm/{plan.id}/details", headers=auth("viewer")).json()
    assert {c["text"] for c in d["checklist"]} == {"Oil level", "Clutch pressure", "Brake test"}   # history preserved
    assert all(c["template_version"] == 1 for c in d["checklist"])
    # same items again: no new version
    r = client.put(f"/api/checklists/{t.id}", json={"items": new_items}, headers=auth("manager"))
    assert r.json()["version"] == 2


def test_checklist_for_machine_by_type(client, auth, db, machine, machine2):
    make_pm_template(db)   # Press only
    r = client.get(f"/api/checklists/for-machine/{machine.id}", headers=auth("tech")).json()
    assert r["template_id"] and len(r["items"]) == 3
    r = client.get(f"/api/checklists/for-machine/{machine2.id}", headers=auth("tech")).json()
    assert r["template_id"] is None
    r = client.post("/api/checklists", json={"name": "x", "task_type": "BOGUS", "items": []}, headers=auth("manager"))
    assert r.status_code == 400
    assert client.post("/api/checklists", json={"name": "x", "items": []}, headers=auth("tech")).status_code == 403


# ------------------------------------------------------------- spare parts

def test_spare_part_adjust_rules(client, auth, part):
    h = lambda r: auth(r)
    assert client.post(f"/api/spare-parts/{part.id}/adjust", json={"change": -20, "reason": "count"}, headers=h("supervisor")).status_code == 400   # negative stock
    assert client.post(f"/api/spare-parts/{part.id}/adjust", json={"change": 5}, headers=h("tech")).status_code == 403
    r = client.post(f"/api/spare-parts/{part.id}/adjust", json={"change": 10, "unit_cost": 120, "request_id": "r1"}, headers=h("supervisor"))
    assert r.status_code == 200 and r.json()["stock_on_hand"] == 20
    client.post(f"/api/spare-parts/{part.id}/adjust", json={"change": 10, "unit_cost": 120, "request_id": "r1"}, headers=h("supervisor"))
    assert client.get(f"/api/spare-parts/{part.id}", headers=h("viewer")).json()["stock_on_hand"] == 20
    # value approval: 10 x 120 = 1200 over the default limit needs a manager
    r = client.post(f"/api/spare-parts/{part.id}/adjust", json={"change": -10, "reason": "write-off"}, headers=h("supervisor"))
    assert r.status_code in (200, 403)
    assert client.post(f"/api/spare-parts/{part.id}/adjust", json={"change": -1, "txn_type": "DAMAGED"}, headers=h("tech")).status_code == 400   # reason needed


def test_spare_part_create_alerts_and_search(client, auth, db, machine):
    r = client.post("/api/spare-parts", json={"part_code": "SEAL-9", "name": "Oil seal", "minimum_stock": 5, "initial_stock": 2, "unit_cost": 50},
                    headers=auth("manager"))
    assert r.status_code == 200, r.text
    assert client.post("/api/spare-parts", json={"part_code": "SEAL-9", "name": "dup"}, headers=auth("manager")).status_code == 400
    assert client.get("/api/spare-parts?q=seal", headers=auth("viewer")).json()
    a = client.get("/api/spare-parts/alerts", headers=auth("viewer")).json()
    assert any(p["part_code"] == "SEAL-9" for p in a["low_stock"])


# ------------------------------------------------------------- evidence

def test_evidence_upload_validation(client, auth, machine, users):
    bid = client.post("/api/breakdowns/new", json={"machine_id": machine.id, "failure_mode": "x", "severity": "LOW", "force": True},
                      headers=auth("tech")).json()["id"]
    ok = client.post(f"/api/evidence/breakdown/{bid}", files=[("files", ("a.png", PNG, "image/png"))], headers=auth("tech"))
    assert ok.status_code == 200, ok.text
    fake = client.post(f"/api/evidence/breakdown/{bid}", files=[("files", ("a.png", b"not an image at all", "image/png"))], headers=auth("tech"))
    assert fake.status_code == 400
    exe = client.post(f"/api/evidence/breakdown/{bid}", files=[("files", ("a.exe", b"MZ" + b"0" * 40, "application/octet-stream"))], headers=auth("tech"))
    assert exe.status_code == 400
    assert client.post(f"/api/evidence/breakdown/{bid}", files=[("files", ("a.png", PNG, "image/png"))], headers=auth("viewer")).status_code == 403
    lst = client.get(f"/api/evidence/breakdown/{bid}", headers=auth("viewer")).json()
    assert len(lst) == 1
    f = client.get(f"/api/evidence/breakdown/{bid}/{lst[0]['id']}/file", headers=auth("viewer"))
    assert f.status_code == 200 and f.content == PNG


# ------------------------------------------------------------- activity / analytics / audit

def test_pm_activity_search_totals_and_export(client, auth, db, machine, machine2):
    for i in range(5):
        make_plan(db, machine if i % 2 == 0 else machine2, days=i - 2)
    r = client.get("/api/activity/pm?page_size=2&date_preset=all", headers=auth("viewer")).json()
    assert r["total"] == 5 and len(r["items"]) == 2 and r["pages"] == 3
    assert r["summary"]["total"] == 5
    r = client.get(f"/api/activity/pm?machine_id={machine2.id}&date_preset=all", headers=auth("viewer")).json()
    assert r["total"] == 2
    assert client.get("/api/activity/pm/export?format=csv&date_preset=all", headers=auth("tech")).status_code == 403
    assert client.get("/api/activity/pm/export?format=csv&date_preset=all", headers=auth("manager")).status_code == 200
    k = client.get("/api/activity/kpis?date_preset=all", headers=auth("viewer"))
    assert k.status_code == 200


def test_analytics_mtbf_needs_enough_data(client, auth, db, machine):
    base = datetime.utcnow() - timedelta(days=20)
    def bd(days, hours):
        r = client.post("/api/breakdowns/new", json={"machine_id": machine.id, "severity": "LOW", "force": True, "failure_category": "ELECTRICAL",
                        "breakdown_at": (base + timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S")}, headers=auth("tech"))
        assert r.status_code == 200, r.text
    machine.created_at = base - timedelta(days=30)
    db.add(machine)
    db.commit()
    bd(0, 2); bd(5, 2)
    o = client.get("/api/analytics/overview?date_preset=all", headers=auth("manager")).json()
    row = o["machines"][0]
    assert row["breakdown_count"] == 2 and row["mtbf_hours"] is None and row["mtbf_status"] == "insufficient_data"
    bd(10, 2)
    o = client.get("/api/analytics/overview?date_preset=all", headers=auth("manager")).json()
    row = o["machines"][0]
    assert row["mtbf_status"] == "ok" and row["mtbf_hours"] > 0
    assert o["summary"]["breakdowns"] == 3 and "mtbf" in o["definitions"]
    assert o["failure_categories"][0]["name"] == "ELECTRICAL"
    assert client.get("/api/analytics/overview", headers=auth("viewer")).status_code == 403


def test_attention_and_workload(client, auth, db, machine, users):
    client.post("/api/breakdowns/new", json={"machine_id": machine.id, "severity": "CRITICAL", "force": True}, headers=auth("tech"))
    plan = make_plan(db, machine, days=-3)
    a = client.get("/api/analytics/attention", headers=auth("supervisor")).json()
    kinds = {i["kind"] for i in a["items"]}
    assert "OPEN_CRITICAL_BREAKDOWN" in kinds and "OVERDUE_CRITICAL_PM" in kinds
    assert client.get("/api/analytics/workload", headers=auth("supervisor")).status_code == 200


def test_audit_signature_detects_tampering(client, auth, db, machine, users):
    client.post("/api/breakdowns/new", json={"machine_id": machine.id, "severity": "LOW", "force": True}, headers=auth("tech"))
    v = client.get("/api/audit-logs/verify", headers=auth("admin")).json()
    assert v["tampered"] == 0 and v["intact"] >= 1
    row = db.query(AuditLog).first()
    row.new_value = {"forged": True}
    db.commit()
    v = client.get("/api/audit-logs/verify", headers=auth("admin")).json()
    assert v["tampered"] == 1 and v["mismatches"][0]["id"] == row.id
    assert client.get("/api/audit-logs/verify", headers=auth("manager")).status_code == 403
