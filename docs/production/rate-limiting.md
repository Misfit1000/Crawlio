# Durable Rate Limiting And Audit Admission

Migration 011 makes Supabase the production source of truth. `admit_audit_submission` uses a transaction advisory lock to enforce duplicate reuse, one active Free audit, daily owner limits, normalized-domain repetition limits, a soft queue warning, and a hard global queue limit.

Identifiers are authenticated user IDs, hashed guest sessions, and keyed one-way network hashes. Raw IP addresses are not stored. Configure:

- `RATE_LIMIT_HASH_SECRET` with a random server-only value;
- `GUEST_DAILY_AUDIT_LIMIT` (default 2);
- `DOMAIN_DAILY_AUDIT_LIMIT` (default 2 for guest and Free repeat audits of the same website; paid plans use their configured daily plan quota);
- `GLOBAL_ACTIVE_AUDIT_LIMIT` (default 50).

`consume_api_rate_limit` protects report exports, cancellation, deletion, blog generation, and administrator routes. HTTP 429 responses include `Retry-After`. The process-local limiter remains only an edge burst guard; it is not quota authority.

The `captchaRequired` platform flag is fail-closed. Enable it only after deploying a compatible browser token flow and `TURNSTILE_SECRET_KEY`.
