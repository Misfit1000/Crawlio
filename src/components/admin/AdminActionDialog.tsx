import { createContext,useContext,useEffect,useId,useRef,useState,type ReactNode } from 'react';

type Confirmation = { changes?: Array<{ label: string; before: unknown; after: unknown }>; warning?: string; confirmation?: string };
type RequestReason = (action: string, options?: Confirmation) => Promise<string | null>;
const Context = createContext<RequestReason | null>(null);

export function useAdminActionReason() {
  const request = useContext(Context);
  if (!request) throw new Error('Admin action dialog is unavailable.');
  return request;
}

export function AdminActionProvider({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef<((value: string | null) => void) | null>(null);
  const [action, setAction] = useState('');
  const [reason, setReason] = useState('');
  const [options, setOptions] = useState<Confirmation>({});
  const [confirmation, setConfirmation] = useState('');
  const trigger = useRef<HTMLElement | null>(null);
  const reasonInput = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const finish = (value: string | null) => {
    dialog.current?.close();
    pending.current?.(value);
    pending.current = null;
    if (trigger.current?.isConnected) trigger.current.focus();
  };
  useEffect(() => () => { pending.current?.(null); }, []);
  const request: RequestReason = (nextAction, nextOptions = {}) => {
    if (pending.current) return Promise.resolve(null);
    setAction(nextAction);
    setReason('');
    setOptions(nextOptions);
    setConfirmation('');
    trigger.current = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    window.requestAnimationFrame(() => reasonInput.current?.focus());
    return new Promise((resolve) => { pending.current = resolve; });
  };
  return <Context.Provider value={request}>
    {children}
    <dialog ref={dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={event => { event.preventDefault(); finish(null); }} className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg border border-border bg-card p-6 text-foreground shadow-xl backdrop:bg-black/50">
      <form onSubmit={(event) => { event.preventDefault(); if (reason.trim().length >= 4 && (!options.confirmation || confirmation === options.confirmation)) finish(reason.trim()); }}>
        <h2 id={`${id}-title`} className="text-xl font-semibold">Confirm administrative change</h2>
        <p id={`${id}-description`} className="mt-3 text-sm leading-6 text-muted-foreground">You are {action}. The server validates this request and records its outcome.</p>
        {options.warning && <p className="mt-3 text-sm font-medium text-amber-700 dark:text-amber-300">{options.warning}</p>}
        {options.changes && <div className="mt-4 overflow-x-auto"><table className="suite-table w-full text-sm"><caption className="sr-only">Proposed changes</caption><thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>{options.changes.map(change => <tr key={change.label}><th scope="row">{change.label}</th><td className="break-all">{format(change.before)}</td><td className="break-all">{format(change.after)}</td></tr>)}</tbody></table></div>}
        <label htmlFor={`${id}-reason`} className="mb-2 mt-5 block text-sm font-semibold">Reason for this change</label>
        <textarea ref={reasonInput} autoFocus id={`${id}-reason`} required minLength={4} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className="suite-input min-h-24" />
        {options.confirmation && <label className="mt-4 block text-sm font-semibold">Type {options.confirmation}<input autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)} className="suite-input mt-2 min-h-11" /></label>}
        <div className="mt-5 flex flex-wrap justify-end gap-3"><button type="button" className="quiet-button min-h-11" onClick={() => finish(null)}>Cancel</button><button type="submit" disabled={reason.trim().length < 4 || Boolean(options.confirmation && confirmation !== options.confirmation)} className="trust-button min-h-11">Confirm change</button></div>
      </form>
    </dialog>
  </Context.Provider>;
}

function format(value: unknown) { return value == null ? 'Not recorded' : Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value); }
