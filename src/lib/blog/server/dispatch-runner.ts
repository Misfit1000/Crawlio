import { blogAutomationRepository } from '../automation-repository';
import type { BlogGenerationJob } from '../types';
import { getGroqBlogConfiguration } from './groq';
import { processNextVercelBlogStage } from './vercel-workflow';

const TERMINAL = new Set(['ready_for_review', 'scheduled', 'published', 'failed', 'cancelled', 'skipped']);

export function blogJobIsActive(job: BlogGenerationJob | null) {
  return Boolean(job && !TERMINAL.has(job.state) && !TERMINAL.has(job.workflowStage));
}

export function blogRuntimeReadiness(settings: Record<string, unknown>) {
  const config = getGroqBlogConfiguration();
  const blockers: Array<{ code: string; message: string; action: string }> = [];
  const dispatchConfigured = String(process.env.BLOG_DISPATCH_SECRET || '').trim().length >= 24;
  const automationEnabled = String(process.env.BLOG_AUTOMATION_ENABLED || '').trim().toLowerCase() === 'true';
  if (!config.configured) blockers.push({ code: 'GROQ_NOT_CONFIGURED', message: 'Groq credentials are not configured on this deployment.', action: 'Add the Groq API credential to Vercel Production and redeploy.' });
  if (!config.enabled) blockers.push({ code: 'GROQ_DISABLED', message: 'Groq is disabled on this deployment.', action: 'Set GROQ_BLOG_ENABLED=true in Vercel Production and redeploy.' });
  if (!settings.provider_enabled) blockers.push({ code: 'BLOG_PROVIDER_DISABLED', message: 'Groq jobs are disabled in Blog Studio.', action: 'Enable Groq jobs in Advanced AI controls, then save the settings.' });
  if (!dispatchConfigured) blockers.push({ code: 'BLOG_DISPATCH_NOT_CONFIGURED', message: 'Protected continuation dispatch is not configured.', action: 'Configure the server-only blog dispatch secret with at least 24 characters and redeploy.' });
  if (settings.pause_all_publication || settings.emergency_pause || settings.maintenance_mode) blockers.push({ code: 'BLOG_PUBLICATION_PAUSED', message: 'Blog processing is paused.', action: 'Review the saved publication pause, emergency pause, and maintenance controls.' });
  const generationAllowed = blockers.length === 0;
  const automaticPublishingAllowed = generationAllowed && automationEnabled && settings.enabled === true && settings.strict_autopilot_enabled === true
    && Number(settings.automatic_articles_approved || 0) >= Number(settings.required_reviewed_articles_before_autopublish || 30);
  return { dispatchConfigured, automationEnabled, providerEnabled: config.enabled && settings.provider_enabled === true, providerConfigured: config.configured,
    generationAllowed, oneClickAllowed: generationAllowed, automaticPublishingAllowed, blockers, cronSchedule: 'Daily at 03:15 UTC' };
}

type StageResult = Awaited<ReturnType<typeof processNextVercelBlogStage>>;

// Durable stages are committed independently; leave enough time for the longest
// stage plus a protected handoff before Vercel's 300-second deadline.
export async function runBoundedBlogDispatch(input: { requestedJobId?: string | null; budgetMs?: number } = {}, dependencies: {
  now: () => number;
  wait: (ms: number) => Promise<void>;
  process: (input: { requestedJobId?: string | null }) => Promise<StageResult>;
  getJob: (id: string) => Promise<BlogGenerationJob | null>;
} = { now: Date.now, wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), process: processNextVercelBlogStage, getJob: (id) => blogAutomationRepository.getJob(id) }) {
  const deadline = dependencies.now() + Math.max(1, Math.min(180_000, input.budgetMs ?? 180_000));
  let jobId = input.requestedJobId || null;
  let latestJob: BlogGenerationJob | null = null;
  let processedStages = 0;
  let busyWaits = 0;
  for (let step = 0; step < 64 && dependencies.now() < deadline; step += 1) {
    const result = await dependencies.process({ requestedJobId: jobId });
    if (!result.processed) {
      if (!jobId) break;
      latestJob = await dependencies.getJob(jobId);
      if (!blogJobIsActive(latestJob)) break;
      const retryDelay = latestJob?.nextRetryAt ? Date.parse(latestJob.nextRetryAt) - dependencies.now() : 5_000;
      if (retryDelay > 60_000 || ++busyWaits > 12 || dependencies.now() + Math.max(2_000, retryDelay) >= deadline) break;
      await dependencies.wait(Math.max(2_000, retryDelay));
      continue;
    }
    busyWaits = 0;
    processedStages += 1;
    latestJob = result.job;
    if (!blogJobIsActive(latestJob)) {
      if (input.requestedJobId) break;
      jobId = null;
    } else {
      jobId = latestJob!.id;
      if (latestJob!.nextRetryAt) {
        const delay = Math.max(0, Date.parse(latestJob!.nextRetryAt) - dependencies.now());
        if (delay > 60_000 || dependencies.now() + delay >= deadline) break;
        await dependencies.wait(delay);
      } else {
        await dependencies.wait(2_000);
      }
    }
  }
  return { processedStages, latestJob, pendingJobId: blogJobIsActive(latestJob) ? latestJob!.id : null };
}
