import { createContext,useContext,useEffect,useRef,useState,type ReactNode } from 'react';

type RequestReason = (action: string) => Promise<string | null>;
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
  const finish = (value: string | null) => {
    dialog.current?.close();
    pending.current?.(value);
    pending.current = null;
  };
  useEffect(() => () => { pending.current?.(null); }, []);
  const request: RequestReason = (nextAction) => {
    if (pending.current) return Promise.resolve(null);
    setAction(nextAction);
    setReason('');
    dialog.current?.showModal();
    return new Promise((resolve) => { pending.current = resolve; });
  };
  return <Context.Provider value={request}>
    {children}
    <dialog ref={dialog} aria-labelledby="admin-action-title" onCancel={() => finish(null)} className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-lg border border-border bg-card p-6 text-foreground shadow-xl backdrop:bg-black/50">
      <form onSubmit={(event) => { event.preventDefault(); if (reason.trim().length >= 4) finish(reason.trim()); }}>
        <h2 id="admin-action-title" className="text-xl font-semibold">Confirm administrative change</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">You are {action}. The change applies immediately after confirmation and is recorded in administrator activity.</p>
        <label htmlFor="admin-action-reason" className="mb-2 mt-5 block text-sm font-semibold">Reason for this change</label>
        <textarea autoFocus id="admin-action-reason" required minLength={4} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className="suite-input min-h-24" />
        <div className="mt-5 flex justify-end gap-3"><button type="button" className="quiet-button" onClick={() => finish(null)}>Cancel</button><button type="submit" disabled={reason.trim().length < 4} className="trust-button">Confirm change</button></div>
      </form>
    </dialog>
  </Context.Provider>;
}
