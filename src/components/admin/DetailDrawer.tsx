import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

export function DetailDrawer({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog ref={dialog} aria-labelledby={titleId} onCancel={onClose} onClose={onClose}
      className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-dvh w-full max-w-lg border-l border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/40">
      <header className="flex items-center justify-between gap-4 border-b border-border p-5">
        <h2 id={titleId} className="text-lg">{title}</h2>
        <button type="button" autoFocus onClick={onClose} className="quiet-button p-2" aria-label="Close details"><X className="h-5 w-5" /></button>
      </header>
      <div className="space-y-5 break-words p-5">{children}</div>
    </dialog>
  );
}

export function DetailFields({ fields }: { fields: Array<[string, string | number | null | undefined]> }) {
  return <dl className="divide-y divide-border">{fields.map(([label, value]) => <div key={label} className="py-3"><dt className="text-xs font-semibold text-muted-foreground">{label}</dt><dd className="mt-1 break-all text-sm">{value ?? 'Not recorded'}</dd></div>)}</dl>;
}
