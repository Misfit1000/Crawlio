import { Moon, Scan, Sun } from 'lucide-react';
import { BRAND } from '../../lib/brand';

export function ThemeToggle({ theme, onToggle }: { theme: 'dark' | 'light'; onToggle: () => void }) {
  return <button type="button" onClick={onToggle} className="theme-toggle" aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
    {theme === 'dark' ? <Sun className="h-5 w-5" aria-hidden="true" /> : <Moon className="h-5 w-5" aria-hidden="true" />}
    <span className="sr-only">{theme === 'dark' ? 'Dark mode' : 'Light mode'}</span>
  </button>;
}

export function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return <div className="space-y-3" role="status" aria-label="Loading content">{Array.from({ length: rows }, (_, index) => <div key={index} className="h-12 animate-pulse rounded-lg bg-muted" />)}</div>;
}

export function BrandMark() {
  return <div className="brand-mark"><Scan className="brand-symbol" aria-hidden="true" /><span>{BRAND.name}</span></div>;
}
