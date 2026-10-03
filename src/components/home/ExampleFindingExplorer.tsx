import { useState } from 'react';
import { handleTabListKeyDown } from '../../lib/ui/keyboard';

const examples = [
  { title: 'Broken internal link', category: 'Crawlability', impact: 'Visitors and crawlers reach a dead end.', evidence: '/services/old-offer returned HTTP 404', action: 'Restore the page, link to its replacement, or remove the obsolete link.' },
  { title: 'Unintended noindex', category: 'Indexing', impact: 'This page asks search engines not to include it in results.', evidence: 'robots meta: noindex,follow', action: 'Confirm the intended visibility, then remove noindex only if the page should appear in search.' },
  { title: 'Duplicate page titles', category: 'On-page SEO', impact: 'Distinct pages are harder to tell apart in search results.', evidence: 'Services | Example appears on multiple sample pages', action: 'Write a distinct, descriptive title for each affected page.' },
  { title: 'Avoidable redirect', category: 'Links', impact: 'The link adds an unnecessary request.', evidence: '/about redirects to /company/about', action: 'Point internal links directly to the final preferred URL.' },
];

export default function ExampleFindingExplorer() {
  const [selected, setSelected] = useState(0);
  const example = examples[selected];
  return <div className="grid gap-6 md:grid-cols-3">
    <div role="tablist" aria-label="Sample findings" className="flex gap-1 overflow-x-auto md:flex-col">{examples.map((item, index) => <button type="button" id={`sample-tab-${index}`} key={item.title} role="tab" aria-controls="sample-finding" aria-selected={selected === index} tabIndex={selected === index ? 0 : -1} onKeyDown={handleTabListKeyDown} onClick={() => setSelected(index)} className={`min-h-11 shrink-0 rounded-md p-3 text-left text-sm ${selected === index ? 'bg-card font-semibold text-accent' : ''}`}>{item.title}</button>)}</div>
    <article id="sample-finding" role="tabpanel" aria-labelledby={`sample-tab-${selected}`} className="rounded-lg border border-border bg-card p-6 md:col-span-2"><p className="text-xs font-semibold text-accent">{example.category} · Sample finding</p><h3 className="mt-3 text-2xl font-semibold">{example.title}</h3><p className="mt-2 text-sm leading-7 text-muted-foreground">{example.impact}</p><div className="mt-5 border-t border-border pt-4"><h4 className="text-sm font-semibold">Recommended fix</h4><p className="mt-2 text-sm leading-7 text-muted-foreground">{example.action}</p></div><details className="mt-5"><summary className="cursor-pointer text-xs font-semibold">Sample evidence</summary><code className="mt-3 block break-all text-xs">{example.evidence}</code></details></article>
  </div>;
}
