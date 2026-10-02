# Audit, Vanta Black, Admin Operations and Blog Reliability

## Release Contents

- Audit overview, findings, pages and activity have addressable views, bounded evidence drawers, complete stored aggregate charts for new audits and labelled samples for historical reports.
- Motion follows collected evidence and pauses offscreen, when hidden, with reduced motion and at terminal states. Dark mode uses a black background and neutral panels.
- Admin operations use protected server routes, bounded searches, focused drawers, reasoned action dialogs, replay-safe request IDs and searchable action history. Retention requires an expiring preview; no cleanup is part of deployment.
- Blog stages continue after the HTTP response through bounded Vercel work with durable checkpoints, protected continuation and provider backoff. Readable source evidence supports claim/originality checks; critical publication gates remain enforced.
- Blog Studio distinguishes provider configuration, saved enablement, dispatch readiness and publication permission. Manual and generated articles share canonical metadata and deterministic link fixes.

## Database Order

1. `027_audit_presentation.sql`: atomic aggregates and indexed report-section filtering.
2. `028_admin_operations.sql`: guarded operations, account restrictions, resource inventory and retention previews.
3. `029_blog_completion_repair.sql`: restores optional migration013 fields absent from production without restoring its legacy provider defaults or rewriting existing jobs/articles.

All three were executed successfully in the production Supabase SQL Editor on October 1. The application/worker API contract remains 15; recorded database metadata remains 13, which meets the additive compatibility minimum of 13. No retention action, account deletion, or test-article publication was performed.

`030_blog_provider_pacing.sql` was executed successfully on October 2 before the provider-pacing release. It shares successful Groq cooldowns through the existing atomic stage checkpoint; lease checks and server-only execution remain enforced.

Deploy the compatible Render worker and Vercel application after these additive migrations. Existing audit scores and article slugs remain unchanged. Strict Autopilot retains the real editorial review threshold; deployment does not manufacture approvals.

## Focused Validation

- TypeScript completed without diagnostics.
- Production build and browser-asset secret/source-map boundary verification passed.
- Focused SQL, audit aggregation/evidence access, admin guardrail/router, blog readiness/dispatch/SEO and migration repair tests passed.
- Four audit browser journeys passed: desktop/mobile navigation and drawers, Vanta Black, motion lifecycle and evidence honesty.
- Agent-run admin/blog browser checks passed, including responsive layouts and accessibility checks.
- Dependency installation reported zero known vulnerabilities. Full unrelated suites were intentionally not rerun.

## Bundle Measurements

- Initial homepage compressed JavaScript:98,327 bytes, versus recorded99,671 bytes (1.35% lower).
- CSS:105,598 bytes, versus recorded106,280 bytes (0.64% lower); also below the original111,314-byte budget.
- Stable API entry:2,852 bytes; initial static server dependencies:1,328,712 bytes. Heavy handlers remain split.
- These are build measurements, not field LCP/INP measurements or claims of production database savings.

Production canonical origin was corrected to `https://crawlio1.vercel.app`. Verify the deployed commit, worker heartbeat, current provider connection and saved generation settings after release. The future low-cost tools remain a separate proposal in `docs/LOW_COST_FEATURE_ROADMAP.md`.

## Production Follow-Up

The application and Render worker deployed commit `70116ca` successfully. Saved Groq generation and discovery settings were enabled while preserving editorial review and the real Autopilot approval threshold. A live dual-model check identified the retired Llama writer override; the follow-up switches the default and Vercel override to `openai/gpt-oss-120b` and gives the writer connectivity check a reasoning-compatible token budget. No test article was published.

Commit `49966a6` deployed to both services and the live Groq check passed. A real, private SEO guide reached writing but exposed the free-tier token limit. The follow-up splits writing and complete claim validation into durable section checkpoints with bounded request context and provider-aware pacing. Completed sections are retained across retries, and every assembled article claim remains in the validation plan. The Operations overview uses the application's authoritative additive schema minimum rather than falsely treating recorded schema 13 as incompatible with API 15. Recorded versions and strict worker checks remain unchanged.

Follow-up validation: 16 focused blog checkpoint, cooldown, retry and SQL permission tests passed; TypeScript and the production API build passed. Invalid structured output retries through the durable queue instead of enlarging the prompt in an immediate repair request. The initial static API size remains 1,328,712 bytes. External provider calls in the tests were mocked; completion of the real private draft remains a separate production check.

The public homepage was verified with a pure black body background, no horizontal overflow at1280 pixels, the correct canonical host and administrator audit selectors at their configured1,000-page allowance. Unattended publication remains locked by the existing real approval threshold. No field performance benchmark or guarantee of Google indexing is claimed.
