import { useEffect, useMemo, useState } from 'react';
import './public-pages.css';
import { ArrowRight, Check } from 'lucide-react';
import { Link } from '../../app/router';
import { createPublicPlanComparison, mergePublicPlanPresentation, type PublicPlanProjection } from '../../lib/plans/public-plan-presentation';
import { loadPublicPlanProjection } from '../../lib/plans/public-plan-client';

export default function PricingPage() {
  const [projection, setProjection] = useState<PublicPlanProjection | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const plans = useMemo(() => mergePublicPlanPresentation(projection), [projection]);
  const comparison = useMemo(() => createPublicPlanComparison(plans), [plans]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setUnavailable(false);
    void loadPublicPlanProjection(controller.signal).then(value => { if (active) setProjection(value); }).catch(error => { if (active && error?.name !== 'AbortError') setUnavailable(true); });
    return () => { active = false; controller.abort(); };
  }, [attempt]);

  return <main id="main-content" className="section-shell public-task-page">
    <header className="public-page-heading"><h1 data-route-focus-target>Crawlio plans and limits</h1><p>Choose your audit allowance. Focus and coverage are separate from depth.</p></header>
    <p className="mb-7 text-sm leading-6 text-muted-foreground">Plan access is managed by an administrator. Self-service billing is not yet available.</p>
    <section id="pricing" aria-label="Audit plans" className="grid gap-5 md:grid-cols-3">{plans.map(plan => <article key={plan.id} className={`rounded-lg border p-6 ${plan.recommended ? 'border-accent' : 'border-border'}`}><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-semibold">{plan.name}</h2>{plan.recommended && <span className="text-xs font-semibold text-accent">Most versatile</span>}</div><p className="mt-2 text-sm text-muted-foreground">{plan.mode}</p><p className="my-5 text-2xl font-semibold tabular-nums">Up to {plan.pagesPerAudit} pages</p><p className="text-sm text-muted-foreground">{plan.allowance}</p><ul className="my-5 space-y-3 text-sm">{plan.features.map(feature => <li key={feature} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success)]" aria-hidden="true" />{feature}</li>)}</ul><p className="text-xs text-muted-foreground">{plan.footer}</p></article>)}</section>
    <p role="status" className="mt-4 text-xs leading-6 text-muted-foreground">{projection ? 'Current published allowances. Availability is verified again at launch.' : 'Reference limits. Current allowances are verified when an audit starts.'}{unavailable && <button type="button" className="ml-2 underline" onClick={() => setAttempt(value => value + 1)}>Retry current limits</button>}</p>
    <details className="mt-6 border-y border-border py-4"><summary className="cursor-pointer text-sm font-semibold">Compare capabilities</summary><div className="mt-4 overflow-x-auto"><table className="suite-table w-full min-w-[600px]"><caption className="sr-only">Plan comparison</caption><thead><tr><th scope="col">Capability</th>{plans.map(plan => <th scope="col" key={plan.id}>{plan.name}</th>)}</tr></thead><tbody>{comparison.map(row => <tr key={row.label}><th scope="row">{row.label}</th>{row.values.map((value, index) => <td key={index}>{value}</td>)}</tr>)}</tbody></table></div></details>
    <Link to="/audits" className="trust-button mt-6">Choose an audit <ArrowRight className="h-4 w-4" /></Link>
  </main>;
}
