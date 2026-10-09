import { ArrowRight, Braces, FileSearch, Link2, ShieldCheck } from 'lucide-react';
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
        <h1 data-route-focus-target>Crawlio <span>website audits.</span></h1>
        <p className="clarity-hero-description">Find the issues. See the evidence. Know what to fix.</p>
        <AuditStartForm id="start-audit" onStartAudit={onStartAudit} />
        <Link to="/reports/example" className="clarity-example-link">Explore a sample report <ArrowRight className="h-4 w-4" /></Link>
      </div>
    </section>
    <section id="features" className="section-shell home-section">
      <div className="home-section-heading"><div><h2>One website. The checks you need.</h2><p>Run a complete audit or focus on one area.</p></div><Link to="/audits" className="quiet-button">All audits <ArrowRight className="h-4 w-4" /></Link></div>
      <div className="home-capabilities">{[
        { title: 'On-page SEO', description: 'Make titles, headings and content work together.', path: '/audits/seo', icon: FileSearch, tone: 'cobalt' },
        { title: 'Crawlability', description: 'Inspect access, index directives and canonicals.', path: '/audits/crawlability', icon: Link2, tone: 'teal' },
        { title: 'Structured data', description: 'Review markup and social metadata.', path: '/audits/structured-data', icon: Braces, tone: 'cyan' },
        { title: 'Passive security', description: 'Check public HTTPS and protection headers.', path: '/audits/security', icon: ShieldCheck, tone: 'violet' },
      ].map(({title,description,path,icon:Icon,tone}) => <Link key={path} to={path} className="home-capability" data-tone={tone}><span className="home-capability-icon"><Icon className="h-6 w-6" aria-hidden="true" /></span><h3>{title}</h3><p>{description}</p><ArrowRight className="h-4 w-4 mt-5" aria-hidden="true" /></Link>)}</div>
    </section>
    <section id="example-report" className="home-report-band"><div id="reports" className="section-shell home-section home-report-layout"><div><span className="home-sample-label">Example report · Sample data</span><h2>Less guesswork.<br />More useful evidence.</h2><p>See what happened, where it happened, and what to change.</p><Link to="/reports/example" className="trust-button">Explore the report <ArrowRight className="h-4 w-4" /></Link></div><article className="home-sample-finding"><header><span>Internal links</span><span className="text-muted-foreground">Sample finding</span></header><h3>Broken internal link</h3><p className="text-muted-foreground">A link points to a page that no longer exists.</p><dl><div><dt>Affected page</dt><dd>/services</dd></div><div><dt>Evidence</dt><dd>/old-offer returned HTTP 404</dd></div><div><dt>Recommended fix</dt><dd>Update the link to its replacement or remove the obsolete link.</dd></div></dl></article></div></section>
    <section id="how-it-works" className="section-shell home-section"><div className="home-section-heading"><h2>Check. Fix. Verify.</h2><button type="button" className="quiet-button" onClick={onExploreFeatures}>Open workspace <ArrowRight className="h-4 w-4" /></button></div><ol className="home-process">{[['Choose your checks', 'One page or your website, within your allowance.'], ['Act on the evidence', 'Prioritized findings with affected pages and fixes.'], ['Verify the change', 'Rerun the same scope and compare results.']].map(([title, description], index) => <li key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{description}</p></li>)}</ol></section>
    <section className="home-destinations section-shell"><Link id="pricing" to="/pricing"><h2>Find your allowance</h2><p>Compare current plans and audit limits.</p><span>View plans <ArrowRight className="h-4 w-4" /></span></Link><Link to="/tools"><h2>Make the fix</h2><p>Metadata, structured data, robots and header tools.</p><span>Open tools <ArrowRight className="h-4 w-4" /></span></Link><Link to="/blog"><h2>Understand the why</h2><p>Practical guides to technical SEO.</p><span>Read the blog <ArrowRight className="h-4 w-4" /></span></Link></section>
    <section id="faq" className="section-shell home-section"><h2 className="mb-6 text-2xl font-semibold">Before you start</h2><div className="home-faq">{questions.map(([question, answer]) => <article key={question}><h3>{question}</h3><p>{answer}</p></article>)}</div></section>
  </main>;
}
