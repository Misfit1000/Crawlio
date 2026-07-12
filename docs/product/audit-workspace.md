# Audit Workspace

Each stored audit has a routed workspace at `/app/audits/:auditId/:section`. A shared provider loads one owner-checked result snapshot, subscribes to Supabase Realtime only while the audit is active, and removes the subscription at terminal status.

Overview shows the final measured score, pages, findings, response observations, scoring explanation, priority distribution, top fixes, and comparison controls. SEO, technical, crawlability, internal-links, performance, passive-security, and pages routes filter the same shared result instead of independently fetching or inventing data.

Finding cards explain what happened, why it matters, how to fix it, and technical evidence. Wide screens use balanced two-column evidence grids; narrow screens use one column. Page tables use horizontal overflow instead of clipping.

The live guest route remains available during a free audit. Opening the account workspace requires sign-in and the API still verifies ownership.
