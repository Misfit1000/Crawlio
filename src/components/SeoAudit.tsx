import { useEffect, useState } from 'react';
import { PageHeader } from './ui/page-system';
import AuditStartForm from './home/AuditStartForm';

export default function SeoAudit({ initialUrl }: { initialUrl?: string }) {
  const [seed, setSeed] = useState({ url: initialUrl || '', projectId: null as string | null });
  useEffect(() => {
    if (initialUrl) { setSeed({ url: initialUrl, projectId: null }); return; }
    setSeed({ url: localStorage.getItem('crawlio_prefill_audit_url') || '', projectId: localStorage.getItem('crawlio_prefill_project_id') });
    localStorage.removeItem('crawlio_prefill_audit_url');
    localStorage.removeItem('crawlio_prefill_project_id');
  }, [initialUrl]);

  return <div className="mx-auto w-full max-w-3xl space-y-7">
    <PageHeader title="Start a website audit" />
    <AuditStartForm initialUrl={seed.url} projectId={seed.projectId} autoStart={Boolean(initialUrl)} />
  </div>;
}
