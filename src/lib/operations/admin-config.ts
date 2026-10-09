import { ApiError } from '../api/errors';

export function validatePlatformControls(input: unknown): Record<string, boolean | number | string[]> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError('INVALID_PLATFORM_CONTROLS', 'Provide supported platform controls.', 400);
  const booleanKeys = new Set(['guestAuditEnabled','maintenanceMode','pauseFreeSubmissions','captchaRequired']);
  const bounds: Record<string, [number, number]> = { queueFairnessPaidBurst: [1,20], softQueueWarning: [1,10000], hardQueueLimit: [1,10000] };
  const result: Record<string, boolean | number | string[]> = {};
  for (const [key, value] of Object.entries(input)) {
    if (booleanKeys.has(key) && typeof value === 'boolean') result[key] = value;
    else if (bounds[key] && typeof value === 'number' && Number.isInteger(value) && value >= bounds[key][0] && value <= bounds[key][1]) result[key] = value;
    else if (key === 'disabledAuditModes' && Array.isArray(value) && value.length <= 3 && value.every(mode => ['quick','standard','deep'].includes(mode))) result[key] = [...new Set(value)];
    else throw new ApiError('INVALID_PLATFORM_CONTROL', 'A platform control has an unsupported name or value.', 400);
  }
  return result;
}
