import { Moon, ScanSearch, Sun } from 'lucide-react';
import { BRAND } from '../../lib/brand';

export function ThemeToggle({ theme, onToggle }: { theme: 'dark' | 'light'; onToggle: () => void }) {
  return <button type="button" onClick={onToggle} className="theme-toggle" aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
    {theme === 'dark' ? <Moon className="h-5 w-5" aria-hidden="true" /> : <Sun className="h-5 w-5" aria-hidden="true" />}
    <span className="sr-only">{theme === 'dark' ? 'Dark mode' : 'Light mode'}</span>
  </button>;
}

export function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return <div className="space-y-3" role="status" aria-label="Loading content">{Array.from({ length: rows }, (_, index) => <div key={index} className="h-12 animate-pulse rounded-lg bg-muted" />)}</div>;
}

export function BrandMark() {
  return <div className="flex items-center gap-2.5 font-bold text-foreground"><div className="rounded-lg bg-accent p-2 text-accent-foreground"><ScanSearch className="h-5 w-5" aria-hidden="true" /></div><span className="text-lg max-[359px]:hidden sm:text-xl">{BRAND.name}</span></div>;
}
