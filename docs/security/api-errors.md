# Safe API Errors

Unexpected failures pass through the central API mapper and return:

```json
{"success":false,"error":{"code":"INTERNAL_REQUEST_FAILURE","message":"The request could not be completed. Please try again.","requestId":"..."}}
```

Known audit and admission errors use stable customer-safe codes and appropriate status codes. HTTP 429 includes `Retry-After`.

Internal details are written to the service-role-only `api_error_logs` table with request ID, route, authenticated user ID when available, internal code, timestamp, and deployment version. Redaction removes bearer tokens and common credential assignments. Normal responses never include SQL text, table/column names, file paths, stack traces, provider internals, worker IDs, or secrets.

When `SENTRY_DSN` is configured, the same central mapper captures only unexpected 5xx defects. Expected 400, 401, 403, 404, 409, and 429 responses are not Sentry errors. The Sentry event contains the safe route template/path, method, operation, request ID, runtime/service tags, environment, and release. It does not contain authorization headers, cookies, request bodies, customer HTML, exports, user identity, or secret values.

The complete monitoring privacy policy and source-map boundary are documented in `docs/operations/sentry.md`.
