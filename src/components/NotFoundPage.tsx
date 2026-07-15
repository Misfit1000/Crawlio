import { useEffect } from 'react';
import { ArrowLeft, SearchX } from 'lucide-react';

export default function NotFoundPage({ onHome }: { onHome: () => void }) {
  useEffect(() => {
    const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]') || document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'robots' }));
    const previous = robots.content;
    robots.content = 'noindex, nofollow';
    const previousTitle = document.title;
    document.title = 'Page not found | Crawlio';
    return () => { robots.content = previous; document.title = previousTitle; };
  }, []);

  return (
    <main id="main-content" className="section-shell flex min-h-[60vh] flex-1 items-center py-16">
      <div className="mx-auto max-w-xl text-center">
        <SearchX className="mx-auto h-10 w-10 text-accent" />
        <h1 className="mt-5 text-3xl font-semibold">Page not found</h1>
        <p className="mt-3 text-muted-foreground">The address may be outdated or incomplete. Return to the homepage to start an audit or open a working product route.</p>
        <button type="button" onClick={onHome} className="trust-button mt-6"><ArrowLeft className="h-4 w-4" /> Return home</button>
      </div>
    </main>
  );
}
