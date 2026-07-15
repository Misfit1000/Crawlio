import { getAuditStartHeaders } from '../api/auth-headers';
import { API_ROUTES } from '../api/routes';

function filenameFromDisposition(value: string | null, fallback: string) {
  const match = value?.match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
}

export async function downloadAuditExport(auditId: string, format: 'pdf' | 'json' | 'issues.csv' | 'pages.csv') {
  const response = await fetch(API_ROUTES.auditExport(auditId, format), {
    headers: await getAuditStartHeaders(),
  });

  if (!response.ok) {
    const contentType = response.headers.get('content-type') || '';
    let message = `Export failed with status ${response.status}.`;
    if (contentType.includes('application/json')) {
      const body = await response.json().catch(() => null);
      message = body?.error || message;
    } else {
      const body = await response.text().catch(() => '');
      if (body.trim()) message = body.slice(0, 180);
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const extension = format.includes('.') ? format.split('.').pop() : format;
  const filename = filenameFromDisposition(response.headers.get('content-disposition'), `crawlio-audit.${extension}`);
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
