import { lazy, Suspense, useEffect } from 'react';
import './public-pages.css';
import { Link } from '../../app/router';
import { LoadingSkeleton } from '../ui/visual-system';
import { PUBLIC_TOOLS } from './public-pages.mjs';
import ToolsHub from '../tools/ToolsHub';

const ToolsPage = lazy(() => import('../tools/ToolsPage'));
const RobotsSandbox = lazy(() => import('../tools/RobotsSandbox'));

export default function ToolsPublicPage({ slug }: { slug?: string }) {
  const tool = PUBLIC_TOOLS.find(item => item.slug === slug);
  useEffect(() => {
    if (!tool) return;
    const title = `${tool.title} | Crawlio`;
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const url = new URL(`/tools/${tool.slug}`, canonical?.href || window.location.origin).href;
    document.title = title;
    if (canonical) canonical.href = url;
    document.querySelector('meta[property="og:url"]')?.setAttribute('content', url);
    for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) document.querySelector(selector)?.setAttribute('content', title);
    for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) document.querySelector(selector)?.setAttribute('content', tool.description);
    document.querySelector('script[type="application/ld+json"]')?.replaceChildren(document.createTextNode(JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', name: tool.title, description: tool.description, url })));
  }, [tool]);
  return <main id="main-content" className="section-shell public-task-page">
    {tool ? <>
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted-foreground"><Link to="/tools" className="hover:text-foreground">Tools</Link><span aria-hidden="true"> / </span><span aria-current="page">{tool.title}</span></nav>
      <header className="public-page-heading"><h1 data-route-focus-target>{tool.title}</h1><p>{tool.description}</p></header>
      <Suspense fallback={<LoadingSkeleton rows={5} />}>{tool.slug === 'robots' ? <RobotsSandbox /> : <ToolsPage tool={tool.slug as 'metadata' | 'structured-data' | 'headers'} />}</Suspense>
      <p className="mt-8 border-t border-border pt-5 text-sm leading-6 text-muted-foreground">{tool.limitation}</p>
    </> : <ToolsHub />}
  </main>;
}
