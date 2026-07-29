import { parsePublicHttpUrl } from '../security/safe-public-fetch';

export function normalizePublicBlogSourceUrl(value: unknown) {
  return parsePublicHttpUrl(String(value || '')).toString();
}
