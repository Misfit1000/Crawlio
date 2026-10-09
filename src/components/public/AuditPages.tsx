import { ArrowRight, Check, ScanSearch } from 'lucide-react';
import './public-pages.css';
import { Link } from '../../app/router';
import type { AuditFocus } from '../../lib/audit/audit-scope';
import { AUDIT_PRESETS } from './public-pages.mjs';
import AuditStartForm from '../home/AuditStartForm';
import { CATEGORY_TONES } from '../ui/category-presentation';

export default function AuditPages({ slug }: { slug?: string }) {
  const preset = AUDIT_PRESETS.find(item => item.slug === slug);
  if (preset) return <main id="main-content" className="section-shell public-task-page">
    <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted-foreground"><Link to="/audits" className="hover:text-foreground">Audits</Link><span aria-hidden="true"> / </span><span aria-current="page">{preset.title}</span></nav>
    <header className="public-page-heading"><h1 data-route-focus-target>{preset.title}</h1><p>{preset.description}</p></header>
    <div className="public-launch-layout"><AuditStartForm key={preset.slug} initialFocus={preset.focus as AuditFocus} />
    <section className="public-check-preview"><h2 className="text-lg font-semibold">What gets checked</h2><ul className="mt-5 space-y-4 text-sm">{preset.checks.map(check => <li key={check} className="flex items-start gap-3"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--category-teal)]" aria-hidden="true" />{check}</li>)}</ul><p className="mt-6 text-sm leading-6 text-muted-foreground">{preset.limitation}</p></section></div>
    <div className="mt-8 flex flex-wrap gap-4 text-sm"><Link to="/reports/example" className="quiet-button">Example report <ArrowRight className="h-4 w-4" /></Link><Link to="/pricing" className="quiet-button">Compare limits</Link></div>
  </main>;

  return <main id="main-content" className="section-shell public-task-page">
    <header className="public-page-heading"><h1 data-route-focus-target>Website audits</h1><p>Choose the checks that match your next fix.</p></header>
    <div className="public-directory-grid">{AUDIT_PRESETS.map(preset => <Link key={preset.slug} to={`/audits/${preset.slug}`} className="public-directory-item" data-tone={CATEGORY_TONES[preset.focus as keyof typeof CATEGORY_TONES] || 'cobalt'}><span className="directory-icon"><ScanSearch className="h-5 w-5" aria-hidden="true" /></span><h2>{preset.title}<ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" /></h2><p>{preset.description}</p><span className="mt-4 block text-xs text-muted-foreground">{preset.focus === 'full' ? 'Website coverage' : 'Single-page default'} / Quick by default</span></Link>)}</div>
  </main>;
}
