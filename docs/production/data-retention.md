# Data Retention

Migration 011 records retention policy rows. Current defaults are:

- verbose activity events: 30 days;
- internal diagnostics and API error logs: 30 days;
- failed anonymous audits: 7 days;
- released admission and stale control records: 7 days;
- completed page summaries: 90-day review target, not automatically removed yet;
- administrator action logs: 365 days;
- customer reports: retained until owner deletion or account deletion;
- published blog content: retained until archived.

`npm run retention:preview` is a dry run. Review counts before `npm run retention:apply`. Schedule the apply command only in a protected service-role environment. The cleanup never stores or deletes full raw HTML because Crawlio does not retain it.
