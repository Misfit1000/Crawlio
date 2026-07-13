import { SecurityIssue, SecuritySeverity } from '../types';
import { securityCheckCopy } from './copy';

export interface SecurityCheckDef {
  id: string;
  category: string;
  severity: SecuritySeverity;
  title: string;
  description: string;
  recommendation: string;
  weight: number;
}

export const SECURITY_CHECK_REGISTRY: Record<string, SecurityCheckDef> = {};

export function registerSecurityCheck(def: SecurityCheckDef) {
  const copy = securityCheckCopy(def.id);
  SECURITY_CHECK_REGISTRY[def.id] = { ...def, ...copy };
}
