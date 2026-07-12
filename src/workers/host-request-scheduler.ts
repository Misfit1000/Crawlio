type ScheduledOperation<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

type HostState = {
  active: number;
  nextAllowedAt: number;
  timer: NodeJS.Timeout | null;
  queue: Array<ScheduledOperation<unknown>>;
};

export class HostRequestScheduler {
  private readonly hosts = new Map<string, HostState>();

  constructor(
    private readonly maxConcurrentPerHost = 2,
    private readonly minimumIntervalMs = 150,
    private readonly now = Date.now,
  ) {}

  schedule<T>(url: string, run: () => Promise<T>): Promise<T> {
    const host = new URL(url).host.toLowerCase();
    const state = this.hosts.get(host) ?? { active: 0, nextAllowedAt: 0, timer: null, queue: [] };
    this.hosts.set(host, state);
    return new Promise<T>((resolve, reject) => {
      state.queue.push({ run, resolve, reject } as ScheduledOperation<unknown>);
      this.pump(host, state);
    });
  }

  private pump(host: string, state: HostState) {
    if (state.timer || state.active >= this.maxConcurrentPerHost || !state.queue.length) return;
    const delay = Math.max(0, state.nextAllowedAt - this.now());
    if (delay > 0) {
      state.timer = setTimeout(() => {
        state.timer = null;
        this.pump(host, state);
      }, delay);
      state.timer.unref?.();
      return;
    }

    const operation = state.queue.shift()!;
    state.active += 1;
    state.nextAllowedAt = this.now() + this.minimumIntervalMs;
    operation.run()
      .then(operation.resolve, operation.reject)
      .finally(() => {
        state.active -= 1;
        if (!state.active && !state.queue.length && !state.timer) this.hosts.delete(host);
        else this.pump(host, state);
      });
    this.pump(host, state);
  }
}
