import { useState, type ReactNode } from 'react';

export default function DeferredSection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details className="min-w-0 border-t border-border" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="min-h-11 cursor-pointer rounded-md py-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">{title}</summary>
    {open && <div className="min-w-0 pb-5 pt-2">{children}</div>}
  </details>;
}
