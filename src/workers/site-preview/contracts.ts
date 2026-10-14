export type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export interface BrowserBinding { fetch: Fetch }
export interface PreviewEnv {
  SITE_PREVIEW_ENABLED?: string;
  PREVIEW_PROXY_URL?: string;
  PREVIEW_CONTROL_SECRET?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  BROWSER?: BrowserBinding;
  SITE_PREVIEW_COORDINATOR?: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch: Fetch };
  };
}
export interface CaptureClaim {
  id: string;
  target_url: string;
  generation: number;
  desktop_path?: string | null;
  mobile_path?: string | null;
}
export interface CaptureResult {
  status: 'captured' | 'blocked' | 'quota_exhausted' | 'unavailable';
  finalUrl?: string;
  desktopPath?: string;
  mobilePath?: string;
  desktopBytes?: number;
  mobileBytes?: number;
  durationMs: number;
  failureCode?: string;
}
export interface DurableState {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<unknown>;
    getAlarm(): Promise<number | null>;
    setAlarm(time: number): Promise<void>;
  };
  waitUntil(promise: Promise<unknown>): void;
}
export interface BrowserRequest {
  url(): string;
  method(): string;
  resourceType(): string;
  isNavigationRequest(): boolean;
  frame(): { page(): BrowserPage };
}
export interface BrowserRoute {
  request(): BrowserRequest;
  abort(code?: string): Promise<void>;
  fulfill(options: { status: number; headers: Record<string, string>; body: Uint8Array }): Promise<void>;
}
export interface CDPSession {
  send(method: string, params?: Record<string, unknown>): Promise<any>;
  detach(): Promise<void>;
}
export interface BrowserPage {
  goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<{ status(): number } | null>;
  url(): string;
  close(): Promise<void>;
  on(event: string, handler: (...args: any[]) => void): void;
  evaluate(expression: string): Promise<any>;
}
export interface BrowserContext {
  route(pattern: RegExp, handler: (route: BrowserRoute) => Promise<void>): Promise<void>;
  routeWebSocket(pattern: RegExp, handler: (socket: { close(): Promise<void> }) => Promise<void>): Promise<void>;
  addInitScript(options: { content: string }): Promise<void>;
  on(event: string, handler: (...args: any[]) => void): void;
  newPage(): Promise<BrowserPage>;
  newCDPSession(page: BrowserPage): Promise<CDPSession>;
}
export interface CaptureBrowser {
  newContext(options: Record<string, unknown>): Promise<BrowserContext>;
  close(): Promise<void>;
}
export type Launch = (binding: BrowserBinding, options: { guardrails: { allowedDomains: string[] } }) => Promise<CaptureBrowser>;
export interface Runtime {
  fetch: Fetch;
  launch: Launch;
  now: () => number;
  setTimer: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
}
