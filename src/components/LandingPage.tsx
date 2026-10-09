import { ArrowRight } from 'lucide-react';
import { Link } from '../app/router';
import type { AuditMode } from '../lib/audit/audit-config';
import type { AuditScope } from '../lib/audit/audit-scope';
import { AuditConceptScene } from './ui/AuditConceptScene';
import AuditStartForm from './home/AuditStartForm';

export type LandingDestination = 'dashboard' | 'reports' | 'start-audit';
interface Props {
  onStartAudit: (url: string, mode: AuditMode, scope: AuditScope) => Promise<void> | void;
  onExploreFeatures: () => void;
  onNavigate: (destination: LandingDestination) => void;
}

const questions = [
  ['What can I audit?', 'Public websites and individual pages. Private networks and authenticated pages are not supported.'],
  ['Will every page be checked?', 'Single-page coverage checks only the submitted page. Website coverage follows discoverable pages within your allowance and selected depth.'],
  ['What does a focused score mean?', 'It describes only the selected check groups. It is not a full website health score. Unavailable checks are not treated as passes.'],
  ['Does Crawlio measure rankings or Core Web Vitals?', 'No. Search performance needs connected or imported provider data. HTML response timing is not browser-measured Core Web Vitals.'],
];

export default function LandingPage({ onStartAudit, onExploreFeatures }: Props) {
  return <main id="main-content" className="w-full bg-background text-foreground">
    <section id="product" className="clarity-hero">
      <AuditConceptScene />
      <div className="clarity-hero-content section-shell">
        <h1 data-route-focus-target>Crawlio website audits</h1>
        <p className="clarity-hero-description">Find the problem. See the evidence. Know what to fix.</p>
        <AuditStartForm id="start-audit" onStartAudit={onStartAudit} />
        <Link to="/reports/example" className="clarity-example-link">Explore a sample report <ArrowRight className="h-4 w-4" /></Link>
      </div>
    </section>
    <section id="features" className="section-shell py-11 md:py-16">
      <div className="mb-7 flex flex-wrap items-start justify-between gap-5"><h2 className="text-2xl font-semibold md:text-3xl">Check what matters now</h2><Link to="/audits" className="quiet-button">All audits <ArrowRight className="h-4 w-4" /></Link></div>
      <div className="grid gap-6 md:grid-cols-3">{[
        ['On-page SEO', 'Titles, headings, images and content signals.', '/audits/seo'],
        ['Crawlability', 'Robots rules, indexing, canonicals and sitemaps.', '/audits/crawlability'],
        ['Passive security', 'HTTPS and browser-protection observations.', '/audits/security'],
      ].map(([title, description, path]) => <article key={path} className="border-t border-border pt-5"><h3 className="text-lg font-semibold"><Link to={path}>{title}</Link></h3><p className="mt-2 text-sm leading-7 text-muted-foreground">{description}</p></article>)}</div>
    </section>
    <section id="how-it-works" className="border-y border-border bg-[var(--surface-inset)]"><div className="section-shell py-11 md:py-16"><div className="mb-7 flex flex-wrap items-center justify-between gap-5"><h2 className="text-2xl font-semibold">Check. Fix. Verify.</h2><button type="button" className="quiet-button" onClick={onExploreFeatures}>Open workspace <ArrowRight className="h-4 w-4" /></button></div><ol className="grid gap-6 md:grid-cols-3">{[['Choose your checks', 'Start with one page or discover more of your website.'], ['Work through evidence', 'Connect findings to affected pages and practical fixes.'], ['Verify your changes', 'Run the same scope again and review what changed.']].map(([title, description], index) => <li key={title}><span className="text-sm tabular-nums text-accent">0{index + 1}</span><h3 className="mt-3 text-lg font-semibold">{title}</h3><p className="mt-2 text-sm leading-7 text-muted-foreground">{description}</p></li>)}</ol></div></section>
    <section id="example-report" className="section-shell py-11 md:py-16"><div id="reports" className="grid gap-8 md:grid-cols-2"><div><h2 className="text-2xl font-semibold">From finding to fix</h2><p className="my-3 max-w-md text-sm leading-7 text-muted-foreground">Inspect sample evidence, affected pages and recommended fixes.</p><Link to="/reports/example" className="quiet-button">View example report <ArrowRight className="h-4 w-4" /></Link></div><div id="pricing"><h2 className="text-2xl font-semibold">Choose your allowance</h2><p className="my-3 max-w-md text-sm leading-7 text-muted-foreground">Compare audit depth, coverage limits and report capabilities.</p><Link to="/pricing" className="quiet-button">Plans and limits <ArrowRight className="h-4 w-4" /></Link></div></div></section>
    <section className="border-t border-border"><div className="section-shell flex flex-wrap items-center justify-between gap-5 py-8"><div><h2 className="text-xl font-semibold">Fix with local tools</h2><p className="mt-2 text-sm text-muted-foreground">Metadata, structured data, robots rules and headers.</p></div><Link to="/tools" className="quiet-button">Open tools <ArrowRight className="h-4 w-4" /></Link></div></section>
    <section id="faq" className="section-shell border-t border-border py-11 md:py-16"><h2 className="mb-6 text-2xl font-semibold">Before you start</h2>{questions.map(([question, answer]) => <details key={question} className="border-b border-border py-4"><summary className="min-h-8 cursor-pointer text-sm font-semibold">{question}</summary><p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{answer}</p></details>)}</section>
  </main>;
}
