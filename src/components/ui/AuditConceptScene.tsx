import { useEffect, useRef, useState } from 'react';
import { ArrowRight, FileCheck2, Globe, Search, ShieldCheck, Waypoints } from 'lucide-react';

const stages = [
  { icon: Globe, title: 'Discover', detail: 'Find public pages and follow their links.', items: ['Homepage', 'Linked pages', 'Sitemap'] },
  { icon: Search, title: 'Understand', detail: 'Collect evidence across each page.', items: ['Search presentation', 'Website health', 'Browser protections'] },
  { icon: FileCheck2, title: 'Prioritize', detail: 'Turn observations into a clear next step.', items: ['Affected pages', 'Supporting evidence', 'Recommended fixes'] },
];

export function AuditConceptScene() {
  const root = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let intersecting = false;
    const update = () => setVisible(intersecting && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting; update(); });
    observer.observe(element);
    document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, []);

  return <div ref={root} className="audit-concept" data-paused={paused || !visible}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5">
      <div className="flex items-center gap-3"><Waypoints className="h-5 w-5 text-accent" /><h2 className="text-base font-semibold">How an audit works</h2><span className="text-xs text-muted-foreground">Illustrative workflow</span></div>
      <button type="button" className="quiet-button min-h-10 px-3 text-xs" onClick={() => setPaused(!paused)} aria-pressed={paused}>{paused ? 'Play animation' : 'Pause animation'}</button>
    </div>
    <svg className="concept-network" viewBox="0 0 1120 190" role="img" aria-label="Illustration: a website connects to discovered pages, checks, and an actionable report">
      <g className="concept-wires" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M180 95 H240 Q260 95 260 65 V40 H340 M260 95 H340 M260 95 V150 H340" />
        <path d="M470 40 H530 V95 H600 M470 95 H600 M470 150 H530 V95" />
        <path d="M750 95 H870" />
      </g>
      <g fill="var(--card)" stroke="var(--border)" strokeWidth="1.5">
        <rect x="15" y="48" width="165" height="94" rx="8" />
        <rect x="340" y="20" width="130" height="40" rx="6" /><rect x="340" y="75" width="130" height="40" rx="6" /><rect x="340" y="130" width="130" height="40" rx="6" />
        <rect x="600" y="48" width="150" height="94" rx="8" />
        <rect x="870" y="28" width="230" height="134" rx="8" />
      </g>
      <g fill="var(--muted-foreground)" fontSize="13" fontFamily="inherit">
        <text x="34" y="75">Your website</text><text x="359" y="46">Public pages</text><text x="359" y="101">Internal links</text><text x="359" y="156">Sitemap</text>
        <text x="622" y="76">Evidence checks</text><text x="890" y="56">Your next steps</text>
      </g>
      <g fill="var(--accent)"><rect x="34" y="89" width="65" height="7" rx="3" /><rect x="34" y="105" width="120" height="5" rx="2" opacity=".25" /><rect x="34" y="117" width="86" height="5" rx="2" opacity=".25" /></g>
      <g fill="var(--success)"><circle cx="625" cy="101" r="5" /><circle cx="644" cy="101" r="5" /><circle cx="663" cy="101" r="5" /><circle cx="890" cy="82" r="4" /><circle cx="890" cy="109" r="4" /><circle cx="890" cy="136" r="4" /></g>
      <g fill="var(--foreground)" fontSize="12" fontFamily="inherit"><text x="904" y="86">Understand the finding</text><text x="904" y="113">Inspect its evidence</text><text x="904" y="140">Plan the fix</text></g>
    </svg>
    <ol className="concept-stages">
      {stages.map((stage, index) => <li key={stage.title} className="concept-stage" style={{ '--stage': index } as React.CSSProperties}>
        <div className="concept-route" aria-hidden="true"><ArrowRight className="rotate-90 md:rotate-0" /></div>
        <div className="flex items-center gap-4"><span className="concept-icon"><stage.icon className="h-6 w-6" /></span><span className="text-xs font-semibold uppercase text-muted-foreground">Step {index + 1}</span></div>
        <h3 className="mt-5 text-2xl font-semibold">{stage.title}</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{stage.detail}</p>
        <ul className="mt-5 space-y-2">{stage.items.map((item) => <li key={item} className="flex items-center gap-3 text-sm"><span className="concept-evidence" aria-hidden="true" />{item}</li>)}</ul>
      </li>)}
    </ol>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-xs text-muted-foreground"><span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-600" />Public evidence. Passive checks. No invented results.</span><a href="#features" className="inline-flex items-center gap-2 font-semibold text-accent">Explore the checks <ArrowRight className="h-4 w-4" /></a></div>
  </div>;
}
