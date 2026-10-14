import { ShieldCheck } from 'lucide-react';
import AuditStartForm from './home/AuditStartForm';
import './audit/audit-report.css';

export default function SecurityAudit() {
  return <div className="audit-customer-workspace audit-spacious space-y-8 mx-auto w-full max-w-5xl">
    <header className="audit-workspace-header flex flex-col items-start justify-between gap-6 lg:flex-row"><div><div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--surface-inset)]"><ShieldCheck className="h-6 w-6 text-accent" /></div><h1 className="audit-workspace-title break-words font-bold leading-tight">Passive security review</h1><p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">Review HTTPS, browser protections, and insecure HTML references.</p></div></header>
    <AuditStartForm initialFocus="security" fixedFocus section="security" />
    <section className="grid gap-6 border-t border-border pt-8 sm:grid-cols-3" aria-label="Review coverage">{[['HTTPS', 'HTTPS delivery observations.'], ['Browser protections', 'Public response-header checks.'], ['HTML references', 'Insecure resources in collected HTML.']].map(([title, detail]) => <div key={title}><h2 className="text-base font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p></div>)}</section>
    <p className="text-xs leading-6 text-muted-foreground">Public responses only. No port scanning, attack testing, or exploitation. Unavailable evidence is unknown, not a pass.</p>
  </div>;
}
