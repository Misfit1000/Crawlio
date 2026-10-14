import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Copy, ExternalLink, Monitor, RotateCcw, Smartphone } from 'lucide-react';
import type { ResourceAuditPage } from '../../lib/audit/resource-types';
import {
  buildHeaderRemediation, buildMetadataPreview, buildStructuredData, HEADER_DOCUMENTATION,
  HEADER_TARGETS, headerFindingsFromPage, OBSERVED_HEADER_NAMES, PREVIEW_FIELD_LIMITS,
  previewMetadataFromPage, safeHttpUrl, SCHEMA_TYPES, structuredDataTemplate, TOOL_LIMITS,
  type HeaderTarget, type ObservedHeaderFinding, type PreviewMetadata, type StructuredDataResult,
  type SupportedSchemaType,
} from '../../lib/tools/browser-tools';
import styles from './ToolsPage.module.css';

export interface ToolsPageProps {
  initialPage?: ResourceAuditPage;
  embedded?: boolean;
  tool?: 'metadata' | 'structured-data' | 'headers';
}

const TABS = ['SERP / social', 'Structured data', 'Headers'] as const;

function Field({ label, value, onChange, limit, multiline = false, readOnly = false }: {
  label: string; value: string; onChange: (value: string) => void; limit: number; multiline?: boolean; readOnly?: boolean;
}) {
  const id = useId();
  const shared = { id, value, readOnly, maxLength: limit, className: 'suite-input', onChange: (event: { target: { value: string } }) => onChange(event.target.value) };
  return <div className={`${styles.field} grid min-w-0 flex-1`}>
    <label htmlFor={id} className="font-semibold">{label}</label>
    {multiline ? <textarea {...shared} className={`${shared.className} resize-y`} rows={3} /> : <input {...shared} type="text" spellCheck={false} />}
    <span className={`${styles.count} text-right text-muted-foreground`}>{value.length} / {limit}</span>
  </div>;
}

function ResetButton({ onClick, label }: { onClick: () => void; label: string }) {
  return <button type="button" className="quiet-button text-sm" onClick={onClick} title={label} aria-label={label}>
    <RotateCcw size={16} aria-hidden="true" />Reset
  </button>;
}

function CodeOutput({ label, value }: { label: string; value: string }) {
  const id = useId();
  const [status, setStatus] = useState('');
  const outputRef = useRef<HTMLTextAreaElement>(null);
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setStatus('Copied.');
    } catch {
      outputRef.current?.focus();
      outputRef.current?.select();
      setStatus('Clipboard unavailable. Output selected for copying.');
    }
  }
  return <div>
    <div className={`${styles.row} flex flex-wrap items-center justify-between gap-3`}>
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      <button type="button" className="quiet-button p-2" disabled={!value} onClick={copy} title={`Copy ${label}`} aria-label={`Copy ${label}`}>
        <Copy size={16} aria-hidden="true" />
      </button>
    </div>
    <textarea ref={outputRef} id={id} className={`suite-input ${styles.code} mt-2.5 resize-y`} value={value} readOnly rows={9} spellCheck={false} />
    <p role="status" className={`${styles.copyStatus} mt-1.5 min-h-5 text-muted-foreground`}>{status}</p>
  </div>;
}

function ExternalLinkItem({ href, children }: { href: string; children: string }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className={`${styles.external} inline-flex min-h-11 items-center gap-1.5 text-accent underline underline-offset-3`}>
    {children}<ExternalLink size={14} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span>
  </a>;
}

function PreviewTool({ baseline, audited, embedded }: { baseline: PreviewMetadata; audited: boolean; embedded?: boolean }) {
  const [input, setInput] = useState(baseline);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [fitGuidance, setFitGuidance] = useState<string[]>([]);
  const textRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  const preview = useMemo(() => buildMetadataPreview(input), [input]);
  const titleId = useId();
  const Heading = embedded ? 'h3' : 'h2';
  const change = (key: keyof PreviewMetadata) => (value: string) => setInput(current => ({ ...current, [key]: value }));
  useEffect(() => {
    let cancelled = false;
    setFitGuidance([]);
    // Wait for already-requested fonts; never load fonts or register resize/polling work.
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (cancelled) return;
      const context = document.createElement('canvas').getContext('2d');
      if (!context) {
        setFitGuidance(['Font-width measurement unavailable in this browser.']);
        return;
      }
      const fields: Array<[string, string, number]> = [
        ['Search title', preview.serp.title, 2], ['Search description', preview.serp.description, 3],
        ['Social title', preview.social.title, 2], ['Social description', preview.social.description, 3],
      ];
      const guidance = fields.flatMap(([label, text, lines], index) => {
        const element = textRefs.current[index];
        if (!text || !element) return [];
        const lineWidth = Math.floor(element.getBoundingClientRect().width);
        if (lineWidth <= 0) return [];
        const font = getComputedStyle(element);
        context.font = `${font.fontStyle} ${font.fontWeight} ${font.fontSize} ${font.fontFamily}`;
        const width = context.measureText(text.replace(/\s+/g, ' ').trim()).width;
        const fit = width <= lineWidth ? 'fits one preview line'
          : width <= lineWidth * lines ? `may fit within ${lines} preview lines`
            : `exceeds the approximate ${lines}-line preview budget; may be clipped`;
        return [`${label}: ${Math.round(width)} px of text / ${lineWidth} px per line; ${fit}.`];
      });
      if (!cancelled) setFitGuidance(guidance);
    }).catch(() => {
      if (!cancelled) setFitGuidance(['Font-width measurement unavailable in this browser.']);
    });
    return () => { cancelled = true; };
  }, [preview, device]);
  const textEquivalent = [
    ['Search URL', preview.serp.url], ['Search site name', preview.serp.siteName],
    ['Search title', preview.serp.title], ['Search description', preview.serp.description],
    ['Social site name', preview.social.siteName], ['og:url', preview.social.url],
    ['og:title', preview.social.title], ['og:description', preview.social.description],
    ['og:image URL (not loaded)', preview.social.imageUrl],
  ];
  return <section aria-labelledby={titleId} className="grid min-w-0 gap-8">
    <div className={`${styles.row} flex flex-wrap items-center justify-between gap-3`}>
      <div><Heading id={titleId} className="text-lg">Metadata preview</Heading><p className={`${styles.note} mt-1.5 block text-muted-foreground`}>{audited ? 'Local edits do not change retained page evidence.' : 'Locally entered metadata only. No URL or image requests.'}</p></div>
      <ResetButton onClick={() => { setInput(baseline); setDevice('desktop'); }} label={audited ? 'Reset preview to audited values' : 'Reset preview to empty values'} />
    </div>
    <div className={`${styles.workspace} grid items-start gap-12`}>
      <div className={`${styles.editor} grid min-w-0 gap-6`}>
        <Field label="Page URL" value={input.url} onChange={change('url')} limit={PREVIEW_FIELD_LIMITS.url} />
        <Field label="Site name" value={input.siteName} onChange={change('siteName')} limit={PREVIEW_FIELD_LIMITS.siteName} />
        <Field label="Page title" value={input.title} onChange={change('title')} limit={PREVIEW_FIELD_LIMITS.title} />
        <Field label="Meta description" value={input.description} onChange={change('description')} limit={PREVIEW_FIELD_LIMITS.description} multiline />
        <fieldset className={`${styles.fieldset} mt-1 min-w-0 border-t border-border pt-4`}>
          <legend className="pr-3 font-semibold">Open Graph metadata</legend>
          <div className={`${styles.editor} grid min-w-0 gap-6`}>
            <Field label="og:title" value={input.ogTitle} onChange={change('ogTitle')} limit={PREVIEW_FIELD_LIMITS.ogTitle} />
            <Field label="og:description" value={input.ogDescription} onChange={change('ogDescription')} limit={PREVIEW_FIELD_LIMITS.ogDescription} multiline />
            <Field label="og:url" value={input.ogUrl} onChange={change('ogUrl')} limit={PREVIEW_FIELD_LIMITS.ogUrl} />
            <Field label="og:image URL" value={input.ogImage} onChange={change('ogImage')} limit={PREVIEW_FIELD_LIMITS.ogImage} />
          </div>
        </fieldset>
      </div>
      <div className={`${styles.previews} grid min-w-0 content-start gap-6`}>
        <div role="group" aria-label="Preview device" className={`${styles.segmented} surface-inset flex flex-wrap gap-1 rounded-lg border border-border`}>
          <button type="button" className="inline-flex min-h-11 items-center justify-center gap-2 px-3 py-2 font-semibold text-muted-foreground" aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')}><Monitor size={16} aria-hidden="true" />Desktop</button>
          <button type="button" className="inline-flex min-h-11 items-center justify-center gap-2 px-3 py-2 font-semibold text-muted-foreground" aria-pressed={device === 'mobile'} onClick={() => setDevice('mobile')}><Smartphone size={16} aria-hidden="true" />Mobile</button>
        </div>
        <div className={`${styles.previewWidth} w-full min-w-0`} data-device={device}>
          <p className="text-sm font-semibold">Google-style search preview</p>
          <div className="mt-2.5 rounded-lg border border-border bg-card p-5">
            <p className={`${styles.site} leading-normal`}>{preview.serp.siteName || 'Site name not provided'}</p>
            <p className={`${styles.previewUrl} mt-1 text-xs text-muted-foreground`}>{preview.serp.url || 'Valid page URL not provided'}</p>
            <p ref={element => { textRefs.current[0] = element; }} className={`${styles.searchTitle} mt-2.5 text-xl text-accent`}>{preview.serp.title || <span className={`${styles.missing} text-muted-foreground`}>Title not provided</span>}</p>
            <p ref={element => { textRefs.current[1] = element; }} className={`${styles.searchDescription} mt-2 text-sm text-muted-foreground`}>{preview.serp.description || <span className={`${styles.missing} text-muted-foreground`}>Description not provided</span>}</p>
          </div>
          <p className="mt-5 text-sm font-semibold">Generic social preview</p>
          <div className="mt-2.5 rounded-lg border border-border bg-card p-5">
            <div className={`${styles.imageMetadata} surface-inset mb-4 grid min-h-30 content-center gap-1.5 border-b border-border p-3 text-muted-foreground`}><p>{preview.social.imageUrl ? 'OG image URL provided; image not loaded' : 'OG image not provided'}</p>{preview.social.imageUrl && <p className={`${styles.previewUrl} mt-1 text-xs text-muted-foreground`}>{preview.social.imageUrl}</p>}</div>
            <p className={`${styles.site} leading-normal`}>{preview.social.siteName || 'Site name not provided'}</p>
            <p className={`${styles.previewUrl} mt-1 text-xs text-muted-foreground`}>{preview.social.url || 'OG URL not provided'}</p>
            <p ref={element => { textRefs.current[2] = element; }} className={`${styles.socialTitle} mt-2.5 text-base leading-normal font-semibold`}>{preview.social.title || <span className={`${styles.missing} text-muted-foreground`}>OG title not provided</span>}</p>
            <p ref={element => { textRefs.current[3] = element; }} className={`${styles.searchDescription} mt-2 text-sm text-muted-foreground`}>{preview.social.description || <span className={`${styles.missing} text-muted-foreground`}>OG description not provided</span>}</p>
          </div>
        </div>
        <p className={`${styles.note} mt-1.5 block text-muted-foreground`}>Illustrative layout, not a live result. Search engines may rewrite text; social platforms vary. Width and wrapping depend on fonts and device.</p>
        {fitGuidance.length > 0 && <div className={`${styles.note} mt-1.5 block text-muted-foreground`} aria-label="Approximate font-width fit">
          <p>Measured with the loaded preview font at the last edit or device change. Word wrapping can use more lines; these are not platform limits.</p>
          {fitGuidance.map(guidance => <p key={guidance}>{guidance}</p>)}
        </div>}
        {preview.warnings.length > 0 && <ul className={`${styles.warnings} grid list-disc gap-3 pl-5 text-muted-foreground`} aria-label="Metadata URL errors">{preview.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
        <details className={`${styles.details} border-t border-border pt-3.5`}>
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">Full text equivalent</summary>
          <dl className="mt-3 grid gap-4">{textEquivalent.map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap">{value || 'Not provided'}</dd></div>)}</dl>
        </details>
      </div>
    </div>
  </section>;
}

function SchemaTool({ embedded }: { embedded?: boolean }) {
  const [template, setTemplate] = useState<SupportedSchemaType>('Article');
  const [input, setInput] = useState(() => structuredDataTemplate('Article'));
  const [result, setResult] = useState<StructuredDataResult | null>(null);
  const [inputError, setInputError] = useState('');
  const id = useId();
  const Heading = embedded ? 'h3' : 'h2';
  function change(value: string) {
    setResult(null);
    if (value.length > TOOL_LIMITS.jsonBytes || new TextEncoder().encode(value).length > TOOL_LIMITS.jsonBytes) {
      setInputError(`Input exceeds ${TOOL_LIMITS.jsonBytes.toLocaleString()} bytes. Previous input was kept.`);
      return;
    }
    setInputError('');
    setInput(value);
  }
  function reset() {
    setInput(structuredDataTemplate(template));
    setInputError('');
    setResult(null);
  }
  return <section className="grid min-w-0 gap-8" aria-labelledby={`${id}-title`}>
    <div className={`${styles.row} flex flex-wrap items-center justify-between gap-3`}>
      <div><Heading id={`${id}-title`} className="text-lg">Structured-data builder</Heading><p className={`${styles.note} mt-1.5 block text-muted-foreground`}>JSON only. Syntax and supported fields are checked, not factual accuracy or rich-result eligibility.</p></div>
      <ResetButton onClick={reset} label="Reset structured data to a blank template" />
    </div>
    <div className={`${styles.workspace} grid items-start gap-12`}>
      <div className={`${styles.editor} grid min-w-0 gap-6`}>
        <div className={`${styles.row} flex flex-wrap items-center justify-between gap-3`}>
          <div className={`${styles.field} grid min-w-0 flex-1`}><label htmlFor={`${id}-template`} className="font-semibold">Blank template</label><select id={`${id}-template`} className="suite-input" value={template} onChange={event => setTemplate(event.target.value as SupportedSchemaType)}>{SCHEMA_TYPES.map(type => <option key={type} value={type}>{type === 'FAQPage' ? 'FAQ' : type}</option>)}</select></div>
          <button type="button" className="quiet-button text-sm" onClick={reset}>Use blank template</button>
        </div>
        <div className={`${styles.field} grid min-w-0 flex-1`}>
          <label htmlFor={`${id}-input`} className="font-semibold">Schema JSON</label>
          <textarea id={`${id}-input`} className={`suite-input ${styles.code} resize-y`} value={input} rows={18} spellCheck={false} onChange={event => change(event.target.value)} aria-invalid={!!inputError || result?.ok === false} aria-describedby={`${id}-limits ${id}-error`} />
          <p id={`${id}-limits`} className={`${styles.note} mt-1.5 block text-muted-foreground`}>32 KiB input; depth {TOOL_LIMITS.jsonDepth}; up to {TOOL_LIMITS.faqItems} FAQ questions. Blank required facts are rejected.</p>
        </div>
        <button type="button" className="trust-button text-sm justify-self-start" disabled={!!inputError} onClick={() => setResult(buildStructuredData(input))}>Validate and build</button>
        <p id={`${id}-error`} role="status" className={`${styles.validation} min-h-5.5 text-foreground`}>{inputError || (result?.ok === false ? result.error : result?.ok ? `Supported ${result.type} structure is valid.` : '')}</p>
        <details className={`${styles.details} border-t border-border pt-3.5`}>
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">Supported fields</summary>
          <div className="mt-3 grid gap-3 text-muted-foreground">
            <p>Common: @context, @type, @id, url, description.</p>
            <p>Article: headline (required), author (Person/Organization), publisher (Organization), image URLs, datePublished, dateModified, mainEntityOfPage URL.</p>
            <p>Organization: name (required), logo URL, sameAs URL array. Authors and publishers require their real name.</p>
            <p>FAQ: name, mainEntity containing Question/name and acceptedAnswer/Answer/text. Questions and answers must match visible page content.</p>
            <p>Use absolute HTTP/HTTPS URLs and real ISO dates. Other types, remote contexts, prices, offers, reviews and ratings are outside this builder.</p>
          </div>
        </details>
      </div>
      <div className={`${styles.editor} grid min-w-0 gap-6`}>
        {result?.ok ? <>
          <CodeOutput key={`json:${result.json}`} label="Validated JSON" value={result.json} />
          <CodeOutput key={`embed:${result.json}`} label="HTML JSON-LD embed" value={result.embed} />
        </> : <p className={`${styles.empty} border-y border-border py-6 text-sm text-muted-foreground`}>No generated markup. Enter actual page facts and validate the JSON.</p>}
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <ExternalLinkItem href="https://validator.schema.org/">Schema.org validator</ExternalLinkItem>
          <ExternalLinkItem href="https://search.google.com/test/rich-results">Google Rich Results Test</ExternalLinkItem>
        </div>
        <p className={`${styles.note} mt-1.5 block text-muted-foreground`}>Validators open separately. No pasted text or private URL is sent automatically.</p>
      </div>
    </div>
  </section>;
}

function HeaderTool({ page, observed, observationError, embedded }: {
  page?: ResourceAuditPage; observed: ObservedHeaderFinding[]; observationError: string; embedded?: boolean;
}) {
  const [target, setTarget] = useState<HeaderTarget>('Nginx');
  const [manual, setManual] = useState<string[]>([]);
  const [httpsReady, setHttpsReady] = useState(false);
  const [responseUrl, setResponseUrl] = useState(() => previewMetadataFromPage(page).url);
  const id = useId();
  const Heading = embedded ? 'h3' : 'h2';
  const safeUrl = safeHttpUrl(responseUrl);
  const findings = useMemo(() => [...observed, ...manual.map(header => ({ header, state: 'absent' as const } as ObservedHeaderFinding))], [observed, manual]);
  const remediation = useMemo(() => buildHeaderRemediation(target, observationError ? [] : findings, {
    httpsConfirmed: httpsReady && !!safeUrl && new URL(safeUrl).protocol === 'https:',
  }), [target, findings, httpsReady, safeUrl, observationError]);
  const isHttps = !!safeUrl && new URL(safeUrl).protocol === 'https:';
  return <section className="grid min-w-0 gap-8" aria-labelledby={`${id}-title`}>
    <div className={`${styles.row} flex flex-wrap items-center justify-between gap-3`}>
      <div><Heading id={`${id}-title`} className="text-lg">Observed header remediation</Heading><p className={`${styles.note} mt-1.5 block text-muted-foreground`}>Only explicit absence observations generate directives. Unretained headers are unknown, not missing.</p></div>
      <ResetButton onClick={() => { setManual([]); setHttpsReady(false); setTarget('Nginx'); setResponseUrl(previewMetadataFromPage(page).url); }} label="Reset headers to retained observations" />
    </div>
    <div className={`${styles.workspace} grid items-start gap-12`}>
      <div className={`${styles.editor} grid min-w-0 gap-6`}>
        {page && <p className={`${styles.note} mt-1.5 block text-muted-foreground`}>Selected page response only. Collected: {page.crawledAt?.slice(0, 80) || 'Time not retained'}.</p>}
        <Field label="Observed response URL" value={responseUrl} readOnly={!!page} onChange={value => { setResponseUrl(value); setHttpsReady(false); setManual([]); }} limit={TOOL_LIMITS.url} />
        {responseUrl && !safeUrl && <p className={`${styles.validation} min-h-5.5 text-foreground`}>Enter an absolute HTTP/HTTPS URL. No response is fetched.</p>}
        <fieldset className={`${styles.fieldset} mt-1 min-w-0 border-t border-border pt-4`} disabled={!!observationError}>
          <legend className="pr-3 font-semibold">Headers observed absent</legend>
          <div className="grid gap-3">{OBSERVED_HEADER_NAMES.map(header => {
            const records = observed.filter(finding => finding.header === header);
            const knownAbsent = records.length > 0 && records.every(finding => finding.state === 'absent');
            const knownPresent = records.some(finding => finding.state === 'present');
            const conflict = records.length > 1 && new Set(records.map(finding => finding.state)).size > 1;
            const locked = knownAbsent || knownPresent || conflict;
            const status = conflict ? 'Conflicting audit observations; kept unchanged' : knownPresent ? 'Present in audit; kept unchanged' : knownAbsent ? 'Absent in audit' : 'Not retained; check only after observing absence';
            return <label key={header} className={`${styles.check} flex min-h-11 cursor-pointer items-start gap-2.5 py-2 leading-normal`}>
              <input type="checkbox" className="mt-0.5 shrink-0" checked={knownAbsent || manual.includes(header)} disabled={locked} onChange={event => setManual(current => event.target.checked ? [...current, header] : current.filter(value => value !== header))} />
              <span className="min-w-0"><span className="font-semibold">{header}</span><span className={`${styles.note} mt-1.5 block text-muted-foreground`}>{status}</span></span>
            </label>;
          })}</div>
        </fieldset>
        <label className={`${styles.check} flex min-h-11 cursor-pointer items-start gap-2.5 py-2 leading-normal`}><input type="checkbox" className="mt-0.5 shrink-0" checked={httpsReady} disabled={!isHttps || !!observationError} onChange={event => setHttpsReady(event.target.checked)} /><span className="min-w-0">HTTPS is working with valid certificates<span className={`${styles.note} mt-1.5 block text-muted-foreground`}>Required for the short, staged HSTS directive.</span></span></label>
        <div className={`${styles.field} grid min-w-0 flex-1`}><label htmlFor={`${id}-target`} className="font-semibold">Deployment target</label><select id={`${id}-target`} className="suite-input" value={target} onChange={event => setTarget(event.target.value as HeaderTarget)}>{HEADER_TARGETS.map(value => <option key={value}>{value}</option>)}</select></div>
        {observationError && <p role="alert" className={`${styles.validation} min-h-5.5 text-foreground`}>{observationError}</p>}
      </div>
      <div className={`${styles.editor} grid min-w-0 gap-6`}>
        {remediation.snippet ? <CodeOutput key={remediation.snippet} label={`${target} configuration fragment`} value={remediation.snippet} /> : <p className={`${styles.empty} border-y border-border py-6 text-sm text-muted-foreground`}>No eligible observed absence selected. No configuration generated.</p>}
        {remediation.warnings.length > 0 && <ul className={`${styles.warnings} grid list-disc gap-3 pl-5 text-muted-foreground`} aria-label="Deployment caveats">{remediation.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
        <ExternalLinkItem href={HEADER_DOCUMENTATION[target]}>{`${target} header documentation`}</ExternalLinkItem>
      </div>
    </div>
  </section>;
}

function ToolsWorkspace({ initialPage, embedded, tool, baseline, observed, observationError }: ToolsPageProps & {
  baseline: PreviewMetadata; observed: ObservedHeaderFinding[]; observationError: string;
}) {
  const [active, setActive] = useState(0);
  const id = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const Title = embedded ? 'h2' : 'h1';
  if (tool) return <div className={`${styles.root} grid min-w-0 gap-10 text-foreground`}>
    {tool === 'metadata' && <PreviewTool baseline={baseline} audited={!!initialPage} />}
    {tool === 'structured-data' && <SchemaTool />}
    {tool === 'headers' && <HeaderTool page={initialPage} observed={observed} observationError={observationError} />}
  </div>;
  return <div className={`${embedded ? 'grid gap-10' : 'suite-page'} ${styles.root} min-w-0 text-foreground`}>
    <header className={`${styles.row} flex flex-wrap items-center justify-between gap-3`}>
      <div><Title data-route-focus-target={!embedded ? true : undefined} className={embedded ? 'text-xl' : 'text-2xl'}>SEO tools</Title><p className={`${styles.note} mt-1.5 block text-muted-foreground`}>Local tools for previews, markup, and header fixes. Audit scores stay unchanged.</p></div>
      <span className="suite-chip">{initialPage ? 'Selected page evidence' : 'Local input'}</span>
    </header>
    <div className={`${styles.tabs} flex flex-wrap gap-1 border-b border-border`} role="tablist" aria-label="Browser tools">
      {TABS.map((label, index) => <button ref={element => { tabRefs.current[index] = element; }} key={label} id={`${id}-tab-${index}`} type="button" className="min-h-11 border-b-2 border-transparent px-4 py-3 font-semibold text-muted-foreground" role="tab" aria-selected={active === index} aria-controls={`${id}-panel-${index}`} tabIndex={active === index ? 0 : -1} onClick={() => setActive(index)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : null;
        if (next !== null) { event.preventDefault(); setActive(next); tabRefs.current[next]?.focus(); }
      }}>{label}</button>)}
    </div>
    <div role="tabpanel" id={`${id}-panel-0`} aria-labelledby={`${id}-tab-0`} hidden={active !== 0}><PreviewTool baseline={baseline} audited={!!initialPage} embedded={embedded} /></div>
    <div role="tabpanel" id={`${id}-panel-1`} aria-labelledby={`${id}-tab-1`} hidden={active !== 1}><SchemaTool embedded={embedded} /></div>
    <div role="tabpanel" id={`${id}-panel-2`} aria-labelledby={`${id}-tab-2`} hidden={active !== 2}><HeaderTool page={initialPage} observed={observed} observationError={observationError} embedded={embedded} /></div>
  </div>;
}

export default function ToolsPage({ initialPage, embedded = false, tool }: ToolsPageProps) {
  const baseline = previewMetadataFromPage(initialPage);
  let observed: ObservedHeaderFinding[] = [];
  let observationError = '';
  try { observed = headerFindingsFromPage(initialPage); }
  catch (error) { observationError = error instanceof Error ? error.message : 'Invalid retained header evidence.'; }
  // New evidence resets all local overrides; ordinary parent re-renders do not.
  const sourceKey = JSON.stringify([tool, initialPage?.id, initialPage?.crawledAt, baseline, observed, observationError]);
  return <ToolsWorkspace key={sourceKey} initialPage={initialPage} embedded={embedded} tool={tool} baseline={baseline} observed={observed} observationError={observationError} />;
}
