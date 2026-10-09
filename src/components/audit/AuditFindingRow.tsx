import type { ComponentProps } from 'react';
import { StatusBadge, type FindingRow } from '../ui/visual-system';

export function AuditFindingRow({ severity, category, title, description, whyItMatters, recommendation, evidence = [], affectedUrls = [], impactLabel, effortLabel, confidenceLabel }: ComponentProps<typeof FindingRow>) {
  return <article className="min-w-0 border-b border-border py-5">
    <div className="flex flex-wrap items-center gap-2"><StatusBadge tone={severity === 'critical' ? 'danger' : severity === 'high' || severity === 'medium' ? 'warning' : 'neutral'}>{severity}</StatusBadge><span className="text-xs font-semibold text-muted-foreground">{category}</span>{[impactLabel, effortLabel, confidenceLabel].filter(Boolean).map(label => <span key={label} className="text-xs text-muted-foreground">{label}</span>)}</div>
    <h3 className="mt-3 text-base font-semibold">{title}</h3>
    {description && <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>}
    <div className="mt-4 grid gap-4 lg:grid-cols-2">{whyItMatters && <div><h4 className="text-xs font-semibold text-muted-foreground">Why it matters</h4><p className="mt-1 text-sm leading-6">{whyItMatters}</p></div>}{recommendation && <div><h4 className="text-xs font-semibold text-accent">Recommended fix</h4><p className="mt-1 text-sm leading-6">{recommendation}</p></div>}</div>
    {(evidence.length > 0 || affectedUrls.length > 0) && <details className="mt-4"><summary className="w-fit cursor-pointer text-xs font-semibold text-accent">Stored evidence and affected pages ({affectedUrls.length})</summary><div className="mt-3 grid gap-4 border-t border-border pt-3 lg:grid-cols-2"><ul className="space-y-2 text-sm leading-6">{evidence.map(item => <li key={item} className="break-words">{item}</li>)}</ul><ul className="space-y-2 text-xs leading-5">{affectedUrls.map(url => <li key={url} className="break-all">{url}</li>)}</ul></div></details>}
  </article>;
}
