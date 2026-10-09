export function createLiveEmissionScheduler(options: {
  emit: () => void;
  hidden: () => boolean;
  requestFrame: (callback: () => void) => number;
  cancelFrame: (id: number) => void;
}) {
  let frame: number | undefined;
  let dirty = false;
  let disposed = false;
  const flush = () => {
    frame = undefined;
    if (disposed || !dirty || options.hidden()) return;
    dirty = false;
    options.emit();
  };
  return {
    request(immediate = false) {
      if (disposed) return;
      dirty = true;
      if (immediate) {
        if (frame !== undefined) options.cancelFrame(frame);
        frame = undefined;
        // Terminal evidence must not wait for a paint or a hidden-tab frame.
        dirty = false;
        options.emit();
      } else if (!options.hidden() && frame === undefined) {
        frame = options.requestFrame(flush);
      }
    },
    dispose() {
      disposed = true;
      dirty = false;
      if (frame !== undefined) options.cancelFrame(frame);
      frame = undefined;
    },
  };
}
