# Worker Performance

`AuditWriteBatch` buffers page, issue, and event rows and serializes flushes from concurrent page analysis. Defaults are 5 pages, 40 issues, and 20 events per batch. Progress writes are merged and throttled to roughly one write per 1.2 seconds, while terminal state is forced immediately.

Transient Supabase network, timeout, 429, and 5xx failures are retried with bounded exponential backoff for batch writes. The worker records flush count, write operations, database write time, rows written, progress writes, and analysis time in structured completion logs.

Page requests are scheduled per host with bounded parallelism and a minimum interval. Every audit has a total resource-safe time budget. Reaching it stops new page scheduling, retains partial measured evidence, records the limitation, and still produces a report.

Cancellation and failures flush queued evidence in `finally`. Lease refresh and stale-lock recovery remain independent of result batching.
