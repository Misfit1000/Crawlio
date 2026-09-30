import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { BrandMark } from './ui/visual-system';
import { Notice } from './ui/page-system';

export default function AccountRecovery() {
  const { error, retryProfile, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const submitting = useRef(false);

  const perform = async (action: () => Promise<void>) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setLocalError(null);
    try { await action(); }
    catch { setLocalError('Account setup is still unavailable. Your account is saved; wait a moment and retry.'); }
    finally { submitting.current = false; setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <main className="suite-panel w-full max-w-md p-6 sm:p-8">
        <BrandMark />
        <h1 className="mt-6 text-2xl font-semibold">Finish account setup</h1>
        <p className="mt-1 text-sm text-muted-foreground">Authentication succeeded. Your profile still needs to load before you can use the workspace.</p>
        <div className="mt-6" aria-live="polite"><Notice tone="warning">{localError || error || 'Retry account setup without submitting another signup.'}</Notice></div>
        <button type="button" className="trust-button mt-5 w-full" disabled={busy} onClick={() => void perform(retryProfile)}>
          {busy && <Loader2 className="h-5 w-5 animate-spin" />}
          {busy ? 'Retrying account setup...' : 'Retry account setup'}
        </button>
        <button type="button" className="mt-6 w-full text-sm font-semibold text-accent" disabled={busy} onClick={() => void perform(logout)}>Sign out</button>
      </main>
    </div>
  );
}
