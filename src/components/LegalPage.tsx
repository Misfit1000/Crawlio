import { useEffect } from 'react';
import { Cookie, FileText, Mail, Scale, ShieldCheck } from 'lucide-react';

export type LegalPageKind = 'privacy' | 'terms' | 'acceptable-use' | 'cookies' | 'contact';

type LegalContent = {
  title: string;
  description: string;
  icon: typeof ShieldCheck;
  sections: Array<{ title: string; paragraphs: string[]; bullets?: string[] }>;
};

const content: Record<LegalPageKind, LegalContent> = {
  privacy: {
    title: 'Privacy notice',
    description: 'What Crawlio stores, why it is needed, and the controls available to account owners.',
    icon: ShieldCheck,
    sections: [
      { title: 'Information we process', paragraphs: ['Crawlio processes account details, submitted public website addresses, audit summaries, findings, page metadata, workflow notes, and operational security records.'], bullets: ['Complete raw HTML is not retained.', 'Raw IP addresses are not used for audit quotas; one-way privacy hashes are used where needed.', 'Passwords and session credentials are handled by the account provider.'] },
      { title: 'Why we process it', paragraphs: ['Data is used to provide audits and reports, enforce fair beta limits, protect the service from abuse, recover failed work, and support account security.'] },
      { title: 'Retention', paragraphs: ['Customer reports remain until the owner deletes them or the account. Short-lived activity, diagnostics, failed guest jobs, and stale queue records use documented retention periods. Security and administrator action records may be retained longer for accountability.'] },
      { title: 'Your controls', paragraphs: ['Signed-in users can export account data, archive or delete eligible audits, and permanently delete their account from Settings. Published blog records and required security logs are separated from private account content.'] },
      { title: 'Service providers', paragraphs: ['Crawlio currently uses Vercel for the frontend and lightweight API, Supabase for accounts and data, and Render for the audit engine. Their processing is governed by their terms and the project owner’s configuration.'] },
    ],
  },
  terms: {
    title: 'Terms of service',
    description: 'The rules for using the controlled Crawlio Free beta.',
    icon: Scale,
    sections: [
      { title: 'Beta service', paragraphs: ['Crawlio is currently offered as a controlled beta. Features, limits, availability, and retained data may change. No uptime, ranking, traffic, or search-performance outcome is guaranteed.'] },
      { title: 'Permitted use', paragraphs: ['You may audit public websites you own, manage, or are authorised to assess. You are responsible for applicable laws, website terms, and organisational policies.'] },
      { title: 'Reports and recommendations', paragraphs: ['Reports describe observed public signals and deterministic checks. They are guidance, not legal, security, or guaranteed ranking advice. Passive security observations are not penetration tests.'] },
      { title: 'Accounts and availability', paragraphs: ['Keep account access secure and provide accurate registration information. Crawlio may restrict submissions, pause Free audits, or suspend abusive access to protect service availability.'] },
      { title: 'Owner details', paragraphs: ['The service owner must publish final business identity, contact details, governing law, and jurisdiction-specific terms before expanding beyond the controlled beta. No unverified company registration or jurisdiction is claimed here.'] },
    ],
  },
  'acceptable-use': {
    title: 'Acceptable use policy',
    description: 'How to use public website auditing without harming sites or the service.',
    icon: FileText,
    sections: [
      { title: 'Authorised public auditing', paragraphs: ['Submit only public HTTP or HTTPS websites you are allowed to assess. Crawlio blocks private, local, reserved, and unsupported network targets.'] },
      { title: 'Prohibited activity', paragraphs: ['Do not use Crawlio for illegal activity, unauthorised access attempts, exploitation, disruptive automation, or bypassing crawler protections.'], bullets: ['Do not create guest identities to evade quotas.', 'Do not flood the queue or automate excessive submissions.', 'Do not target private networks or services you are not authorised to assess.', 'Do not attempt to obtain another user’s audit, diagnostics, or account information.', 'Do not use submitted content to deliver malicious payloads or disrupt third-party services.'] },
      { title: 'Passive boundaries', paragraphs: ['Security checks review public headers, HTTPS, page metadata, and browser-facing signals. They do not exploit vulnerabilities, brute-force accounts, or perform invasive scans.'] },
      { title: 'Enforcement', paragraphs: ['Crawlio may reject, rate-limit, cancel, or investigate submissions that threaten availability or violate this policy. Relevant security records may be retained for abuse prevention.'] },
    ],
  },
  cookies: {
    title: 'Cookie and storage notice',
    description: 'Essential browser storage used by the Crawlio beta.',
    icon: Cookie,
    sections: [
      { title: 'Essential storage', paragraphs: ['Crawlio uses essential account/session storage, a guest audit identifier, theme preference, and local interface preferences. These support sign-in, report ownership, fair audit limits, and accessibility preferences.'] },
      { title: 'Analytics and advertising', paragraphs: ['Crawlio does not currently require advertising cookies. Optional analytics must be documented here and placed behind an appropriate consent control before being enabled.'] },
      { title: 'Managing storage', paragraphs: ['Browser controls can clear local storage and cookies. Clearing a guest identifier may remove access to anonymous audit progress, but it does not bypass server-side rate limits.'] },
    ],
  },
  contact: {
    title: 'Contact Crawlio',
    description: 'Support and responsible disclosure routes for the controlled beta.',
    icon: Mail,
    sections: [
      { title: 'Product and account support', paragraphs: ['Signed-in users should open Settings for account export, deletion, and support guidance. The service owner must configure and publish a monitored support email before the beta is promoted publicly.'] },
      { title: 'Security reports', paragraphs: ['Provide the affected route, impact, safe reproduction steps, and a contact method. Do not include passwords, access tokens, private keys, or unrelated personal data.'] },
      { title: 'Legal owner information', paragraphs: ['Business identity, postal address, legal jurisdiction, and formal notice address require owner completion before a broader launch. Crawlio does not publish fabricated company details.'] },
    ],
  },
};

export default function LegalPage({ kind }: { kind: LegalPageKind }) {
  const page = content[kind];
  const Icon = page.icon;

  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = description?.content || '';
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const previousCanonical = canonical?.href || '';
    document.title = `${page.title} | Crawlio`;
    if (description) description.content = page.description;
    if (canonical) canonical.href = `${window.location.origin}/${kind}`;
    return () => {
      document.title = previousTitle;
      if (description) description.content = previousDescription;
      if (canonical) canonical.href = previousCanonical;
    };
  }, [kind, page.description, page.title]);

  return (
    <main id="main-content" className="section-shell flex-1 py-12 sm:py-16">
      <article className="mx-auto max-w-4xl">
        <header className="border-b border-border pb-8">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent/10 text-accent"><Icon className="h-5 w-5" /></div>
          <h1 className="mt-5 text-3xl font-semibold sm:text-4xl">{page.title}</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">{page.description}</p>
          <p className="mt-4 text-sm text-muted-foreground">Last updated July 13, 2026</p>
        </header>
        <div className="divide-y divide-border">
          {page.sections.map((section) => (
            <section key={section.title} className="py-7">
              <h2 className="text-xl font-semibold">{section.title}</h2>
              <div className="mt-3 space-y-3 text-sm leading-7 text-muted-foreground">
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                {section.bullets && <ul className="list-disc space-y-2 pl-5">{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}
              </div>
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
