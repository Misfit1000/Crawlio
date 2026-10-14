import { Accessibility, ArrowRight, Braces, FileSearch, Link2, ShieldCheck, TriangleAlert } from 'lucide-react';
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
  ['What can I audit?', 'Public websites and pages. Private networks and sign-in-only content are excluded.'],
  ['Will every page be checked?', 'This page checks one URL. Website coverage follows discoverable pages within your allowance.'],
  ['What does a focused score mean?', 'Only selected, measured checks contribute. Unavailable checks are not passes.'],
  ['Does Crawlio measure rankings or Core Web Vitals?', 'Search performance needs provider data. HTML response timing is not browser-measured Core Web Vitals.'],
];

export default function LandingPage({ onStartAudit, onExploreFeatures }: Props) {
  return <main id="main-content" className="w-full bg-background text-foreground">
    <section id="product" className="clarity-hero">
      <div className="clarity-hero-content section-shell">
        <h1 data-route-focus-target>Website audits.<br /><span>Clear next steps.</span></h1>
        <p className="clarity-hero-description">Find technical, content and accessibility issues. Know what to fix first.</p>
        <AuditStartForm id="start-audit" onStartAudit={onStartAudit} />
      </div>
      <div id="how-it-works" className="section-shell"><AuditConceptScene /></div>
    </section>
    <section id="example-report" className="home-report-band"><div id="reports" className="section-shell home-section">
      <div className="home-section-heading"><div><span className="mb-2 block text-xs font-semibold text-muted-foreground">Sample report</span><h2>From findings to fixes.</h2></div><Link to="/reports/example" className="clarity-example-link">Explore the report <ArrowRight className="h-4 w-4" /></Link></div>
      <div className="home-report-layout">
        <div className="home-sample-score relative aspect-square"><svg className="h-full w-full" viewBox="0 0 160 160" role="img" aria-label="Example audit score: 84 out of 100, sample data"><circle cx="80" cy="80" r="68" fill="none" stroke="var(--border)" strokeWidth="12" /><circle cx="80" cy="80" r="68" fill="none" stroke="var(--chart-success)" strokeWidth="12" strokeLinecap="round" strokeDasharray="359 428" transform="rotate(-90 80 80)" /></svg><div className="absolute inset-0 flex flex-col items-center justify-center"><strong className="text-5xl font-bold leading-tight">84</strong><span className="text-xs text-muted-foreground">Sample data</span></div></div>
        <div className="home-sample-factors grid gap-7">{[{label:'Technical',value:78,Icon:Braces,tone:'cobalt'},{label:'Content',value:88,Icon:FileSearch,tone:'teal'},{label:'Accessibility',value:90,Icon:Accessibility,tone:'cyan'}].map(({label,value,Icon,tone}) => <div key={label} data-tone={tone}><Icon className="h-6 w-6 text-accent" aria-hidden="true" /><span className="text-sm font-medium">{label}</span><div className="h-2 overflow-hidden rounded-full bg-border"><i className="block h-full rounded-full bg-[var(--tone)]" style={{width:`${value}%`}} /></div><strong className="text-sm font-medium">{value}</strong></div>)}</div>
        <div className="home-sample-fixes"><h3 className="mb-3 text-sm">Top fixes <span className="font-normal text-muted-foreground">(sample)</span></h3>{['Add missing meta descriptions','Fix broken internal links','Improve heading structure','Add alt text to images'].map(fix => <Link className="flex min-h-11 items-center gap-2.5 text-sm hover:text-accent" key={fix} to="/reports/example"><TriangleAlert className="h-4 w-4 shrink-0 text-[var(--warning)]" aria-hidden="true" /><span className="flex-1">{fix}</span><ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /></Link>)}</div>
      </div>
    </div></section>
    <section id="features" className="section-shell home-section">
      <div className="home-section-heading"><div><h2>One website. The checks you need.</h2><p>Run a complete audit or focus on one area.</p></div><div className="flex flex-wrap gap-3"><button type="button" className="quiet-button" onClick={onExploreFeatures}>Open workspace <ArrowRight className="h-4 w-4" /></button><Link to="/audits" className="quiet-button">All audits <ArrowRight className="h-4 w-4" /></Link></div></div>
      <div className="home-capabilities">{[
        { title: 'On-page SEO', description: 'Make titles, headings and content work together.', path: '/audits/seo', icon: FileSearch, tone: 'cobalt' },
        { title: 'Crawlability', description: 'Inspect access, index directives and canonicals.', path: '/audits/crawlability', icon: Link2, tone: 'teal' },
        { title: 'Structured data', description: 'Review markup and social metadata.', path: '/audits/structured-data', icon: Braces, tone: 'cyan' },
        { title: 'Passive security', description: 'Check public HTTPS and protection headers.', path: '/audits/security', icon: ShieldCheck, tone: 'violet' },
      ].map(({title,description,path,icon:Icon,tone}) => <Link key={path} to={path} className="home-capability" data-tone={tone}><span className="home-capability-icon"><Icon className="h-6 w-6" aria-hidden="true" /></span><h3>{title}</h3><p>{description}</p><ArrowRight className="h-4 w-4 mt-5" aria-hidden="true" /></Link>)}</div>
    </section>
    <section className="home-destinations section-shell"><Link id="pricing" to="/pricing"><h2>Find your allowance</h2><p>Compare current plans and audit limits.</p><span>View plans <ArrowRight className="h-4 w-4" /></span></Link><Link to="/tools"><h2>Make the fix</h2><p>Metadata, structured data, robots and header tools.</p><span>Open tools <ArrowRight className="h-4 w-4" /></span></Link><Link to="/blog"><h2>Understand the why</h2><p>Practical guides to technical SEO.</p><span>Read the blog <ArrowRight className="h-4 w-4" /></span></Link></section>
    <section id="faq" className="section-shell home-section"><h2 className="mb-6 text-2xl font-semibold">Before you start</h2><div className="home-faq">{questions.map(([question, answer]) => <article key={question}><h3>{question}</h3><p>{answer}</p></article>)}</div></section>
  </main>;
}
