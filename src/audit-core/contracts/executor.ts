import type { AuditProfile } from './profile';

export type ExecutorType = 'render' | 'cloudflare';

export type ExecutorPreference = 'auto' | 'render' | 'cloudflare';

/**
 * Capability contract defining what a given executor can do and its versions.
 */
export interface ExecutorCapability {
  executorType: ExecutorType;
  healthy: boolean;
  auditEngineVersion: string;
  checkRegistryVersion: string;
  scoringVersion: string;
  evidenceVersion: string;
  supportedProfiles: AuditProfile['id'][];
}
