import type { BlogAutomationDashboard, BlogReadinessDiagnostic, BlogProviderTestResult } from '../../lib/blog/client';
import type { BlogGenerationJob } from '../../lib/blog/types';

export function providerErrorAction(code: string) {
  switch (code) {
    case 'GROQ_NOT_CONFIGURED': return 'Add the Groq API credential to the environment serving this deployment, then redeploy and test the provider.';
    case 'GROQ_DISABLED': return 'Check GROQ_BLOG_ENABLED=true in the deployment and explicitly enable Groq jobs in Blog Studio.';
    case 'GROQ_AUTH_FAILED': return 'Check or replace the Groq API credential in this deployment, redeploy, then test the provider again.';
    case 'GROQ_MODEL_PERMISSION_DENIED':
    case 'GROQ_MODEL_UNAVAILABLE': return 'Check access to the configured structured and writer models in Groq, update the Vercel model configuration if needed, then redeploy.';
    case 'GROQ_RATE_LIMITED': return 'Check Groq usage and rate limits. Wait before retrying the failed job.';
    case 'GROQ_TIMEOUT':
    case 'GROQ_UNAVAILABLE': return 'Check provider availability and deployment logs, then test again before retrying.';
    case 'GROQ_INVALID_RESPONSE':
    case 'GROQ_SCHEMA_VALIDATION_FAILED':
    case 'GROQ_OUTPUT_TOO_LARGE': return 'Review the failed stage and model response in system diagnostics before retrying the job.';
    default: return 'Review Sources and system diagnostics and the deployment logs for this failure before retrying.';
  }
}

export function blogReadiness(dashboard: BlogAutomationDashboard | null) {
  const blockers: BlogReadinessDiagnostic[] = [];
  const warnings: BlogReadinessDiagnostic[] = [];
  if (!dashboard) return { generationReady: false, oneClickReady: false, blockers, warnings, label: 'Status unavailable' };
  const { provider } = dashboard;
  const runtime = dashboard.runtime || dashboard.overview.runtime;
  if (runtime) {
    blockers.push(...runtime.blockers);
    if (!runtime.automaticPublishingAllowed) warnings.push({ code: 'BLOG_AUTOMATIC_PUBLICATION_UNAVAILABLE', message: 'Scheduled automatic publication is not allowed.', action: 'Review the saved Autopilot and publication policy. Administrator-triggered drafts do not require automatic publication to be enabled.' });
  } else {
    if (!provider.configured) blockers.push({ code: 'GROQ_NOT_CONFIGURED', message: 'This deployment does not report a Groq API key.', action: providerErrorAction('GROQ_NOT_CONFIGURED') });
    if (provider.serverEnabled === false) blockers.push({ code: 'GROQ_SERVER_DISABLED', message: 'Groq generation is disabled in this deployment.', action: 'Set GROQ_BLOG_ENABLED=true in the intended Vercel environment and redeploy. This does not enable automatic publication.' });
    if (provider.adminEnabled === false) blockers.push({ code: 'GROQ_ADMIN_DISABLED', message: 'Groq jobs are disabled in Blog Studio.', action: 'Enable Groq jobs in Advanced AI controls and save settings when you are ready to allow generation.' });
    if (!provider.enabled && provider.serverEnabled !== false && provider.adminEnabled !== false) blockers.push({ code: 'GROQ_DISABLED', message: 'Groq generation is disabled in the deployment or Blog Studio.', action: providerErrorAction('GROQ_DISABLED') });
    warnings.push({ code: 'BLOG_DISPATCH_UNVERIFIED', message: 'This overview does not report dispatcher readiness.', action: 'Check Sources and system diagnostics if a job remains queued. A configured key alone does not verify execution.' });
  }
  if (provider.lastErrorCode && ![...blockers, ...warnings].some(item => item.code === provider.lastErrorCode)) warnings.push({ code: provider.lastErrorCode, message: `Last provider check: ${provider.health || 'attention required'}.`, action: providerErrorAction(provider.lastErrorCode) });
  if (!provider.lastSuccessAt && !provider.lastErrorCode) warnings.push({ code: 'GROQ_NOT_TESTED', message: 'Provider connectivity has not been verified.', action: 'Run Test provider in Advanced AI controls. Key presence is not proof of model access.' });
  if (dashboard.overview.stalledVercelJobs > 0) warnings.push({ code: 'BLOG_STALLED_JOBS', message: `${dashboard.overview.stalledVercelJobs} stalled Vercel ${dashboard.overview.stalledVercelJobs === 1 ? 'job' : 'jobs'} reported.`, action: 'Open Sources and system to inspect dispatch and failed stages before retrying.' });
  const providerReady = provider.enabled && provider.configured && provider.serverEnabled !== false && provider.adminEnabled !== false;
  const generationReady = runtime ? providerReady && runtime.generationAllowed && runtime.dispatchConfigured && runtime.providerConfigured && runtime.providerEnabled : providerReady;
  const oneClickReady = generationReady && runtime?.oneClickAllowed !== false;
  return { generationReady, oneClickReady, blockers, warnings, runtime, label: !generationReady ? 'Generation blocked' : !oneClickReady ? 'Drafting available' : runtime ? 'Generation available' : 'Provider configured' };
}

export function providerTestPassed(result: BlogProviderTestResult) {
  return result.status === 'connected' && !result.errorCode;
}

export function blogJobStatus(job: BlogGenerationJob) {
  if (job.state === 'published') return { label: 'Published', tone: 'success' as const };
  if (job.state === 'ready_for_review') return { label: 'Ready for review', tone: 'warning' as const };
  if (job.state === 'failed') return { label: 'Failed', tone: 'danger' as const };
  if (job.state === 'cancelled') return { label: 'Cancelled', tone: 'neutral' as const };
  if (job.state === 'skipped') return { label: 'Skipped', tone: 'neutral' as const };
  if (job.state === 'scheduled') return { label: 'Scheduled', tone: 'warning' as const };
  if (job.state === 'queued' || job.workflowStage === 'queued') return { label: 'Queued', tone: 'neutral' as const };
  if (['discovering', 'researching', 'briefing'].includes(job.state)) return { label: 'Researching', tone: 'accent' as const };
  if (job.state === 'publishing') return { label: 'Publishing', tone: 'accent' as const };
  if (['validating', 'checking_originality', 'optimising', 'sourcing_images', 'prerendering'].includes(job.state)) return { label: 'Checking', tone: 'accent' as const };
  return { label: 'Writing', tone: 'accent' as const };
}

export function validBlogSourceUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password && Boolean(url.hostname) && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}
