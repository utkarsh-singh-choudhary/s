from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import Base, engine
from app.jobs.scheduler import start_scheduler, scheduler
from app.routers import machines, pm, import_router, health, auth, audit_router, employees, reports, admin_settings, breakdowns, checklists, work_orders, spare_parts


def _validate_production_config() -> None:
    """
    Fail fast on the dev-default settings that are safe locally but a real
    security hole in production - a misconfigured JWT secret or wide-open
    CORS should crash the app at startup, not quietly ship.
    """
    if settings.ENV != "production":
        return
    problems = []
    if settings.JWT_SECRET in ("dev-secret-change-me", "change_this_to_a_long_random_string", ""):
        problems.append("JWT_SECRET is still the development default - set a long random secret.")
    if len(settings.JWT_SECRET) < 32:
        problems.append("JWT_SECRET is shorter than 32 characters - use a longer generated secret.")
    if settings.CORS_ORIGINS.strip() in ("*", ""):
        problems.append("CORS_ORIGINS is '*' (or empty) - set it to the real frontend origin(s).")
    if "pm_password" in settings.DATABASE_URL:
        problems.append("DATABASE_URL still uses the default 'pm_password' - set a real database password.")
    if problems:
        raise RuntimeError(
            "Refusing to start with ENV=production and insecure defaults:\n- " + "\n- ".join(problems)
        )


_validate_production_config()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Schema is now managed by Alembic (see backend/alembic/). We only fall
    # back to create_all() in local dev when migrations haven't been run yet,
    # so a fresh `docker compose up` still works out of the box; production
    # should run `alembic upgrade head` as a deploy step instead and this is
    # skipped there.
    if settings.ENV == "development":
        Base.metadata.create_all(bind=engine)
    start_scheduler()
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="Preventive Maintenance Automation System", version="0.1.0", lifespan=lifespan)

_cors_origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins if _cors_origins != ["*"] else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if settings.ENV == "production":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(machines.router)
app.include_router(pm.router)
app.include_router(import_router.router)
app.include_router(audit_router.router)
app.include_router(employees.router)
app.include_router(reports.router)
app.include_router(breakdowns.router)
app.include_router(checklists.router)
app.include_router(work_orders.router)
app.include_router(spare_parts.router)
app.include_router(admin_settings.router)
