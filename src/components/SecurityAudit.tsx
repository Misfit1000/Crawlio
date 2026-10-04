import { ShieldCheck } from 'lucide-react';
import { PageHeader } from './ui/page-system';
import AuditStartForm from './home/AuditStartForm';

export default function SecurityAudit() {
  return <div className="mx-auto w-full max-w-3xl space-y-7">
    <PageHeader icon={ShieldCheck} title="Passive security review" description="Check HTTPS, browser-protection headers and insecure HTML references. No port scanning, attack testing or exploitation." />
    <AuditStartForm initialFocus="security" fixedFocus section="security" />
    <p className="text-sm leading-6 text-muted-foreground">Observations apply to public responses. Unavailable evidence is reported as unknown, not a pass.</p>
  </div>;
}
