import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

export function AuditConceptScene() {
  const root = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let inView = false;
    const update = () => setVisible(inView && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; update(); });
    if (root.current) observer.observe(root.current);
    document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, []);
  return <div ref={root} className="clarity-audit-scene" data-paused={paused || !visible}>
    <svg className="clarity-scene-desktop" viewBox="0 0 1440 800" role="img" aria-label="Illustrative audit flow: discover website pages, check evidence, and prioritize fixes">
      <g fill="none" stroke="var(--category-cyan)" strokeOpacity=".35" strokeWidth="1.5">
        <path d="M195 340 V650 Q195 674 219 674 H620 M1245 340 V650 Q1245 674 1221 674 H820" />
        <path d="M195 322 H80 V246 M195 322 V195 M195 322 H305 V240 M1245 322 H1138 V240 M1245 322 V195 M1245 322 H1360 V246" />
        <path d="M110 460 H284 V520 H126 M1160 460 H1334 V520 H1178" strokeDasharray="4 6" />
      </g>
      <g fill="var(--card)" stroke="var(--border)" strokeWidth="1.5">
        <rect x="52" y="203" width="70" height="56" rx="6" /><rect x="164" y="151" width="70" height="56" rx="6" /><rect x="272" y="203" width="70" height="56" rx="6" />
        <rect x="1110" y="203" width="70" height="56" rx="6" /><rect x="1210" y="151" width="70" height="56" rx="6" /><rect x="1325" y="203" width="70" height="56" rx="6" />
        <rect x="82" y="420" width="210" height="118" rx="8" /><rect x="1148" y="420" width="210" height="118" rx="8" />
      </g>
      <g fill="var(--category-cobalt)"><rect x="68" y="219" width="35" height="5" rx="2" /><rect x="180" y="168" width="35" height="5" rx="2" /><rect x="288" y="219" width="35" height="5" rx="2" /></g>
      <g fill="var(--border)"><rect x="68" y="233" width="26" height="4" rx="2" /><rect x="180" y="182" width="26" height="4" rx="2" /><rect x="288" y="233" width="26" height="4" rx="2" /></g>
      <g fill="var(--category-teal)"><rect x="1126" y="219" width="35" height="5" rx="2" /><rect x="1226" y="168" width="35" height="5" rx="2" /><rect x="1341" y="219" width="35" height="5" rx="2" /></g>
      <g fill="var(--category-cobalt)" opacity=".07"><rect x="52" y="203" width="70" height="56" rx="6" /><rect x="164" y="151" width="70" height="56" rx="6" /><rect x="272" y="203" width="70" height="56" rx="6" /></g>
      <g fill="var(--category-teal)" opacity=".08"><rect x="1110" y="203" width="70" height="56" rx="6" /><rect x="1210" y="151" width="70" height="56" rx="6" /><rect x="1325" y="203" width="70" height="56" rx="6" /><rect x="1148" y="420" width="210" height="118" rx="8" /></g>
      <g fill="var(--category-violet)" opacity=".1"><rect x="82" y="420" width="210" height="118" rx="8" /></g>
      <g fontSize="16" fontFamily="inherit" fontWeight="600" fill="var(--foreground)"><text x="104" y="450">Page evidence</text><text x="1170" y="450">Clear next steps</text></g>
      <g fontSize="14" fontFamily="inherit" fill="var(--muted-foreground)"><text x="104" y="476">Titles &amp; headings</text><text x="104" y="500">Links &amp; directives</text><text x="1170" y="476">Understand the issue</text><text x="1170" y="500">Find the affected page</text></g>
      <g fill="var(--category-violet)"><circle cx="266" cy="472" r="4" /><circle cx="266" cy="496" r="4" /></g>
      <g fill="var(--category-teal)"><circle cx="1332" cy="472" r="4" /><circle cx="1332" cy="496" r="4" /></g>
      <rect x="620" y="642" width="200" height="64" rx="8" fill="var(--card)" stroke="var(--border)" />
      <g fill="var(--category-cyan)"><rect x="636" y="659" width="8" height="8" rx="2" /><rect x="648" y="659" width="8" height="8" rx="2" /><rect x="636" y="671" width="8" height="8" rx="2" /><rect x="648" y="671" width="8" height="8" rx="2" /></g>
      <text x="671" y="680" fontSize="16" fontWeight="600" fill="var(--foreground)" fontFamily="inherit">Prioritize your fixes</text>
      <circle className="clarity-flow-left" cx="320" cy="674" r="4" fill="var(--category-violet)" />
      <circle className="clarity-flow-right" cx="1110" cy="674" r="4" fill="var(--category-teal)" />
      <g className="clarity-check-pulse" fill="var(--category-cyan)"><circle cx="195" cy="322" r="7" /><circle cx="1245" cy="322" r="7" /></g>
    </svg>
    <svg className="clarity-scene-mobile" viewBox="0 0 360 170" role="img" aria-label="Illustrative audit flow: discover, check, then prioritize fixes">
      <path d="M90 85 H135 M225 85 H270" fill="none" stroke="var(--border-strong)" strokeWidth="1.5" />
      <g fill="var(--card)" stroke="var(--border)" strokeWidth="1.5"><rect x="5" y="48" width="95" height="76" rx="6" /><rect x="132" y="48" width="95" height="76" rx="6" /><rect x="260" y="48" width="95" height="76" rx="6" /></g>
      <g fill="var(--muted-foreground)" textAnchor="middle" fontSize="12" fontFamily="inherit"><text x="52" y="104">Discover</text><text x="179" y="104">Check</text><text x="307" y="104">Fix</text></g>
      <g fill="var(--accent)"><rect x="30" y="64" width="44" height="4" rx="2" /><rect x="30" y="74" width="32" height="4" rx="2" /><rect x="285" y="64" width="44" height="4" rx="2" /><rect x="285" y="74" width="30" height="4" rx="2" opacity=".4" /></g>
      <path d="m169 71 7 7 13-15" fill="none" stroke="var(--success)" strokeWidth="3" />
      <g className="clarity-check-pulse" fill="var(--success)"><circle cx="117" cy="85" r="3" /><circle cx="243" cy="85" r="3" /></g>
    </svg>
    <div className="clarity-scene-caption"><span>How an audit works · Illustration</span><button type="button" onClick={() => setPaused(value => !value)} aria-pressed={paused} aria-label={paused ? 'Play audit illustration' : 'Pause audit illustration'} title={paused ? 'Play animation' : 'Pause animation'}>{paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}</button></div>
  </div>;
}
