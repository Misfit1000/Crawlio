# Crawler Safety

All worker HTML, robots, sitemap, and passive-security fetches use `safePublicFetch`.

Protections include:

- HTTP/HTTPS only, with no embedded credentials.
- Standard ports 80 and 443 in production.
- DNS resolution timeout and address pinning for the socket connection.
- Private, loopback, link-local, carrier-grade NAT, documentation, multicast, reserved, and metadata-network address blocking for IPv4 and IPv6.
- Manual redirect handling with DNS and address validation on every hop.
- Redirect-loop and redirect-count limits.
- Request timeouts, declared and streamed response-size limits, and allowed content-type checks.
- Identity encoding to avoid decompression expansion.
- Per-host scheduling and a total audit time budget.

`SEOINTEL_ALLOW_PRIVATE_TEST_TARGETS=true` exists only for local smoke tests. Never set it on the deployed worker.

Passive Security Review is not penetration testing. The worker does not scan ports, submit exploit/SQL/XSS payloads, brute-force credentials, or discover private routes.
