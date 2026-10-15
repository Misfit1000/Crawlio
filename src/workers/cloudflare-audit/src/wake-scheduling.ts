export async function expediteIdleAlarm(storage: { getAlarm(): Promise<number | null>; setAlarm(at: number): Promise<void> }, running: boolean, now = Date.now) {
  if (running) return;
  const alarm = await storage.getAlarm();
  const next = now() + 10;
  if (!alarm || alarm > next) await storage.setAlarm(next);
}
