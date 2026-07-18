import type { ElementType, ReactNode } from 'react';
import { AlertCircle, Inbox, Loader2 } from 'lucide-react';

export function AdminLoading({ label = 'Loading administrator data' }: { label?: string }) {
  return <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{label}</div>;
}

export function AdminEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center px-5 text-center">
      <Inbox className="h-7 w-7 text-muted-foreground" />
      <div className="mt-3 font-semibold">{title}</div>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

export function AdminError({ message }: { message: string }) {
  return <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/8 px-3 py-2 text-sm text-red-700 dark:text-red-300"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{message}</div>;
}

export function AdminMetric({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'default',
}: {
  icon: ElementType;
  label: string;
  value: ReactNode;
  detail: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const tones = {
    default: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    warning: 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
    danger: 'bg-red-500/10 text-red-600 dark:text-red-400',
  };
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        </div>
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${tones[tone]}`}><Icon className="h-4 w-4" /></span>
      </div>
      <div className="mt-3 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

export function AdminStatus({ value }: { value: string | boolean | null | undefined }) {
  const normalized = String(value ?? 'unknown').toLowerCase();
  const positive = ['active', 'completed', 'published', 'healthy', 'configured', 'true', 'passed'].includes(normalized);
  const negative = ['failed', 'suspended', 'critical', 'false', 'blocked', 'abandoned'].includes(normalized);
  const warning = ['queued', 'running', 'review', 'needs_review', 'scheduled', 'deletion requested', 'unknown'].includes(normalized);
  const className = positive
    ? 'border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300'
    : negative
      ? 'border-red-500/25 bg-red-500/8 text-red-700 dark:text-red-300'
      : warning
        ? 'border-amber-500/25 bg-amber-500/8 text-amber-700 dark:text-amber-300'
        : 'border-border bg-muted text-muted-foreground';
  return <span className={`inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${className}`}>{normalized.replace(/_/g, ' ')}</span>;
}

export function formatAdminDate(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return date.toLocaleString();
}

export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}
