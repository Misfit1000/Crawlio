import type { Router } from 'express';
import { deleteProjectDataImport, listProjectDataImports, readProjectDataImport, saveProjectDataImport } from '../lib/imports/server';

type Requester = (req: any) => Promise<{ userId: string | null }>;

function route(handler: (req: any, res: any) => Promise<void>) {
  return async (req: any, res: any, next: any) => {
    try { await handler(req, res); } catch (error) { next(error); }
  };
}

async function requireUser(req: any, res: any, requester: Requester) {
  const current = await requester(req);
  if (!current.userId) {
    res.status(401).json({ success: false, error: 'Authentication required.' });
    return null;
  }
  return current.userId;
}

export function registerImportRoutes(router: Router, requester: Requester) {
  router.get('/imports', route(async (req, res) => {
    const userId = await requireUser(req, res, requester);
    if (!userId) return;
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ success: true, data: { imports: await listProjectDataImports(userId) } });
  }));

  router.get('/imports/:id/rows', route(async (req, res) => {
    const userId = await requireUser(req, res, requester);
    if (!userId) return;
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ success: true, data: await readProjectDataImport(userId, String(req.params.id || '')) });
  }));

  router.post('/imports', route(async (req, res) => {
    const userId = await requireUser(req, res, requester);
    if (!userId) return;
    res.setHeader('Cache-Control', 'private, no-store');
    const saved = await saveProjectDataImport(userId, req.body || {});
    res.status(201).json({ success: true, data: { import: saved } });
  }));

  router.delete('/imports/:id', route(async (req, res) => {
    const userId = await requireUser(req, res, requester);
    if (!userId) return;
    res.setHeader('Cache-Control', 'private, no-store');
    await deleteProjectDataImport(userId, String(req.params.id || ''));
    res.json({ success: true });
  }));
}
