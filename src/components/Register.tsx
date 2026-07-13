import { useState } from 'react';
import { Eye, EyeOff, Loader2, Lock, Mail, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { BrandMark } from './ui/visual-system';
import { FormField, Notice } from './ui/page-system';

export default function Register({
  onToggle,
  onClose,
}: {
  onToggle: () => void;
  onClose?: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const { register } = useAuth();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      await register(email.trim(), password, { accepted: legalAccepted, version: '2026-07-13' });
      setSuccess(true);
      window.setTimeout(() => onClose?.(), 700);
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="suite-panel w-full max-w-md animate-rise p-6 sm:p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <BrandMark />
          <h2 className="mt-6 text-2xl font-semibold">Create account</h2>
          <p className="mt-1 text-sm text-muted-foreground">Start saving audits, reports, and plan usage.</p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close signup modal"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <FormField label="Email" htmlFor="register-email">
          <span className="relative block">
            <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <input
              id="register-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="suite-input pl-11"
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </span>
        </FormField>

        <FormField label="Password" htmlFor="register-password" hint="Use at least 8 characters. Your password is handled by the secure account service.">
          <span className="relative block">
            <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <input
              id="register-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              className="suite-input pl-11 pr-12"
              placeholder="Create a secure password"
              autoComplete="new-password"
              required
            />
            <button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={showPassword ? 'Hide password' : 'Show password'}>
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </span>
        </FormField>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-muted/35 p-3 text-sm leading-6">
          <input type="checkbox" checked={legalAccepted} onChange={(event) => setLegalAccepted(event.target.checked)} required className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]" aria-describedby="registration-consent" />
          <span id="registration-consent" className="text-muted-foreground">I agree to the <a href="/terms" className="font-semibold text-accent hover:underline">Terms</a> and acknowledge the <a href="/privacy" className="font-semibold text-accent hover:underline">Privacy Notice</a>.</span>
        </label>

        {error && <Notice tone="danger">{error}</Notice>}

        {success && <Notice tone="success">Account created. Loading your dashboard...</Notice>}

        <button
          type="submit"
          disabled={loading || !legalAccepted}
          className="trust-button w-full"
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
          {loading ? 'Creating account...' : 'Create account'}
        </button>
      </form>

      <div className="mt-6 border-t border-border pt-5 text-center text-sm text-muted-foreground">
        Already registered?{' '}
        <button type="button" onClick={onToggle} className="font-semibold text-accent hover:text-accent/80">
          Sign in
        </button>
      </div>
    </div>
  );
}
