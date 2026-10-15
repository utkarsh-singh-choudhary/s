"""
Machine-specific, versioned checklists.

- Which checklist applies: for PM jobs the template assigned to the machine;
  otherwise the newest active template whose task_type matches and whose
  machine_type matches the machine's type (case-insensitive). A template with
  no machine_type is a generic fallback for that task type. If nothing
  matches, the job has no checklist and nothing extra is enforced.
- Answers are PASS / FAIL / NA, with an optional reading and remark.
- What blocks completion (see `evaluate`): any unanswered required item,
  a failed required item, a missing reading where one is required, a failed
  item that needs evidence but has none, and any critical item that failed
  or was marked N/A.
"""

from sqlalchemy.orm import Session

from app.models.models import ChecklistTemplate, ChecklistTemplateItem, Machine

RESULTS = ("PASS", "FAIL", "NA")
TASK_TYPES = ("PM", "REPAIR", "INSPECTION")


def applicable_template(db: Session, machine: Machine | None, task_type: str) -> ChecklistTemplate | None:
    if not machine:
        return None
    if task_type == "PM" and machine.checklist_template_id:
        t = db.query(ChecklistTemplate).get(machine.checklist_template_id)
        if t:
            return t
    q = db.query(ChecklistTemplate).filter(ChecklistTemplate.active.is_(True), ChecklistTemplate.task_type == task_type)
    if machine.machine_type:
        t = q.filter(ChecklistTemplate.machine_type.ilike(machine.machine_type.strip())) \
             .order_by(ChecklistTemplate.version.desc(), ChecklistTemplate.created_at.desc()).first()
        if t:
            return t
    return q.filter(ChecklistTemplate.machine_type.is_(None)).order_by(ChecklistTemplate.created_at.desc()).first()


def active_items(db: Session, template: ChecklistTemplate) -> list[ChecklistTemplateItem]:
    items = db.query(ChecklistTemplateItem).filter(
        ChecklistTemplateItem.template_id == template.id, ChecklistTemplateItem.active.isnot(False)
    ).order_by(ChecklistTemplateItem.sequence).all()
    return items


def item_dict(i: ChecklistTemplateItem) -> dict:
    return {
        "id": i.id, "sequence": i.sequence, "text": i.text, "required": bool(i.required),
        "requires_reading": bool(i.requires_reading), "reading_unit": i.reading_unit,
        "critical": bool(i.critical), "evidence_on_fail": bool(i.evidence_on_fail),
    }


def normalise_answers(raw: list[dict]) -> dict:
    """Accepts new {item_id, result, reading, note} and old {item_id, checked, note} shapes."""
    out = {}
    for r in raw or []:
        iid = r.get("item_id")
        if not iid:
            continue
        result = (r.get("result") or "").upper() or ("PASS" if r.get("checked") else "FAIL")
        if result not in RESULTS:
            raise ValueError(f"Invalid result '{result}' (use PASS, FAIL or NA)")
        out[iid] = {"result": result, "reading": (str(r.get("reading")).strip() if r.get("reading") not in (None, "") else None),
                    "note": r.get("note") or None}
    return out


def evaluate(items: list[ChecklistTemplateItem], answers: dict, has_evidence: bool) -> dict:
    """Returns {"blockers": [str], "critical_fails": [item]}"""
    blockers, critical_fails = [], []
    for i in items:
        a = answers.get(i.id)
        label = i.text
        if a is None:
            if i.required or i.critical:
                blockers.append(f"Not answered: {label}")
            continue
        res = a["result"]
        if i.critical and res == "FAIL":
            critical_fails.append(i)
            blockers.append(f"Critical check failed: {label}")
            continue
        if i.critical and res == "NA":
            blockers.append(f"Critical check cannot be N/A: {label}")
            continue
        if i.required and res == "FAIL":
            blockers.append(f"Required check failed: {label}")
        if i.requires_reading and res != "NA" and not a.get("reading"):
            unit = f" ({i.reading_unit})" if i.reading_unit else ""
            blockers.append(f"Reading required{unit}: {label}")
        if i.evidence_on_fail and res == "FAIL" and not has_evidence:
            blockers.append(f"Photo/file required for failed check: {label}")
    return {"blockers": blockers, "critical_fails": critical_fails}
