export type SitePreviewStatus = 'queued' | 'running' | 'captured' | 'blocked' | 'quota_exhausted' | 'unavailable';
export interface SitePreviewAsset { url: string; width: number; height: number }
export interface SitePreview {
  status: SitePreviewStatus;
  targetUrl: string;
  finalUrl?: string | null;
  capturedAt?: string | null;
  expiresAt?: string | null;
  stale?: boolean;
  failureCode?: string | null;
  desktop?: SitePreviewAsset;
  mobile?: SitePreviewAsset;
}
