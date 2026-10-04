export const AUDIT_PRESETS = [
  { slug: 'full', focus: 'full', title: 'Full website audit', description: 'Review all eight check groups in one evidence-based website audit.', checks: ['On-page SEO and technical delivery', 'Crawlability, links and performance', 'Structured data, accessibility and passive security'], limitation: 'Coverage depends on discoverable public pages, the selected depth and your allowance.' },
  { slug: 'seo', focus: 'seo', title: 'On-page SEO audit', description: 'Check titles, descriptions, headings, images and content signals.', checks: ['Titles, descriptions and heading structure', 'Image alternatives and content signals', 'Local and international HTML signals'], limitation: 'HTML observations do not measure search rankings, traffic or content quality guarantees.' },
  { slug: 'technical', focus: 'technical', title: 'Technical SEO audit', description: 'Inspect HTTP delivery, redirects and static mobile-HTML signals.', checks: ['HTTP response and delivery signals', 'Redirect observations', 'Static mobile-HTML signals'], limitation: 'Public HTML checks do not reproduce a browser rendering session.' },
  { slug: 'crawlability', focus: 'crawlability', title: 'Crawlability audit', description: 'Review robots access, indexing directives, canonical URLs and sitemaps.', checks: ['Robots access and indexing directives', 'Canonical URL signals', 'Sitemap discovery and consistency'], limitation: 'Permission to crawl does not guarantee indexing or visibility in search.' },
  { slug: 'links', focus: 'links', title: 'Internal links audit', description: 'Inspect internal destinations and anchor text in retrievable HTML.', checks: ['Internal link destinations', 'Broken destination observations', 'Anchor text in retrieved HTML'], limitation: 'This is not a third-party backlink index or a domain authority measurement.' },
  { slug: 'performance', focus: 'performance', title: 'Performance audit', description: 'Measure observed HTML request duration and downloaded HTML size.', checks: ['Observed HTML request duration', 'Downloaded HTML size', 'Response-based performance findings'], limitation: 'These observations are not browser-measured Core Web Vitals or a Lighthouse score.' },
  { slug: 'structured-data', focus: 'structured-data', title: 'Structured data audit', description: 'Inspect structured markup and social metadata found in page HTML.', checks: ['Structured markup present in HTML', 'Markup structure observations', 'Open Graph and social metadata'], limitation: 'Valid markup does not establish factual accuracy or rich-result eligibility.' },
  { slug: 'accessibility', focus: 'accessibility', title: 'Accessibility audit', description: 'Find automated accessibility signals in public HTML.', checks: ['HTML accessibility signals', 'Missing alternatives and labels', 'Evidence linked to affected pages'], limitation: 'Automated checks are not accessibility certification or a substitute for manual testing.' },
  { slug: 'security', focus: 'security', title: 'Passive security audit', description: 'Review HTTPS, browser-protection headers and insecure HTML references.', checks: ['HTTPS delivery observations', 'Browser-protection headers', 'Insecure HTML references'], limitation: 'Passive public-response checks only. No port scanning, attack testing or exploitation.' },
  { slug: 'custom', focus: 'custom', title: 'Custom website audit', description: 'Choose the check groups and coverage needed for your next fix.', checks: ['Choose any of the eight check groups', 'Select single-page or website coverage', 'Keep findings limited to selected checks'], limitation: 'Select at least one check group. Scores describe selected checks, not full website health.' },
];

export const PUBLIC_TOOLS = [
  { slug: 'metadata', title: 'Metadata preview', description: 'Preview search and social titles, descriptions and Open Graph fields locally.', limitation: 'Illustrative previews only. Search engines and social platforms may display different text.' },
  { slug: 'structured-data', title: 'Structured-data builder', description: 'Build and validate supported Article, Organization and FAQ JSON-LD from real facts.', limitation: 'Structural validation does not establish factual accuracy or rich-result eligibility.' },
  { slug: 'robots', title: 'Robots sandbox', description: 'Test a path against robots rules you supply in your browser.', limitation: 'A permitted path is not a guarantee of indexing, citations or search visibility.' },
  { slug: 'headers', title: 'Header remediation', description: 'Prepare configuration fragments for browser-protection headers observed absent.', limitation: 'No website is fetched. Unknown or unretained headers are not treated as missing.' },
];

export { PUBLIC_NAVIGATION } from './public-navigation.mjs';

export const PUBLIC_PAGES = [
  { path: '/', title: 'Crawlio website audits', description: 'Find SEO problems, inspect the evidence and choose what to check next.', kind: 'home' },
  { path: '/audits', title: 'Website audits', description: 'Choose a full audit or focus on one part of your website.', kind: 'audits' },
  ...AUDIT_PRESETS.map(preset => ({ path: `/audits/${preset.slug}`, title: preset.title, description: preset.description, kind: 'audit', slug: preset.slug })),
  { path: '/tools', title: 'Free SEO tools', description: 'Local browser tools for metadata, structured data, robots rules and header remediation.', kind: 'tools' },
  ...PUBLIC_TOOLS.map(tool => ({ path: `/tools/${tool.slug}`, title: tool.title, description: tool.description, kind: 'tool', slug: tool.slug })),
  { path: '/pricing', title: 'Crawlio plans and limits', description: 'Compare Free, Plus and Pro audit allowances, depth and report capabilities.', kind: 'pricing' },
  { path: '/reports/example', title: 'Example website audit report', description: 'Explore sample findings, affected pages, evidence and recommended fixes.', kind: 'example' },
  { path: '/privacy', title: 'Privacy notice', description: 'What Crawlio stores, why it is needed, and the controls available to account owners.', kind: 'legal' },
  { path: '/terms', title: 'Terms of service', description: 'The rules for using the controlled Crawlio Free beta.', kind: 'legal' },
  { path: '/acceptable-use', title: 'Acceptable use policy', description: 'How to use public website auditing without harming sites or the service.', kind: 'legal' },
  { path: '/cookies', title: 'Cookie and storage notice', description: 'Essential browser storage used by the Crawlio beta.', kind: 'legal' },
  { path: '/contact', title: 'Contact Crawlio', description: 'Support and responsible disclosure routes for the controlled beta.', kind: 'legal' },
];

export function publicPageForPath(pathname) {
  return PUBLIC_PAGES.find(page => page.path === pathname);
}
