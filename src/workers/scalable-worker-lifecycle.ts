const stoppingWorkers = new Set<string>();

// Sticky for this process: a stopped worker must not begin another slice.
export function requestScalableWorkerStop(workerId: string): void {
  stoppingWorkers.add(workerId);
}

export function isScalableWorkerStopRequested(workerId: string): boolean {
  return stoppingWorkers.has(workerId);
}
