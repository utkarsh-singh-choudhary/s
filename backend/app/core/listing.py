"""
Shared list helpers: date presets, From/To semantics, pagination, sorting and
CSV/Excel export, so PM plans, breakdowns, work orders and reports all filter
the same way.

Dates travel as ISO (YYYY-MM-DD) in the API and the database. dd-mm-yyyy is
display only (the frontend, and the exported files).
"""

import csv
import io
from datetime import date, datetime, time, timedelta

from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from app.core.timeutils import today_local

PRESETS = ("all", "today", "last_7_days", "this_month", "previous_month", "this_fy", "custom")


def financial_year_bounds(today: date) -> tuple[date, date]:
    """Indian financial year: 1 April - 31 March."""
    start_year = today.year if today.month >= 4 else today.year - 1
    return date(start_year, 4, 1), date(start_year + 1, 3, 31)


def resolve_range(preset: str | None, date_from: date | None, date_to: date | None,
                  today: date | None = None) -> tuple[date | None, date | None]:
    """Inclusive (start, end). None on a side means unbounded."""
    today = today or today_local()
    preset = (preset or ("custom" if (date_from or date_to) else "all")).lower()
    if preset not in PRESETS:
        raise HTTPException(400, f"Unknown date preset '{preset}'. Use one of: {', '.join(PRESETS)}")
    if preset == "all":
        return None, None
    if preset == "today":
        return today, today
    if preset == "last_7_days":
        return today - timedelta(days=6), today
    if preset == "this_month":
        start = today.replace(day=1)
        nxt = (start + timedelta(days=32)).replace(day=1)
        return start, nxt - timedelta(days=1)
    if preset == "previous_month":
        end = today.replace(day=1) - timedelta(days=1)
        return end.replace(day=1), end
    if preset == "this_fy":
        return financial_year_bounds(today)
    # custom
    if date_from and date_to and date_from > date_to:
        raise HTTPException(400, "'From' date cannot be after 'To' date")
    return date_from, date_to


def day_start(d: date) -> datetime:
    return datetime.combine(d, time.min)


def day_end_exclusive(d: date) -> datetime:
    """To-date is inclusive: compare with '< next day 00:00' so the whole last day counts."""
    return datetime.combine(d + timedelta(days=1), time.min)


def apply_date_range(query, column, start: date | None, end: date | None, is_datetime: bool = False):
    if start:
        query = query.filter(column >= (day_start(start) if is_datetime else start))
    if end:
        query = query.filter(column < day_end_exclusive(end)) if is_datetime else query.filter(column <= end)
    return query


def page_params(page: int, page_size: int, max_size: int = 200) -> tuple[int, int]:
    return max(1, page), min(max(1, page_size), max_size)


def paginate(query, page: int, page_size: int) -> tuple[list, int, int, int]:
    """Count first (the TOTAL of matching rows, not just this page), then slice."""
    page, page_size = page_params(page, page_size)
    total = query.order_by(None).count()
    pages = max(1, -(-total // page_size))
    page = min(page, pages)
    rows = query.offset((page - 1) * page_size).limit(page_size).all()
    return rows, total, page, pages


def fmt_date(v) -> str:
    if v is None or v == "":
        return ""
    if isinstance(v, datetime):
        return v.strftime("%d-%m-%Y %H:%M")
    if isinstance(v, date):
        return v.strftime("%d-%m-%Y")
    return str(v)


def export_response(rows: list[dict], columns: list[tuple[str, str]], fmt: str, filename: str):
    """columns = [(key, heading)]. Dates are written dd-mm-yyyy."""
    fmt = (fmt or "csv").lower()
    data = [[fmt_date(r.get(k)) if isinstance(r.get(k), (date, datetime)) else ("" if r.get(k) is None else r.get(k))
             for k, _ in columns] for r in rows]
    heads = [h for _, h in columns]
    if fmt == "xlsx":
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.append(heads)
        for row in data:
            ws.append([_excel_safe(c) for c in row])
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return StreamingResponse(
            buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}.xlsx"'})
    if fmt != "csv":
        raise HTTPException(400, "format must be csv or xlsx")
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(heads)
    for row in data:
        w.writerow([_excel_safe(c) for c in row])
    return StreamingResponse(
        iter(["﻿" + buf.getvalue()]), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}.csv"'})


def _excel_safe(v):
    """Stop spreadsheet formula injection from user-entered text (=, +, -, @ at the start)."""
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@"):
        return "'" + v
    return v
