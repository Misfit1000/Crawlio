import { Router } from 'express';
import { normalizeUserUrl } from '../../seo/url-utils';
import { auditRepository } from '../../supabase/audit-repository';


function asyncJsonRoute(handler: any) {
  return async (req: any, res: any, next: any) => {
    try {
      await handler(req, res, next);
    } catch (error: any) {
      console.error(error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : "Internal server error",
        });
      }
    }
  };
}

export const securityRouter = Router();


securityRouter.post('/run', asyncJsonRoute(async (req, res) => {
  try {
    const { url, mode = 'quick' } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

    const normalized = normalizeUserUrl(String(url));
    if (!normalized.isValid) {
      return res.status(400).json({ success: false, error: normalized.error || 'Invalid URL' });
    }

    const audit = await auditRepository.createAuditJob({
      submittedInput: String(url).trim(),
      normalizedUrl: normalized.normalizedUrl,
      hostname: normalized.hostname,
      mode,
    });

    res.json({
      success: true,
      data: {
        auditId: audit.id,
        status: 'queued',
        submittedInput: audit.submittedInput,
        normalizedUrl: audit.normalizedUrl,
        hostname: audit.hostname,
        mode: audit.mode,
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
  }
}));
