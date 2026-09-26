import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import { handleTabListKeyDown } from '../../lib/ui/keyboard';

type Tone = 'info' | 'success' | 'warning' | 'danger' | 'security';

export function PageHeader({
  title,
  description,
  eyebrow,
  icon: Icon,
  actions,
  metadata,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  metadata?: ReactNode;
}) {
  return (
    <header className="page-header flex flex-col gap-5 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {(eyebrow || Icon) && (
          <div className="page-eyebrow mb-3">
            {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
            {eyebrow && <span>{eyebrow}</span>}
          </div>
        )}
        <h1 className="text-2xl font-semibold leading-tight sm:text-3xl">{title}</h1>
        {description && <p className="page-description mt-3">{description}</p>}
        {metadata && <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">{metadata}</div>}
      </div>
      {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function PageSection({
  title,
  description,
  action,
  children,
  className = '',
  id,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`space-y-5 ${className}`} aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id={id ? `${id}-title` : undefined} className="text-2xl font-semibold leading-tight">{title}</h2>
          {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

export function Panel({
  children,
  className = '',
  interactive = false,
  as: Element = 'div',
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  as?: 'div' | 'section' | 'article' | 'nav';
}) {
  return <Element className={`suite-panel ${interactive ? 'interactive-panel' : ''} ${className}`}>{children}</Element>;
}

export function FormField({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: ReactNode;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-foreground">{label}</label>
      {children}
      {error ? <p className="text-sm text-red-600 dark:text-red-300">{error}</p> : hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function Notice({ tone = 'info', title, children, className = '' }: { tone?: Tone; title?: string; children: ReactNode; className?: string }) {
  const styles: Record<Tone, string> = {
    info: 'border-blue-500/20 bg-blue-500/7 text-blue-900 dark:text-blue-100',
    success: 'border-emerald-500/20 bg-emerald-500/8 text-emerald-900 dark:text-emerald-100',
    warning: 'border-amber-500/25 bg-amber-500/10 text-amber-900 dark:text-amber-100',
    danger: 'border-red-500/25 bg-red-500/10 text-red-900 dark:text-red-100',
    security: 'border-violet-500/25 bg-violet-500/8 text-violet-900 dark:text-violet-100',
  };
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'warning' ? TriangleAlert : tone === 'danger' ? AlertCircle : Info;
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`flex gap-3 rounded-xl border p-4 text-sm leading-6 ${styles[tone]} ${className}`}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div>{title && <div className="font-semibold">{title}</div>}<div className={title ? 'mt-1' : ''}>{children}</div></div>
    </div>
  );
}

export function ResponsiveTable({ children, minWidth = 760, label }: { children: ReactNode; minWidth?: number; label?: string }) {
  return (
    <div className="max-w-full overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
      <div style={{ minWidth }}>{children}</div>
    </div>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-muted p-1" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          onKeyDown={handleTabListKeyDown}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={`min-h-10 whitespace-nowrap rounded-lg px-4 text-sm font-semibold ${value === option.value ? 'bg-card text-accent shadow-sm' : 'text-muted-foreground hover:text-foreground'} disabled:cursor-not-allowed disabled:opacity-45`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
