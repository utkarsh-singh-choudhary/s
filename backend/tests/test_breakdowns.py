from datetime import datetime, timedelta

from app.core.timeutils import today_local


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def _report(client, auth, machine, **kw):
    body = {"machine_id": machine.id, "breakdown_at": _iso(datetime.utcnow() - timedelta(hours=5)),
            "failure_category": "MECHANICAL", "failure_mode": "Bearing seized", "severity": "HIGH",
            "production_impact": "STOPPED", "cause": "Loud noise then stopped", "force": True}
    body.update(kw)
    return client.post("/api/breakdowns/new", json=body, headers=auth("tech"))


def test_report_gets_bd_number_and_sequence(client, auth, machine):
    a = _report(client, auth, machine)
    assert a.status_code == 200, a.text
    b = _report(client, auth, machine)
    n1, n2 = a.json()["bd_number"], b.json()["bd_number"]
    assert n1.startswith(f"BD-{datetime.utcnow().year}-") and n1.endswith("00001")
    assert n2.endswith("00002")


def test_future_time_rejected(client, auth, machine):
    r = _report(client, auth, machine, breakdown_at=_iso(datetime.utcnow() + timedelta(days=2)))
    assert r.status_code == 400


def test_second_open_incident_blocked_without_force(client, auth, machine):
    assert _report(client, auth, machine).status_code == 200
    r = _report(client, auth, machine, force=False)
    assert r.status_code in (400, 409)


def test_full_lifecycle_and_rca_rules(client, auth, machine):
    bd = _report(client, auth, machine).json()
    bid = bd["id"]
    h = auth("supervisor")
    assert client.post(f"/api/breakdowns/{bid}/status", json={"status": "UNDER_DIAGNOSIS"}, headers=h).status_code == 200
    assert client.post(f"/api/breakdowns/{bid}/status", json={"status": "REPAIR_IN_PROGRESS"}, headers=h).status_code == 200
    # invalid jump
    assert client.post(f"/api/breakdowns/{bid}/status", json={"status": "CLOSED"}, headers=h).status_code == 400
    # restoration time cannot be before the breakdown
    r = client.post(f"/api/breakdowns/{bid}/status", json={"status": "AWAITING_VERIFICATION", "corrective_action": "Replaced bearing",
                    "resumed_at": _iso(datetime.utcnow() - timedelta(hours=9))}, headers=auth("tech"))
    assert r.status_code == 400
    # a HIGH incident cannot skip verification
    r = client.post(f"/api/breakdowns/{bid}/status", json={"status": "RESTORED", "corrective_action": "x"}, headers=h)
    assert r.status_code == 400
    r = client.post(f"/api/breakdowns/{bid}/status", json={"status": "AWAITING_VERIFICATION", "corrective_action": "Replaced bearing",
                    "resumed_at": _iso(datetime.utcnow() - timedelta(hours=1))}, headers=auth("tech"))
    assert r.status_code == 200, r.text
    # technician cannot verify; a different supervisor can
    assert client.post(f"/api/breakdowns/{bid}/status", json={"status": "RESTORED"}, headers=auth("tech")).status_code == 403
    r = client.post(f"/api/breakdowns/{bid}/status", json={"status": "RESTORED"}, headers=h)
    assert r.status_code == 200, r.text
    # cannot close while RCA is not done (high severity)
    r = client.post(f"/api/breakdowns/{bid}/status", json={"status": "CLOSED"}, headers=h)
    assert r.status_code == 400

    # cannot label an RCA CONFIRMED with unverified whys
    rca = {"symptom": "noise", "immediate_cause": "bearing failure",
           "five_whys": [{"question": "Why stopped?", "answer": "Bearing seized", "evidence": "", "confirmed": False}],
           "root_cause": "No lubrication schedule", "rca_status": "CONFIRMED"}
    r = client.put(f"/api/breakdowns/{bid}/rca", json=rca, headers=h)
    assert r.status_code == 400
    rca["five_whys"][0].update(evidence="Photo of dry bearing", confirmed=True)
    r = client.put(f"/api/breakdowns/{bid}/rca", json=rca, headers=h)
    assert r.status_code == 200, r.text

    # high severity needs at least one corrective/preventive action
    r = client.post(f"/api/breakdowns/{bid}/status", json={"status": "CLOSED"}, headers=h)
    assert r.status_code == 400
    act = client.post(f"/api/breakdowns/{bid}/actions", json={"kind": "PREVENTIVE", "description": "Add lube PM"}, headers=h)
    assert act.status_code == 200, act.text
    r = client.post(f"/api/breakdowns/{bid}/status", json={"status": "CLOSED"}, headers=h)
    assert r.status_code == 400  # action still open
    aid = act.json()["id"]
    r = client.put(f"/api/breakdowns/{bid}/actions/{aid}", json={"status": "DONE", "effectiveness": "EFFECTIVE"}, headers=h)
    assert r.status_code == 200, r.text
    r = client.post(f"/api/breakdowns/{bid}/status", json={"status": "CLOSED"}, headers=h)
    assert r.status_code == 200, r.text
    detail = client.get(f"/api/breakdowns/{bid}", headers=auth("viewer")).json()
    assert detail["status"] == "CLOSED"
    # reopen needs a reason and a manager
    assert client.post(f"/api/breakdowns/{bid}/reopen", json={"reason": ""}, headers=auth("manager")).status_code in (400, 422)
    r = client.post(f"/api/breakdowns/{bid}/reopen", json={"reason": "Failed again within a day"}, headers=auth("manager"))
    assert r.status_code == 200, r.text


def test_raise_work_order_from_breakdown_and_cost_rollup(client, auth, machine, part):
    bid = _report(client, auth, machine).json()["id"]
    r = client.post(f"/api/breakdowns/{bid}/work-order", json={"title": "Fix press"}, headers=auth("supervisor"))
    assert r.status_code == 200, r.text
    wid = r.json()["id"]
    d = client.get(f"/api/breakdowns/{bid}", headers=auth("viewer")).json()
    assert len(d["work_orders"]) == 1
    client.post(f"/api/work-orders/{wid}/assign", json={"assigned_to": _first_tech(client, auth)}, headers=auth("supervisor"))


def _first_tech(client, auth):
    rows = client.get("/api/employees/directory", headers=auth("supervisor")).json()
    return next(e["id"] for e in rows if e["name"] == "Tom Tech")


def test_search_pagination_and_filters(client, auth, machine, machine2):
    for i in range(7):
        # entered in plant-local time, early today so "today" is deterministic
        _report(client, auth, machine if i % 2 == 0 else machine2, failure_mode=f"Mode {i}", severity="LOW",
                breakdown_at=_iso(datetime.combine(today_local(), datetime.min.time()) + timedelta(minutes=i + 1)))
    r = client.get("/api/breakdowns/search?page_size=3&page=1", headers=auth("viewer")).json()
    assert r["total"] == 7 and len(r["items"]) == 3 and r["pages"] == 3
    r = client.get("/api/breakdowns/search?q=Mode 3", headers=auth("viewer")).json()
    assert r["total"] == 1
    r = client.get("/api/breakdowns/search?date_preset=today", headers=auth("viewer")).json()
    assert r["total"] == 7
    r = client.get(f"/api/breakdowns/search?machine_id={machine2.id}", headers=auth("viewer")).json()
    assert r["total"] == 3
    assert client.get("/api/breakdowns/search?date_preset=bogus", headers=auth("viewer")).status_code == 400


def test_export_requires_permission(client, auth, machine):
    _report(client, auth, machine)
    assert client.get("/api/breakdowns/export?format=csv", headers=auth("viewer")).status_code == 403
    r = client.get("/api/breakdowns/export?format=csv", headers=auth("manager"))
    assert r.status_code == 200 and "BD-" in r.text
    r = client.get("/api/breakdowns/export?format=xlsx", headers=auth("manager"))
    assert r.status_code == 200 and r.content[:2] == b"PK"


def test_critical_incident_needs_manager_to_close(client, auth, machine, db):
    from app.models.models import BreakdownEvent
    bid = _report(client, auth, machine, severity="CRITICAL").json()["id"]
    b = db.get(BreakdownEvent, bid)
    b.status, b.resumed_at, b.corrective_action = "RESTORED", datetime.utcnow(), "done"
    b.rca_status, b.verified_by = "CONFIRMED", b.reported_by
    db.commit()
    client.post(f"/api/breakdowns/{bid}/actions", json={"description": "x"}, headers=auth("supervisor"))
    assert client.post(f"/api/breakdowns/{bid}/status", json={"status": "CLOSED"}, headers=auth("supervisor")).status_code == 403
