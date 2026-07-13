import type { BlogFreshnessStatus, BlogTrendOpportunity } from './types';

const HOUR_MS = 60 * 60 * 1000;

function validDate(value?: string | null) {
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : null;
}

export function classifyBlogFreshness(opportunity: BlogTrendOpportunity, now = new Date()) {
  const sourceTime = validDate(opportunity.updatedAt) ?? validDate(opportunity.publishedAt);
  const ageHours = sourceTime == null ? Number.POSITIVE_INFINITY : Math.max(0, (now.getTime() - sourceTime) / HOUR_MS);
  const relevant = opportunity.audienceRelevance >= 0.65;
  const authoritative = opportunity.primarySource || opportunity.sourceAuthority >= 0.8;
  let status: BlogFreshnessStatus = 'low';
  let reason = 'The item is older or does not have enough verified editorial value.';

  if (ageHours <= 48 && relevant && authoritative) {
    status = 'high';
    reason = 'Published or materially updated within 48 hours, relevant to the audience, and supported by an authoritative source.';
  } else if (ageHours <= 168 && relevant && authoritative) {
    status = 'medium';
    reason = 'Published within seven days and still useful to the audience.';
  } else if (opportunity.continuingDevelopment && relevant && authoritative) {
    status = 'medium';
    reason = 'The original item is older than 48 hours, but a documented rollout or material development is continuing.';
  } else if (!sourceTime) {
    status = 'unverified';
    reason = 'The source publication or material update date could not be verified.';
  }

  return {
    status,
    ageHours: Number.isFinite(ageHours) ? Math.round(ageHours * 10) / 10 : null,
    reason,
    expiresAt: sourceTime == null ? null : new Date(sourceTime + (status === 'high' ? 48 : 168) * HOUR_MS).toISOString(),
    newsSitemapEligible: status === 'high' && ageHours <= 48,
  };
}

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function selectAutomaticBlogOpportunities(opportunities: BlogTrendOpportunity[], now = new Date(), maximum = 2) {
  const candidates = opportunities
    .map((opportunity) => {
      const freshness = classifyBlogFreshness(opportunity, now);
      return { ...opportunity, freshnessStatus: freshness.status, ageHours: freshness.ageHours, priorityReason: freshness.reason, expiresAt: freshness.expiresAt };
    })
    .filter((opportunity) => opportunity.freshnessStatus === 'high' && !opportunity.existingCoverage && opportunity.novelty >= 0.6)
    .sort((left, right) => {
      const leftScore = left.audienceRelevance + left.sourceAuthority + left.novelty;
      const rightScore = right.audienceRelevance + right.sourceAuthority + right.novelty;
      return rightScore - leftScore;
    });

  const selected: typeof candidates = [];
  const clusters = new Set<string>();
  const intents = new Set<string>();
  for (const candidate of candidates) {
    const cluster = normalizedKey(candidate.topicCluster);
    const intent = normalizedKey(candidate.searchIntent || candidate.proposedAngle);
    if (!cluster || !intent || clusters.has(cluster) || intents.has(intent)) continue;
    selected.push(candidate);
    clusters.add(cluster);
    intents.add(intent);
    if (selected.length >= Math.max(0, Math.min(2, maximum))) break;
  }
  return selected;
}

export interface PublicationScheduleSettings {
  automaticTiming: boolean;
  timezone: string;
  preferredStartHour: number;
  preferredEndHour: number;
  minimumSpacingMinutes: number;
  delayAfterDiscoveryMinutes: number;
  maximumPostsPerDay: number;
  blackoutWeekdays?: number[];
  blackoutDates?: string[];
  fixedPublicationMinute?: number | null;
  pauseAllPublication?: boolean;
  maintenanceMode?: boolean;
}

function zonedParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday,
  };
}

export function selectAutomaticPublicationTime(input: {
  opportunity: BlogTrendOpportunity;
  now?: Date;
  existingPublicationTimes?: string[];
  settings: PublicationScheduleSettings;
}) {
  const now = input.now || new Date();
  const settings = input.settings;
  const existing = (input.existingPublicationTimes || []).map((value) => new Date(value)).filter((value) => Number.isFinite(value.getTime()));
  const freshness = classifyBlogFreshness(input.opportunity, now);
  if (settings.pauseAllPublication || settings.maintenanceMode) {
    return { scheduledAt: null, timezone: settings.timezone, reason: 'Publication is paused by an administrator.', rule: 'publication_paused', urgency: freshness.status === 'high' ? 'high' : 'normal', spacingDecision: 'not_evaluated' };
  }
  const delayMs = Math.max(0, settings.delayAfterDiscoveryMinutes) * 60_000;
  let candidate = new Date(now.getTime() + delayMs);
  const startHour = Math.max(0, Math.min(23, settings.preferredStartHour));
  const endHour = Math.max(startHour + 1, Math.min(24, settings.preferredEndHour));

  const spacingMs = Math.max(15, settings.minimumSpacingMinutes) * 60_000;
  const stepMs = 15 * 60_000;
  let found = false;
  for (let attempt = 0; attempt < 14 * 24 * 4; attempt += 1) {
    const local = zonedParts(candidate, settings.timezone);
    const fixedMinute = settings.fixedPublicationMinute == null ? null : Math.max(0, Math.min(1439, Number(settings.fixedPublicationMinute)));
    const candidateMinute = local.hour * 60 + local.minute;
    const inWindow = fixedMinute == null ? local.hour >= startHour && local.hour < endHour : candidateMinute >= fixedMinute && candidateMinute < fixedMinute + 15;
    const fixedTimeReady = settings.automaticTiming || fixedMinute != null || (local.hour === startHour && local.minute < 15);
    const sameDayCount = existing.filter((time) => zonedParts(time, settings.timezone).dateKey === local.dateKey).length;
    const blockedDay = settings.blackoutWeekdays?.includes(local.weekday) || settings.blackoutDates?.includes(local.dateKey);
    const tooClose = existing.some((time) => Math.abs(time.getTime() - candidate.getTime()) < spacingMs);
    if (inWindow && fixedTimeReady && !blockedDay && sameDayCount < Math.max(1, settings.maximumPostsPerDay) && !tooClose) { found = true; break; }
    candidate = new Date(candidate.getTime() + stepMs);
  }

  if (!found) return { scheduledAt: null, timezone: settings.timezone, reason: 'No valid publication window is available within the next 14 days.', rule: 'no_available_window', urgency: freshness.status === 'high' ? 'high' : 'normal', spacingDecision: 'conflict' };

  return {
    scheduledAt: candidate.toISOString(),
    timezone: settings.timezone,
    reason: freshness.status === 'high'
      ? 'Fresh verified topic scheduled after quality checks with configured spacing.'
      : 'Evergreen or continuing topic scheduled in the next configured publication window.',
    rule: settings.fixedPublicationMinute == null ? 'configured_publication_window' : 'fixed_publication_time',
    urgency: freshness.status === 'high' ? 'high' : 'normal',
    spacingDecision: `At least ${Math.max(15, settings.minimumSpacingMinutes)} minutes from another post.`,
  };
}

export function validateCalendarMove(input: {
  scheduledAt: string | null;
  timezone: string;
  existingPublicationTimes?: string[];
  minimumSpacingMinutes: number;
  maximumPostsPerDay: number;
  blackoutWeekdays?: number[];
  blackoutDates?: string[];
  now?: Date;
}) {
  if (input.scheduledAt == null) return { valid: true, conflicts: [] as string[] };
  const candidate = new Date(input.scheduledAt);
  if (!Number.isFinite(candidate.getTime()) || candidate.getTime() <= (input.now || new Date()).getTime()) return { valid: false, conflicts: ['Choose a future publication time.'] };
  const local = zonedParts(candidate, input.timezone);
  const conflicts: string[] = [];
  if (input.blackoutWeekdays?.includes(local.weekday) || input.blackoutDates?.includes(local.dateKey)) conflicts.push('The selected date is inside a publication blackout.');
  const existing = (input.existingPublicationTimes || []).map((value) => new Date(value)).filter((value) => Number.isFinite(value.getTime()));
  if (existing.some((value) => Math.abs(value.getTime() - candidate.getTime()) < Math.max(15, input.minimumSpacingMinutes) * 60_000)) conflicts.push('The selected time conflicts with minimum article spacing.');
  if (existing.filter((value) => zonedParts(value, input.timezone).dateKey === local.dateKey).length >= Math.max(1, input.maximumPostsPerDay)) conflicts.push('The selected day has reached its publication limit.');
  return { valid: conflicts.length === 0, conflicts };
}
