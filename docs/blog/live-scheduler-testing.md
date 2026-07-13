# Live scheduler testing

`ALLOW_LIVE_BLOG_TEST=true npm run smoke:blog-live-scheduler` requires isolated Supabase service credentials. It verifies idempotent insertion, atomic claiming, lease recovery, rescheduling, duplicate prevention, and cleanup.

The script uses a unique test marker and deletes its job. It never changes normal counters or scheduled articles.
