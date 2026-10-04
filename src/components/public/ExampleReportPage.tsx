import { lazy, Suspense } from 'react';
import './public-pages.css';
import { ArrowRight } from 'lucide-react';
import { Link } from '../../app/router';
import { LoadingSkeleton } from '../ui/visual-system';

const ExampleFindingExplorer = lazy(() => import('../home/ExampleFindingExplorer'));

export default function ExampleReportPage() {
  return <main id="main-content" className="section-shell public-task-page">
    <header className="public-page-heading"><p className="!text-xs !font-semibold text-accent">Sample data</p><h1 data-route-focus-target>Example website audit report</h1><p>Inspect a finding, its affected pages and the recommended fix.</p></header>
    <section id="reports" aria-label="Example findings"><Suspense fallback={<LoadingSkeleton rows={5} />}><ExampleFindingExplorer /></Suspense></section>
    <div className="mt-8 flex flex-wrap gap-4"><Link to="/audits" className="trust-button">Audit your website <ArrowRight className="h-4 w-4" /></Link><Link to="/pricing" className="quiet-button">Compare report capabilities</Link></div>
  </main>;
}
