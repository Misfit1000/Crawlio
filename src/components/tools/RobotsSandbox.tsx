import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { evaluateRobots, parseRobotsTxt, type RobotsFetchEvidence } from '../../lib/seo/robots-evaluator';
import { CRAWLER_REGISTRY, CRAWLER_REGISTRY_VERIFIED_AT } from '../../lib/tools/crawler-registry';
import type { ResourceAuditPage } from '../../lib/audit/resource-types';
import { redactToolUrl } from '../../lib/tools/audit-tools';

export type StoredRobotsEvidence = Pick<RobotsFetchEvidence, 'state' | 'raw' | 'fetchedAt' | 'warnings' | 'truncated'> & { statusCode?: number | null };

export default function RobotsSandbox({ evidence, observedPages = [] }: { evidence?: StoredRobotsEvidence | null; observedPages?: ResourceAuditPage[] }) {
  const [text, setText] = useState('');
  const [path, setPath] = useState('/');
  const [tested, setTested] = useState(false);
  const [fromAudit, setFromAudit] = useState(false);
  const [selected, setSelected] = useState('Googlebot');
  const deferredText = useDeferredValue(text);
  const document = useMemo(() => parseRobotsTxt(deferredText), [deferredText]);
  useEffect(() => {
    if (!evidence) return;
    setText(['missing', 'empty', 'unavailable'].includes(evidence.state) ? '' : evidence.raw);
    setFromAudit(true); setTested(false);
  }, [evidence]);
  const evaluate = (token: string, value = path) => {
    // Apple documents a Googlebot fallback only when no Applebot group is present.
    const has = (name: string) => document.groups.some(group => group.userAgents.some(agent => agent.value.toLowerCase() === name));
    const effective = token === 'Applebot' && !has('applebot') && has('googlebot') ? 'Googlebot' : token;
    return { ...evaluateRobots(document, value, effective), fallback: effective !== token };
  };
  const unavailable = fromAudit && evidence?.state === 'unavailable';
  const allowedToTest = !unavailable && deferredText === text;
  const results = tested && allowedToTest ? CRAWLER_REGISTRY.map(item => ({ ...item, result: evaluate(item.token) })) : [];
  const sampledPages = observedPages.slice(0, 20);
  const sampled = tested && allowedToTest ? sampledPages.map(page => ({ url: redactToolUrl(page.url), result: evaluate(selected, page.url) })) : [];
  const permitted = sampled.filter(item => item.result.allowed).length;
  const blocked = sampled.filter(item => item.result.blocked).length;
  const access = blocked && permitted ? 'Partial' : blocked ? 'Blocked in sample' : 'Permitted by sampled rules';
  return <div className="min-w-0 space-y-5">
    <header><h2 id="robots-sandbox-heading" className="text-xl font-semibold">Robots sandbox and crawler controls</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Evaluate a specific path without fetching a website. Robots permission does not establish authentication, bot-protection access, crawler visits, indexing, citations or training use. User-requested fetchers can behave differently.</p></header>
    {evidence && <div className="space-y-2 border-l-2 border-accent pl-3 text-xs"><p>Retained document: {evidence.state} · HTTP {evidence.statusCode ?? 'unavailable'} · {new Date(evidence.fetchedAt).toLocaleString()}</p>{evidence.warnings.slice(0, 10).map((warning, index) => <p key={index} className="text-muted-foreground">{warning}</p>)}{evidence.truncated && <p>Only a retained excerpt is available. Results describe that excerpt, not the full document.</p>}</div>}
    <label className="block text-sm font-semibold">Robots document<textarea className="suite-input mt-2 min-h-44 w-full font-mono text-xs" maxLength={128000} value={text} spellCheck={false} onChange={event => { setText(event.target.value); setFromAudit(false); setTested(false); }} /></label>
    <p className="text-xs text-muted-foreground">{fromAudit ? 'Retained audit evidence; edits switch to local paste mode.' : 'Local paste mode; no content is saved or sent.'} Limit: 128,000 characters. Blank input explicitly tests an empty file.</p>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end"><label className="min-w-0 flex-1 text-sm font-semibold">Path or page URL<input value={path} maxLength={2048} className="suite-input mt-2 w-full" onChange={event => { setPath(event.target.value); setTested(false); }} /></label><button type="button" className="trust-button" disabled={!allowedToTest} onClick={() => setTested(true)}>Evaluate rules</button></div>
    {unavailable && <p role="status" className="text-sm">This robots retrieval was unavailable, not an empty successful file. Paste a document to run a local hypothetical test.</p>}
    {!!document.warnings.length && <details><summary className="cursor-pointer text-sm font-semibold">Parser notes ({document.warnings.length})</summary><ul className="mt-2 space-y-1 text-xs text-muted-foreground">{document.warnings.slice(0, 20).map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
    {!!results.length && <div className="overflow-x-auto rounded-md border border-border"><table className="w-full min-w-[580px] text-left text-sm"><caption className="p-3 text-left text-xs text-muted-foreground">Path-specific rule simulation. Product registry verified {CRAWLER_REGISTRY_VERIFIED_AT}; official references are linked.</caption><thead className="bg-muted text-xs"><tr>{['Product / purpose', 'Rule result', 'Matched evidence'].map(label => <th key={label} scope="col" className="p-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-border">{results.map(item => <tr key={item.token}><td className="p-3"><a href={item.documentation} target="_blank" rel="noreferrer" className="font-semibold text-accent underline">{item.label}</a><p className="mt-1 text-xs text-muted-foreground">{item.use}</p></td><td className="p-3 font-semibold">{item.result.reason === 'invalid-path' ? 'Invalid path' : item.result.blocked ? 'Blocked by rule' : 'Permitted by rule'}</td><td className="p-3"><p className="break-all text-xs">{item.result.matchedRule ? `Line ${item.result.matchedRule.line ?? 'unknown'}: ${item.result.matchedRule.directive} ${item.result.matchedRule.path}` : 'No matching restrictive rule'}</p><p className="mt-1 text-xs text-muted-foreground">Group: {item.result.groups.join(', ') || 'none'}{item.result.fallback ? ' (Googlebot fallback)' : ''}</p></td></tr>)}</tbody></table></div>}
    {!!sampled.length && <section className="space-y-3 border-t border-border pt-4"><label className="text-sm font-semibold">Observed-page sample for<select className="suite-input ml-0 mt-2 block sm:ml-3 sm:mt-0 sm:inline-block" value={selected} onChange={event => setSelected(event.target.value)}>{CRAWLER_REGISTRY.filter(item => !('control' in item)).map(item => <option key={item.token} value={item.token}>{item.label}</option>)}</select></label><p className="text-sm">{access}: {permitted} permitted and {blocked} blocked in {sampled.length} sampled paths, from {observedPages.length} loaded page records. This is not a domain-wide result.</p><details><summary className="cursor-pointer text-sm">Sampled path evidence</summary><ul className="mt-3 divide-y divide-border">{sampled.map((item, index) => <li key={index} className="break-all py-2 text-xs">{item.result.blocked ? 'Blocked' : 'Permitted'} · {item.url}</li>)}</ul></details></section>}
  </div>;
}
