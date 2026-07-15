export const APPLICATION_VERSION = '1.0.0-beta';
export const API_SCHEMA_VERSION = 12;
export const AUDIT_ENGINE_VERSION = '2026.07';
export const SCORING_VERSION = '2.0';
export const CHECK_REGISTRY_VERSION = '2.0';

function firstDefined(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim() || 'local';
}

export function getCommitIdentifier() {
  return firstDefined(
    process.env.VERCEL_GIT_COMMIT_SHA,
    process.env.RENDER_GIT_COMMIT,
    process.env.GIT_COMMIT_SHA,
    process.env.COMMIT_SHA,
  ).slice(0, 40);
}

export function getBuildTimestamp() {
  const configured = [process.env.BUILD_TIMESTAMP, process.env.VERCEL_DEPLOYMENT_CREATED_AT, process.env.RENDER_DEPLOYED_AT].find((value) => value?.trim())?.trim();
  return configured && Number.isFinite(new Date(configured).getTime()) ? new Date(configured).toISOString() : new Date().toISOString();
}

export function publicVersionPayload() {
  return {
    applicationVersion: APPLICATION_VERSION,
    commitIdentifier: getCommitIdentifier(),
    buildTimestamp: getBuildTimestamp(),
    apiSchemaVersion: API_SCHEMA_VERSION,
    auditEngineVersion: AUDIT_ENGINE_VERSION,
    scoringVersion: SCORING_VERSION,
    checkRegistryVersion: CHECK_REGISTRY_VERSION,
  };
}

export function deploymentVersionRow(component: 'frontend' | 'api' | 'worker') {
  const value = publicVersionPayload();
  return {
    component,
    application_version: value.applicationVersion,
    commit_identifier: value.commitIdentifier,
    build_timestamp: value.buildTimestamp,
    api_schema_version: value.apiSchemaVersion,
    audit_engine_version: value.auditEngineVersion,
    scoring_version: value.scoringVersion,
    check_registry_version: value.checkRegistryVersion,
    updated_at: new Date().toISOString(),
  };
}
