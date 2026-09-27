from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "postgresql://pm_user:pm_password@localhost:5432/pm_system"

    JWT_SECRET: str = "dev-secret-change-me"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 480

    TIMEZONE: str = "Asia/Kolkata"
    APP_URL: str = "http://localhost:3000"
    API_URL: str = "http://localhost:8000"
    ENV: str = "development"

    EMAIL_PROVIDER: str = "smtp_generic"  # m365 | gmail | smtp_generic
    NOTIFICATIONS_ENABLED: bool = True

    MS365_TENANT_ID: str = ""
    MS365_CLIENT_ID: str = ""
    MS365_CLIENT_SECRET: str = ""
    MS365_SENDER_ADDRESS: str = ""

    GMAIL_CLIENT_ID: str = ""
    GMAIL_CLIENT_SECRET: str = ""
    GMAIL_REFRESH_TOKEN: str = ""
    GMAIL_SENDER_ADDRESS: str = ""

    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    EMAIL_FROM: str = ""

    WHATSAPP_API_URL: str = ""
    WHATSAPP_API_TOKEN: str = ""

    # Comma-separated list of management emails for the monthly report
    REPORT_RECIPIENTS: str = ""

    # Comma-separated list of allowed frontend origins for CORS. In production
    # this MUST be the real frontend origin(s) (e.g. https://pm.yourcompany.com) -
    # "*" is refused outright when ENV=production (see main.py's startup check).
    CORS_ORIGINS: str = "http://localhost:3000"

    # Where PM proof-of-work attachments (photos, filled checklists) are
    # written. MUST be a persistent volume in production, not /tmp - a
    # container recreate/restart wipes /tmp, and these files are treated as
    # audit evidence of completed maintenance. Point this at a mounted
    # volume (see docker-compose.yml's pm_attachments volume) or, better,
    # swap the storage functions in app/core/attachment_storage.py for an
    # S3/Azure Blob client.
    ATTACHMENT_DIR: str = "/data/pm_attachments"

    # Simple in-memory login rate limit (per backend process/instance - see the
    # "scale to multiple instances" note in README for why this isn't a
    # complete brute-force defense on its own; pair with a reverse-proxy or
    # WAF-level rate limit in a multi-instance deployment).
    LOGIN_RATE_LIMIT_ATTEMPTS: int = 5
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: int = 60

    # Locked business rule: week-code -> calendar date convention
    # W1 = 1-7, W2 = 8-14, W3 = 15-21, W4 = 22-28, W5 = 29-end of month
    WEEK_BAND_SIZE_DAYS: int = 7


settings = Settings()
