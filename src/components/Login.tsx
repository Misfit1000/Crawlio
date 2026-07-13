import { useState } from 'react';
import { Eye, EyeOff, Loader2, Lock, Mail, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { BrandMark } from './ui/visual-system';
import { FormField, Notice } from './ui/page-system';

export default function Login({
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
  const { login } = useAuth();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(email.trim(), password);
      onClose?.();
    } catch (err: any) {
      setError(err.message || 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="suite-panel w-full max-w-md animate-rise p-6 sm:p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <BrandMark />
          <h2 className="mt-6 text-2xl font-semibold">Welcome back</h2>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to manage audits and reports.</p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close sign in modal"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <FormField label="Email" htmlFor="login-email">
          <span className="relative block">
            <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <input
              id="login-email"
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

        <FormField label="Password" htmlFor="login-password">
          <span className="relative block">
            <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="suite-input pl-11 pr-12"
              placeholder="Enter your password"
              autoComplete="current-password"
              required
            />
            <button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={showPassword ? 'Hide password' : 'Show password'}>
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </span>
        </FormField>

        {error && <Notice tone="danger">{error}</Notice>}

        <button
          type="submit"
          disabled={loading}
          className="trust-button w-full"
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>

      <div className="mt-6 border-t border-border pt-5 text-center text-sm text-muted-foreground">
        No account yet?{' '}
        <button type="button" onClick={onToggle} className="font-semibold text-accent hover:text-accent/80">
          Create one
        </button>
      </div>
    </div>
  );
}
