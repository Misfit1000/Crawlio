import http from 'node:http';
import type { AuditWorkerRuntimeState } from './audit-worker-runtime';
import { BRAND } from '../lib/brand';
import { API_SCHEMA_VERSION } from '../lib/platform/version';
import { validControlBearer } from '../lib/audit/worker-wake';

export function startWorkerHealthServer(
  state: AuditWorkerRuntimeState,
  isReady: () => boolean,
  portValue: string | undefined,
  onWake?: () => void,
) {
  if (!portValue) return null;
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('WORKER_HEALTH_PORT must be a valid TCP port.');
  }

  const server = http.createServer((req, res) => {
    if (req.url === '/control/wake') {
      res.setHeader('Cache-Control', 'private, no-store');
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      if (!validControlBearer(req.headers.authorization, process.env.AUDIT_WORKER_CONTROL_SECRET)) { res.writeHead(401); res.end(); return; }
      if (!isReady() || !onWake) { res.writeHead(503); res.end(); return; }
      onWake();
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ scheduled: true }));
      return;
    }
    const payload = {
      product: BRAND.name,
      workerRole: 'audit-only',
      ok: state.status !== 'stopped' && state.queuePollingStatus !== 'error' && state.databaseConnected && !state.maintenanceMode,
      serviceStatus: state.maintenanceMode ? 'maintenance' : state.status === 'stopped' ? 'stopped' : 'online',
      queuePollingStatus: state.queuePollingStatus,
      databaseConnected: state.databaseConnected,
      lastSeenAt: state.lastSeenAt,
      currentAudit: state.currentAuditId ? 'processing' : null,
      lastCompletedAuditAt: state.lastCompletedAuditAt,
      lastFatalWorkerError: Boolean(state.lastFatalWorkerError),
      commitIdentifier: state.version,
      supportedModes: state.supportedModes,
      auditEngineVersion: state.auditEngineVersion,
      scoringVersion: state.scoringVersion,
      checkRegistryVersion: state.checkRegistryVersion,
      apiSchemaVersion: API_SCHEMA_VERSION,
      auditScopeVersion: 1,
      deepAuditEnabled: state.deepAuditEnabled,
      sentryConfigured: state.sentryConfigured,
      planLimitsSummary: {
        free: { modes: ['quick'], maxPages: 5, priority: 10 },
        paid: { modes: ['quick', 'standard'], maxPages: 50, priority: 50 },
        agency: { modes: state.deepAuditEnabled ? ['quick', 'standard', 'deep'] : ['quick', 'standard'], maxPages: state.deepAuditEnabled ? 75 : 50, priority: 100 },
      },
    };

    if (req.url === '/ready') {
      const ready = isReady();
      res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ...payload, ok: ready }));
      return;
    }

    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'Not found' }));
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`Audit worker health server listening on ${port}`);
  });

  return server;
}
