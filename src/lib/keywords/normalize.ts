export function normalizeKeyword(keyword: string): string {
  return keyword
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ') // Collapse spaces
    .trim();
}
