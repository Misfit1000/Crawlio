import type { CaptureBrowser, Runtime } from './contracts';

export const runtime: Runtime = {
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: timer => clearTimeout(timer),
  launch: async (binding, options) => {
    const { launch } = await import('@cloudflare/playwright');
    // No unguarded fallback, session reuse, or direct target-fetch path.
    return await launch(binding as Parameters<typeof launch>[0], options) as unknown as CaptureBrowser;
  },
};
