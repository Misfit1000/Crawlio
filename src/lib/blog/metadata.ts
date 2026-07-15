import { useEffect } from 'react';

function setMeta(selector: string, attributes: Record<string, string>, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  const created = !element;
  const previousContent = element?.getAttribute('content');
  if (!element) {
    element = document.createElement('meta');
    Object.entries(attributes).forEach(([key, value]) => element!.setAttribute(key, value));
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
  return { element, created, previousContent };
}

export function usePageMetadata({
  title,
  description,
  canonicalPath,
  image,
  type = 'website',
  jsonLd,
}: {
  title: string;
  description: string;
  canonicalPath: string;
  image?: string;
  type?: 'website' | 'article';
  jsonLd?: Record<string, unknown>;
}) {
  useEffect(() => {
    const previousTitle = document.title;
    const canonical = new URL(canonicalPath, window.location.origin).toString();
    document.title = title;
    const metaSnapshots = [
      setMeta('meta[name="description"]', { name: 'description' }, description),
      setMeta('meta[property="og:title"]', { property: 'og:title' }, title),
      setMeta('meta[property="og:description"]', { property: 'og:description' }, description),
      setMeta('meta[property="og:type"]', { property: 'og:type' }, type),
      setMeta('meta[property="og:url"]', { property: 'og:url' }, canonical),
      setMeta('meta[name="twitter:card"]', { name: 'twitter:card' }, image ? 'summary_large_image' : 'summary'),
      setMeta('meta[name="twitter:title"]', { name: 'twitter:title' }, title),
      setMeta('meta[name="twitter:description"]', { name: 'twitter:description' }, description),
    ];
    if (image) {
      metaSnapshots.push(setMeta('meta[property="og:image"]', { property: 'og:image' }, image));
      metaSnapshots.push(setMeta('meta[name="twitter:image"]', { name: 'twitter:image' }, image));
    }

    let canonicalLink = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const canonicalCreated = !canonicalLink;
    const previousCanonical = canonicalLink?.getAttribute('href');
    if (!canonicalLink) {
      canonicalLink = document.createElement('link');
      canonicalLink.rel = 'canonical';
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.href = canonical;

    const scriptId = 'crawlio-page-jsonld';
    document.getElementById(scriptId)?.remove();
    if (jsonLd) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.type = 'application/ld+json';
      script.textContent = JSON.stringify(jsonLd).replace(/</g, '\\u003c');
      document.head.appendChild(script);
    }

    return () => {
      document.title = previousTitle;
      document.getElementById(scriptId)?.remove();
      metaSnapshots.forEach(({ element, created, previousContent }) => {
        if (created) element.remove();
        else if (previousContent === null || previousContent === undefined) element.removeAttribute('content');
        else element.setAttribute('content', previousContent);
      });
      if (canonicalCreated) canonicalLink?.remove();
      else if (canonicalLink && previousCanonical) canonicalLink.href = previousCanonical;
    };
  }, [canonicalPath, description, image, jsonLd, title, type]);
}
