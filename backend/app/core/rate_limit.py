"""
Minimal in-memory rate limiter for the login endpoint (brute-force / credential
stuffing protection). Deliberately dependency-free rather than pulling in a
package like slowapi.

Scope limit, stated plainly: this is per-process state. With multiple backend
instances behind a load balancer (see the scheduler note in README about the
same limitation), each instance tracks attempts independently, so the *real*
limit across the whole deployment is (this limit) x (instance count). That's
still a meaningful speed bump against a naive brute-force script, but it is
not a substitute for a reverse-proxy/WAF-level rate limit or an account
lockout policy in a multi-instance production deployment - do both.
"""

import time
from collections import defaultdict, deque

from fastapi import HTTPException, status

from app.core.config import settings

_attempts: dict[str, deque] = defaultdict(deque)


def check_login_rate_limit(key: str) -> None:
    """Raises 429 if `key` (e.g. client IP + attempted email) has exceeded the
    configured attempt budget within the configured window. Call this BEFORE
    verifying the password, and call record_login_attempt() after every
    attempt (success or failure) - failed attempts are what should count."""
    now = time.monotonic()
    window = settings.LOGIN_RATE_LIMIT_WINDOW_SECONDS
    bucket = _attempts[key]
    while bucket and now - bucket[0] > window:
        bucket.popleft()
    if len(bucket) >= settings.LOGIN_RATE_LIMIT_ATTEMPTS:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Too many login attempts. Try again in {window} seconds.",
        )


def record_login_attempt(key: str) -> None:
    _attempts[key].append(time.monotonic())
