FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run as a non-root user - the default root user in a container is an
# unnecessary privilege escalation surface if the app is ever compromised.
# Pre-create the attachment mount point and chown it BEFORE switching users:
# Docker copies a fresh named volume's initial ownership from the image
# directory it's mounted over, so this has to happen here, not at runtime -
# otherwise the volume would mount as root-owned and every upload would 500.
RUN useradd --create-home --uid 1000 appuser \
    && mkdir -p /data/pm_attachments \
    && chown -R appuser:appuser /app /data/pm_attachments
USER appuser

EXPOSE 8000

CMD alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000
