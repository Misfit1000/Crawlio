import { useEffect, useRef, useState } from 'react';
import { Accessibility, ArrowRight, Check, CircleCheck, Info, Pause, Play, TriangleAlert } from 'lucide-react';

function ConceptPage({ small = false, className = '' }: { small?: boolean; className?: string }) {
  return <div className={`concept-page min-w-0 overflow-hidden rounded-md border border-[var(--border-strong)] bg-background ${className}`} aria-hidden="true">
    {!small && <div className="flex h-4 items-center gap-1 border-b border-border bg-muted pl-2">{[0,1,2].map(index => <i key={index} className="size-1 rounded-full bg-muted-foreground" />)}</div>}
    <div className={`grid ${small ? 'gap-1 p-2' : 'gap-2 px-3 py-4'}`}>
      <b className={`${small ? 'h-1' : 'mb-1 h-1.5'} block w-3/5 rounded-sm bg-[var(--action)]`} />
      {[0,1,2].map(index => <span key={index} className={`${small ? 'h-0.5' : 'h-1'} block rounded-sm bg-border ${index === 1 ? 'w-3/4' : 'w-full'}`} />)}
      {!small && <div className="mt-1 grid grid-cols-2 gap-2"><div className="min-h-9 rounded-sm bg-accent/10" /><section className="grid content-center gap-1.5">{[0,1,2].map(index => <span key={index} className="block h-1 rounded-sm bg-border" />)}</section></div>}
    </div>
  </div>;
}

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
    <div className="concept-heading mb-10 flex items-center justify-between gap-4 md:justify-center"><h2 className="text-2xl">How an audit works</h2><button className="theme-toggle" type="button" onClick={() => setPaused(value => !value)} aria-pressed={paused} aria-label={paused ? 'Play audit illustration' : 'Pause audit illustration'} title={paused ? 'Play animation' : 'Pause animation'}>{paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}</button></div>
    <div className="concept-stages grid gap-10 md:grid-cols-3 md:gap-6 xl:gap-10" role="img" aria-label="Illustration: discover public pages, check their evidence, then prioritize fixes. Not live audit data.">
      <section className="concept-stage min-w-0">
        <header className="mb-7 flex items-start gap-4"><span className="concept-step grid size-9 shrink-0 place-items-center rounded-full font-semibold">1</span><div><h3 className="text-xl">Discover</h3><p className="mt-1 text-sm text-muted-foreground">Find your important pages.</p></div></header>
        <div className="concept-discovery mx-auto grid h-49 max-w-[420px] grid-cols-[1.2fr_.6fr_.65fr] items-center"><ConceptPage /><div className="h-full" aria-hidden="true"><svg className="block h-full w-full overflow-visible" viewBox="0 0 100 200" preserveAspectRatio="none"><path fill="none" stroke="var(--chart-cyan)" strokeWidth="1.2" d="M0 100 C55 100 45 30 100 30 M0 100 H100 M0 100 C55 100 45 170 100 170" /><circle className="clarity-flow-left" fill="var(--chart-cyan)" cx="52" cy="100" r="4" /></svg></div><div className="grid gap-3"><ConceptPage small /><ConceptPage small /><ConceptPage small /></div></div>
      </section>
      <section className="concept-stage min-w-0">
        <header className="mb-7 flex items-start gap-4"><span className="concept-step grid size-9 shrink-0 place-items-center rounded-full font-semibold">2</span><div><h3 className="text-xl">Check</h3><p className="mt-1 text-sm text-muted-foreground">Turn page evidence into clear findings.</p></div></header>
        <div className="concept-checking mx-auto grid min-h-49 max-w-[420px] grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)] items-center gap-5 md:grid-cols-1 xl:grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)]"><ConceptPage className="md:hidden xl:block" /><div className="grid gap-5">{[{label:'Technical checks',Icon:CircleCheck,tone:'var(--action)'},{label:'Content checks',Icon:Check,tone:'var(--chart-success)'},{label:'Accessibility checks',Icon:Accessibility,tone:'var(--chart-cyan)'}].map(({label,Icon,tone}) => <div key={label} className="flex items-center gap-2.5"><span className="grid size-7 shrink-0 place-items-center rounded-full text-white" style={{backgroundColor:tone}}><Icon className="h-4 w-4" /></span><div className="min-w-0 flex-1"><span className="block text-xs font-medium">{label}</span><i className="clarity-check-pulse mt-1.5 block h-1.5 w-5/6 rounded-full" style={{backgroundColor:tone}} /></div></div>)}</div></div>
      </section>
      <section className="concept-stage min-w-0">
        <header className="mb-7 flex items-start gap-4"><span className="concept-step grid size-9 shrink-0 place-items-center rounded-full font-semibold">3</span><div><h3 className="text-xl">Prioritize</h3><p className="mt-1 text-sm text-muted-foreground">Know what to fix first.</p></div></header>
        <div className="concept-fixes mx-auto grid min-h-49 max-w-[420px] content-center gap-3">{[{label:'Fix critical issues',Icon:TriangleAlert,tone:'var(--warning)'},{label:'Review recommendations',Icon:Info,tone:'var(--accent)'},{label:'Keep doing well',Icon:CircleCheck,tone:'var(--success)'}].map(({label,Icon,tone}) => <div key={label} className="flex min-h-14 items-center gap-3 rounded-md border border-border px-3 py-2.5"><Icon className="h-5 w-5 shrink-0" style={{color:tone}} /><div className="min-w-0 flex-1"><span className="block text-xs font-medium">{label}</span><i className="mt-1 block h-1 w-2/3 rounded-sm bg-border" /></div><ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" /></div>)}</div>
      </section>
    </div>
    <p className="concept-disclosure mt-10 flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">Public pages only <span aria-hidden="true">&middot;</span> Evidence-backed checks <span aria-hidden="true">&middot;</span> Illustration, not live results</p>
  </div>;
}
