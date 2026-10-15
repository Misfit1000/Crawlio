import {
  CAPTURE_POLICY, CAPTURE_PROFILES, PreviewFailure, capturePaths, decodeBase64, publicResourceUrl, webpDimensions,
} from '../../lib/preview/capture-policy';
import { Buffer } from 'node:buffer';
import type { BrowserPage, CaptureBrowser, CaptureClaim, CaptureResult, Runtime } from './contracts';
import { PreviewApi } from './io';
import { ResourceProxy } from './resource-proxy';

const INIT_SCRIPT = String.raw`(() => {
  const deny = () => { throw new DOMException('Unavailable in site preview', 'SecurityError'); };
  for (const name of ['Worker', 'SharedWorker', 'WebTransport', 'RTCPeerConnection', 'webkitRTCPeerConnection']) {
    Object.defineProperty(globalThis, name, { value: deny, configurable: false, writable: false });
  }
  Object.defineProperty(globalThis, 'open', { value: () => null, configurable: false, writable: false });
  const safe = value => { try { return ['http:', 'https:'].includes(new URL(value, location.href).protocol); } catch { return false; } };
  addEventListener('click', event => {
    const anchor = event.target?.closest?.('a');
    if (anchor && (anchor.hasAttribute('download') || !safe(anchor.href))) event.preventDefault();
  }, true);
  addEventListener('submit', event => event.preventDefault(), true);
  globalThis.navigation?.addEventListener('navigate', event => {
    if (!safe(event.destination.url) && event.cancelable) event.preventDefault();
  });
})();`;

export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new PreviewFailure('CAPTURE_DEADLINE'));
    if (signal.aborted) { void promise.catch(() => {}); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function boundedClose(browser: CaptureBrowser, runtime: Runtime, remainingMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => browser.close()).then(() => true, () => false),
      new Promise<boolean>(resolve => { timer = runtime.setTimer(() => resolve(false), Math.max(1, remainingMs)); }),
    ]);
  } finally { if (timer) runtime.clearTimer(timer); }
}

function captureError(error: unknown): PreviewFailure {
  if (error instanceof PreviewFailure) return error;
  const status = Number((error as { status?: unknown })?.status);
  const message = error instanceof Error ? error.message : '';
  if (status === 402 || status === 429 || /\b(?:code:\s*)?429\b|browser time limit|quota exceeded/i.test(message)) {
    return new PreviewFailure('BROWSER_QUOTA', 'quota_exhausted');
  }
  if (/guardrails|routeWebSocket|not implemented|not supported/i.test(message)) return new PreviewFailure('BROWSER_GUARD_UNSUPPORTED');
  return new PreviewFailure('BROWSER_UNAVAILABLE');
}

export interface CaptureOutcome {
  result: CaptureResult;
  cleanupPaths: string[];
  closureConfirmed: boolean;
  settlement: Promise<unknown>;
  diagnostic?: string;
}

export async function capturePair(job: CaptureClaim, api: PreviewApi, runtime: Runtime): Promise<CaptureOutcome> {
  const started = runtime.now(), hardDeadline = started + CAPTURE_POLICY.deadlineMs;
  const controller = new AbortController();
  const proxy = new ResourceProxy(job, api, runtime, controller.signal);
  let browser: CaptureBrowser | undefined, closePromise: Promise<boolean> | undefined;
  let launchSettled = true, launchPromise: Promise<CaptureBrowser> | undefined;
  let failure: PreviewFailure | undefined, result: CaptureResult | undefined;
  let diagnostic: string | undefined;
  let renderingFinished = false;
  const attemptedUploads: string[] = [];
  const close = () => {
    if (!browser) return Promise.resolve(launchSettled);
    closePromise ??= boundedClose(browser, runtime, hardDeadline - runtime.now());
    return closePromise;
  };
  const fail = (error: unknown) => {
    failure ??= captureError(error);
    controller.abort(failure);
  };
  controller.signal.addEventListener('abort', () => { void close(); }, { once: true });
  const timer = runtime.setTimer(() => fail(new PreviewFailure('CAPTURE_DEADLINE')), CAPTURE_POLICY.deadlineMs - CAPTURE_POLICY.closeReserveMs);
  const step = <T>(promise: Promise<T>) => abortable(promise, controller.signal);

  try {
    const paths = capturePaths(job.id, job.generation);
    const target = publicResourceUrl(job.target_url, proxy.deniedOrigins);
    launchSettled = false;
    // Count SDK binding requests too; WebSocket CDP messages do not create subrequests.
    const binding = { fetch: async (...args: Parameters<Runtime['fetch']>) => {
      api.budget.take(4);
      return api.env.BROWSER!.fetch(...args);
    } };
    launchPromise = runtime.launch(binding, { guardrails: { allowedDomains: [] } }).then(async value => {
      browser = value;
      launchSettled = true;
      if (controller.signal.aborted) await close();
      return value;
    }, error => { launchSettled = true; throw error; });
    browser = await step(launchPromise);
    const render = async (viewport: 'desktop' | 'mobile') => {
      const profile = CAPTURE_PROFILES[viewport];
      const context = await step(browser!.newContext({
        ...profile, serviceWorkers: 'block', acceptDownloads: false,
        storageState: { cookies: [], origins: [] }, permissions: [],
        locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce',
      }));
      for (const method of ['route', 'routeWebSocket', 'addInitScript', 'newCDPSession', 'on', 'newPage'] as const) {
        if (typeof context[method] !== 'function') throw new PreviewFailure('BROWSER_GUARD_UNSUPPORTED');
      }
      let primaryPage: BrowserPage | undefined;
      context.on('page', (page: BrowserPage) => {
        if (!primaryPage) primaryPage = page;
        else if (page !== primaryPage) void page.close().catch(error => fail(error));
      });
      context.on('serviceworker', () => fail(new PreviewFailure('SERVICE_WORKER_BLOCKED', 'blocked')));
      await step(context.routeWebSocket(/.*/, async socket => {
        try { await socket.close(); } catch { fail(new PreviewFailure('WEBSOCKET_GUARD_UNSUPPORTED')); }
      }));
      await step(context.route(/.*/, async route => {
        try {
          if (typeof route.abort !== 'function' || typeof route.fulfill !== 'function') throw new PreviewFailure('BROWSER_GUARD_UNSUPPORTED');
          const request = route.request();
          if (controller.signal.aborted || request.method() !== 'GET' || request.frame().page() !== primaryPage
            || ['media', 'websocket', 'eventsource'].includes(request.resourceType())) {
            await route.abort('blockedbyclient');
            return;
          }
          const resource = await proxy.request(request.url(), request.resourceType(), viewport);
          if (request.isNavigationRequest() && resource.status >= 400) throw new PreviewFailure('DOCUMENT_BLOCKED', 'blocked');
          if (controller.signal.aborted) { await route.abort('blockedbyclient'); return; }
          await route.fulfill({ ...resource, body: Buffer.from(resource.body) });
        } catch (error) {
          if (!renderingFinished) fail(error);
          await route.abort('blockedbyclient').catch(() => {});
        }
      }));
      await step(context.addInitScript({ content: INIT_SCRIPT }));
      const page = await step(context.newPage());
      primaryPage ??= page;
      if (page !== primaryPage) throw new PreviewFailure('UNEXPECTED_BROWSER_PAGE');
      page.on('popup', (popup: BrowserPage) => { void popup.close().catch(error => fail(error)); });
      page.on('download', (download: { cancel(): Promise<void> }) => {
        void download.cancel().catch(() => {});
        fail(new PreviewFailure('DOWNLOAD_BLOCKED', 'blocked'));
      });
      page.on('framenavigated', (frame: { url(): string }) => {
        const url = frame.url();
        if (url === 'about:blank' || url === 'about:srcdoc') return;
        try { publicResourceUrl(url, proxy.deniedOrigins); } catch (error) { fail(error); }
      });
      page.on('dialog', (dialog: { dismiss(): Promise<void> }) => { void dialog.dismiss().catch(() => {}); });
      const cdp = await step(context.newCDPSession(page));
      if (typeof cdp.send !== 'function' || typeof cdp.detach !== 'function') throw new PreviewFailure('BROWSER_GUARD_UNSUPPORTED');
      await step(cdp.send('Page.setDownloadBehavior', { behavior: 'deny' }));
      const response = await step(page.goto(target, { waitUntil: 'domcontentloaded', timeout: 8000 }));
      if (!response || response.status() >= 400 || [204, 205, 304].includes(response.status())) throw new PreviewFailure('DOCUMENT_BLOCKED', 'blocked');
      const finalUrl = publicResourceUrl(page.url(), proxy.deniedOrigins);
      await step(page.evaluate(`(async () => {
        scrollTo(0, 0);
        await Promise.race([document.fonts?.ready, new Promise(resolve => setTimeout(resolve, 700))]);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      })()`));
      for (const quality of [78, 60, 42, 24, 10, 1]) {
        const screenshot = await step(cdp.send('Page.captureScreenshot', {
          format: 'webp', quality, fromSurface: true, captureBeyondViewport: false,
        }));
        const bytes = decodeBase64(screenshot.data, 8 * 1024 * 1024);
        const dimensions = webpDimensions(bytes);
        if (dimensions?.width !== profile.viewport.width || dimensions.height !== profile.viewport.height) throw new PreviewFailure('INVALID_SCREENSHOT_DIMENSIONS');
        if (bytes.byteLength <= CAPTURE_POLICY.maxImageBytes) {
          await step(cdp.detach());
          return { bytes, finalUrl };
        }
      }
      throw new PreviewFailure('SCREENSHOT_BYTE_LIMIT');
    };
    const [desktop, mobile] = await step(Promise.all([render('desktop'), render('mobile')]));
    renderingFinished = true;
    proxy.stop();
    if (!await step(close())) throw new PreviewFailure('BROWSER_CLOSE_UNCONFIRMED');
    for (const [path, bytes] of [[paths.desktop, desktop.bytes], [paths.mobile, mobile.bytes]] as const) {
      attemptedUploads.push(path);
      await step(api.upload(path, bytes, controller.signal));
    }
    if (failure) throw failure;
    result = {
      status: 'captured', finalUrl: desktop.finalUrl,
      desktopPath: paths.desktop, mobilePath: paths.mobile,
      desktopBytes: desktop.bytes.byteLength, mobileBytes: mobile.bytes.byteLength, durationMs: 0,
    };
  } catch (error) {
    diagnostic = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown capture failure';
    failure ??= captureError(error);
    result = { status: failure.status, failureCode: failure.code, durationMs: 0 };
  } finally {
    runtime.clearTimer(timer);
    proxy.stop();
    controller.abort(failure ?? new PreviewFailure('CAPTURE_FINISHED'));
  }
  const closureConfirmed = launchSettled && await close();
  if (!closureConfirmed) result = { status: 'unavailable', failureCode: 'BROWSER_CLOSE_UNCONFIRMED', durationMs: CAPTURE_POLICY.deadlineMs };
  result!.durationMs = closureConfirmed ? Math.max(1, Math.min(CAPTURE_POLICY.deadlineMs, runtime.now() - started)) : CAPTURE_POLICY.deadlineMs;
  return {
    result: result!, cleanupPaths: result!.status === 'captured' ? [] : attemptedUploads,
    closureConfirmed,
    diagnostic,
    settlement: launchPromise ? launchPromise.then(() => close(), () => undefined) : Promise.resolve(),
  };
}
