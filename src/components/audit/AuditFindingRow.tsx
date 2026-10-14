import type { ComponentProps } from 'react';
import { StatusBadge, type FindingRow } from '../ui/visual-system';

export function AuditFindingRow({ severity, category, title, description, whyItMatters, recommendation, evidence = [], affectedUrls = [], impactLabel, effortLabel, confidenceLabel }: ComponentProps<typeof FindingRow>) {
  return <article className="audit-report-finding min-w-0 border-b border-border py-6">
    <div className="audit-report-finding-heading flex flex-wrap items-center gap-3"><StatusBadge tone={severity === 'critical' ? 'danger' : severity === 'high' || severity === 'medium' ? 'warning' : 'neutral'}>{severity}</StatusBadge><h3 className="min-w-0 flex-1 break-words text-base font-semibold">{title}</h3><span className="text-xs text-muted-foreground">{category}</span></div>
    <div className="audit-report-finding-body mt-4">
      {description && <p className="text-sm leading-6 text-muted-foreground">{description}</p>}
      {recommendation && <p className="mt-3 text-sm leading-7"><span className="font-semibold text-accent">Next step: </span>{recommendation}</p>}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">{[impactLabel, effortLabel, confidenceLabel].filter(Boolean).map(label => <span key={label}>{label}</span>)}</div>
      {(whyItMatters || evidence.length > 0 || affectedUrls.length > 0) && <details className="mt-4"><summary className="audit-evidence-toggle inline-flex min-h-11 cursor-pointer items-center py-2.5 text-sm font-semibold text-accent">Evidence and affected pages ({affectedUrls.length})</summary><div className="mt-4 space-y-4 border-t border-border pt-4">{whyItMatters && <div><h4 className="text-sm font-semibold">Why it matters</h4><p className="mt-2 text-sm leading-6 text-muted-foreground">{whyItMatters}</p></div>}<div className="grid gap-6 lg:grid-cols-2"><ul className="space-y-2 text-sm leading-6">{evidence.map(item => <li key={item} className="break-words">{item}</li>)}</ul><ul className="space-y-2 text-xs leading-5">{affectedUrls.map(url => <li key={url} className="break-all">{url}</li>)}</ul></div></div></details>}
    </div>
  </article>;
}
