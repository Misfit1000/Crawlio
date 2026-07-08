export function normalizeSupabaseProjectUrl(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return '';

  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}
