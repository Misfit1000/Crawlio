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
    <svg className="clarity-scene-desktop" viewBox="0 0 1200 660" role="img" aria-label="Illustrative audit flow: discover website pages, check evidence, and prioritize fixes">
      <g fill="none" stroke="var(--border-strong)" strokeWidth="1.5">
        <path d="M175 345 V510 Q175 530 195 530 H490 M1025 345 V510 Q1025 530 1005 530 H710" />
        <path d="M175 300 H105 V240 M175 300 V215 M175 300 H245 V240 M1025 300 H950 V235 M1025 300 V205 M1025 300 H1100 V235" />
      </g>
      <g fill="var(--card)" stroke="var(--border)" strokeWidth="1.5">
        <rect x="95" y="275" width="160" height="70" rx="8" />
        <rect x="945" y="275" width="160" height="70" rx="8" />
        <rect x="490" y="480" width="220" height="100" rx="8" />
        <rect x="70" y="205" width="70" height="40" rx="6" /><rect x="140" y="175" width="70" height="40" rx="6" /><rect x="210" y="205" width="70" height="40" rx="6" />
        <rect x="925" y="195" width="50" height="40" rx="6" /><rect x="1000" y="165" width="50" height="40" rx="6" /><rect x="1075" y="195" width="50" height="40" rx="6" />
      </g>
      <g fill="var(--muted-foreground)" fontSize="12" fontFamily="inherit" textAnchor="middle"><text x="175" y="305">Discover pages</text><text x="1025" y="305">Check evidence</text><text x="600" y="512">Prioritize fixes</text></g>
      <g fill="var(--accent)"><rect x="85" y="219" width="35" height="4" rx="2" /><rect x="155" y="188" width="35" height="4" rx="2" /><rect x="225" y="219" width="35" height="4" rx="2" /><rect x="118" y="320" width="70" height="5" rx="2" /><rect x="525" y="531" width="125" height="5" rx="2" /><rect x="525" y="547" width="85" height="5" rx="2" opacity=".4" /></g>
      <g fill="var(--success)"><circle cx="950" cy="215" r="5" /><circle cx="1025" cy="185" r="5" /><circle cx="1100" cy="215" r="5" /><circle cx="975" cy="322" r="4" /><circle cx="996" cy="322" r="4" /><circle cx="1017" cy="322" r="4" /></g>
      <circle className="clarity-flow-left" cx="210" cy="530" r="4" fill="var(--accent)" />
      <circle className="clarity-flow-right" cx="990" cy="530" r="4" fill="var(--success)" />
      <g className="clarity-check-pulse" fill="var(--success)"><circle cx="975" cy="322" r="7" opacity=".2" /><circle cx="996" cy="322" r="7" opacity=".2" /><circle cx="1017" cy="322" r="7" opacity=".2" /></g>
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
