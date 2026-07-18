import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';

interface AdminActionDialogProps {
  open: boolean;
  title: string;
  description: string;
  actionLabel: string;
  impact?: string[];
  confirmationPhrase?: string;
  pending?: boolean;
  error?: string | null;
  tone?: 'primary' | 'danger';
  onCancel: () => void;
  onConfirm: (values: { reason: string; confirmation: string }) => void | Promise<void>;
}

export default function AdminActionDialog({
  open,
  title,
  description,
  actionLabel,
  impact = [],
  confirmationPhrase,
  pending = false,
  error,
  tone = 'primary',
  onCancel,
  onConfirm,
}: AdminActionDialogProps) {
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setConfirmation('');
    const timer = window.setTimeout(() => reasonRef.current?.focus(), 25);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, pending, onCancel]);

  if (!open) return null;
  const valid = reason.trim().length >= 4 && (!confirmationPhrase || confirmation === confirmationPhrase);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !pending) onCancel();
    }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-action-title"
        aria-describedby="admin-action-description"
        className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-lg sm:p-6"
      >
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tone === 'danger' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'}`}>
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="admin-action-title" className="text-lg font-semibold text-foreground">{title}</h2>
            <p id="admin-action-description" className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
          </div>
          <button type="button" onClick={onCancel} disabled={pending} className="icon-button h-9 w-9" aria-label="Close action dialog">
            <X className="h-4 w-4" />
          </button>
        </div>

        {impact.length > 0 && (
          <div className="mt-5 rounded-lg border border-border bg-muted/45 p-4">
            <div className="text-sm font-semibold">Impact</div>
            <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
              {impact.map((item) => <li key={item} className="flex gap-2"><span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-current" /><span>{item}</span></li>)}
            </ul>
          </div>
        )}

        <label className="mt-5 block">
          <span className="text-sm font-semibold">Reason</span>
          <textarea
            ref={reasonRef}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            rows={3}
            className="suite-input mt-2 min-h-24 resize-y"
            placeholder="Record why this action is necessary"
            disabled={pending}
          />
          <span className="mt-1 block text-xs text-muted-foreground">Required. Stored in administrator activity history.</span>
        </label>

        {confirmationPhrase && (
          <label className="mt-4 block">
            <span className="text-sm font-semibold">Type <span className="font-mono">{confirmationPhrase}</span> to continue</span>
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="suite-input mt-2"
              autoComplete="off"
              disabled={pending}
            />
          </label>
        )}

        {error && <div role="alert" className="mt-4 rounded-lg border border-red-500/25 bg-red-500/8 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div>}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={pending} className="quiet-button justify-center">Cancel</button>
          <button
            type="button"
            onClick={() => onConfirm({ reason: reason.trim(), confirmation })}
            disabled={!valid || pending}
            className={tone === 'danger' ? 'danger-button justify-center' : 'primary-button justify-center'}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {pending ? 'Applying...' : actionLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
