import { SecurityIssue } from '../types';
import './all-checks';
import { run as checkHttps } from './https';
import { run as checkHeaders } from './headers';
import { run as checkCookies } from './cookies';
import { run as checkCors } from './cors';
import { run as checkForms } from './forms';
import { run as checkInfoDisclosure } from './information-disclosure';
import { run as checkDependencySignals } from './dependency-signals';
import { run as checkClickjacking } from './clickjacking';
import { run as checkContentSecurity } from './content-security';
import { run as checkAuthSurface } from './auth-surface';
import { run as checkMetadata } from './metadata';
import { run as checkRobots } from './robots';
import { run as checkEmailTrust } from './email-trust';
import { run as checkMisconfiguration } from './misconfiguration';
import { run as checkExposedFiles } from './exposed-files';

import { eventEmitter } from '../../audit/event-emitter';

export async function runSecurityChecks(pageData: any, auditId?: string): Promise<SecurityIssue[]> {
  let issues: SecurityIssue[] = [];

  const checks = [
    { name: 'HTTPS Configuration', fn: checkHttps },
    { name: 'Security Headers', fn: checkHeaders },
    { name: 'Cookies Security', fn: checkCookies },
    { name: 'CORS Configuration', fn: checkCors },
    { name: 'Forms Security', fn: checkForms },
    { name: 'Information Disclosure', fn: checkInfoDisclosure },
    { name: 'Dependency Signals', fn: checkDependencySignals },
    { name: 'Clickjacking Protection', fn: checkClickjacking },
    { name: 'Content Security Policy', fn: checkContentSecurity },
    { name: 'Authentication Surface', fn: checkAuthSurface },
    { name: 'Security Metadata', fn: checkMetadata },
    { name: 'Robots.txt Security', fn: checkRobots },
    { name: 'Email Trust', fn: checkEmailTrust },
    { name: 'Server Misconfiguration', fn: checkMisconfiguration }
  ];

  for (const check of checks) {
    if (auditId) eventEmitter.emitCheckStarted(auditId, check.name, pageData.url);
    const resultIssues = check.fn(pageData);
    if (auditId) {
      resultIssues.forEach(issue => eventEmitter.emitIssueFound(auditId, issue));
      eventEmitter.emitCheckCompleted(auditId, check.name, pageData.url);
    }
    issues = issues.concat(resultIssues);
  }

  if (pageData.url && pageData.headers) {
    if (auditId) eventEmitter.emitCheckStarted(auditId, 'Exposed Files', pageData.url);
    const resultIssues = await checkExposedFiles(pageData);
    if (auditId) {
      resultIssues.forEach(issue => eventEmitter.emitIssueFound(auditId, issue));
      eventEmitter.emitCheckCompleted(auditId, 'Exposed Files', pageData.url);
    }
    issues = issues.concat(resultIssues);
  }

  return issues;
}
