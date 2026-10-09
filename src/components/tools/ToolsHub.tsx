import { ArrowRight } from 'lucide-react';
import { Link } from '../../app/router';
import { PUBLIC_TOOLS } from '../public/public-pages.mjs';
import '../public/public-pages.css';

export default function ToolsHub() {
  return <div className="min-w-0 space-y-8">
    <header className="public-page-heading"><h1 data-route-focus-target>Free SEO tools</h1><p>Work locally with metadata, robots rules, structured data and headers. Pasted content stays in this browser tab.</p></header>
    <div className="public-directory-grid">{PUBLIC_TOOLS.map(tool => <Link key={tool.slug} to={`/tools/${tool.slug}`} className="public-directory-item"><h2>{tool.title}<ArrowRight className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" /></h2><p>{tool.description}</p></Link>)}</div>
    <p className="text-sm leading-6 text-muted-foreground">These utilities do not fetch a website or alter an audit score. <Link to="/audits" className="text-accent underline">Start an audit</Link> for page-specific evidence.</p>
  </div>;
}
