# Audit History And Comparison

Authenticated audit history comes from owner-filtered Supabase `audits` and `audit_reports` rows. Browser local storage is only a non-authoritative cache for the live guest experience.

Comparison is available for two accessible audits on the same hostname. Findings use a deterministic key built from normalized category, title, hostname, and path. The API returns new findings, resolved findings, persistent pairs, current and baseline scores, and score delta. It never compares across owners or hostnames.

Migration `008_audit_history_comparison.sql` adds non-destructive indexes for owner/date, owner/hostname/date, owner/status/date, and finding comparison keys.

Verification SQL:

```sql
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'audits_user_created_at_idx',
    'audits_user_hostname_created_at_idx',
    'audits_user_status_created_at_idx',
    'audit_issues_comparison_key_idx'
  )
order by indexname;
```
