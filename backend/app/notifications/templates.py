def upcoming_reminder(machine_name, machine_number, planned_date, location=None, days_remaining=None):
    return (
        "PREVENTIVE MAINTENANCE REMINDER\n\n"
        f"Machine: {machine_name}\n"
        f"Machine No: {machine_number}\n"
        + (f"Location: {location}\n" if location else "")
        + f"Planned PM Date: {planned_date}\n"
        + (f"Days Remaining: {days_remaining}\n" if days_remaining is not None else "")
        + "\nPlease ensure the preventive maintenance activity is completed as scheduled."
    )


def due_tomorrow_reminder(machine_name, machine_number, planned_date):
    return (
        "PM DUE TOMORROW\n\n"
        f"Machine: {machine_name}\n"
        f"Machine No: {machine_number}\n"
        f"Planned PM Date: {planned_date}\n\n"
        "Please complete/update the PM activity."
    )


def due_today_not_updated(machine_name, machine_number, planned_date):
    return (
        "PM DUE TODAY - NOT YET UPDATED\n\n"
        f"Machine: {machine_name}\n"
        f"Machine No: {machine_number}\n"
        f"Planned PM Date: {planned_date}\n\n"
        "No actual completion has been recorded yet. Please update the status."
    )


def overdue_reminder(machine_name, machine_number, planned_date, days_overdue):
    return (
        "OVERDUE PM\n\n"
        f"Machine: {machine_number}\n"
        f"Machine Name: {machine_name}\n"
        f"Planned PM Date: {planned_date}\n"
        f"Days Overdue: {days_overdue}\n\n"
        "PM completion has not been recorded.\n"
        "Please update the maintenance status immediately."
    )


def escalation_notice(machine_name, machine_number, planned_date, days_overdue, level):
    return (
        f"ESCALATION - LEVEL {level}\n\n"
        f"Machine: {machine_name} ({machine_number})\n"
        f"Planned PM Date: {planned_date}\n"
        f"Days Overdue: {days_overdue}\n\n"
        "This preventive maintenance activity remains incomplete and has been "
        "escalated per the configured escalation policy."
    )
