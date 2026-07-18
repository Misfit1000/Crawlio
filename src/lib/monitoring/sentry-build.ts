export type SentryBuildEnvironment = Record<string, string | undefined>;

function firstDefined(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim() || '';
}

export function resolveSentryEnvironment(env: SentryBuildEnvironment, mode = 'production') {
  const configured = firstDefined(env.SENTRY_ENVIRONMENT);
  if (configured) return configured;
  if (env.VERCEL_ENV === 'production') return 'production';
  if (env.VERCEL_ENV === 'preview') return 'preview';
  if (env.NODE_ENV === 'test' || mode === 'test') return 'test';
  return mode === 'production' ? 'production' : 'development';
}

export function resolveSentryRelease(env: SentryBuildEnvironment) {
  return firstDefined(
    env.SENTRY_RELEASE,
    env.VERCEL_GIT_COMMIT_SHA,
    env.RENDER_GIT_COMMIT,
    env.RAILWAY_GIT_COMMIT_SHA,
    env.GIT_COMMIT_SHA,
    env.COMMIT_SHA,
  ) || 'local';
}

export function resolveSentryBuildConfiguration(
  env: SentryBuildEnvironment,
  mode = 'production',
) {
  const release = resolveSentryRelease(env);
  const environment = resolveSentryEnvironment(env, mode);
  const sourceMapsConfigured = Boolean(
    env.SENTRY_AUTH_TOKEN?.trim()
    && env.SENTRY_ORG?.trim()
    && env.SENTRY_PROJECT?.trim()
    && release !== 'local',
  );

  return {
    environment,
    release,
    sourceMapsConfigured,
    sourceMapOptions: sourceMapsConfigured ? {
      authToken: env.SENTRY_AUTH_TOKEN!,
      org: env.SENTRY_ORG!,
      project: env.SENTRY_PROJECT!,
      release: { name: release },
      applicationKey: 'crawlio-web',
      sourcemaps: {
        assets: './dist/assets/**',
        filesToDeleteAfterUpload: './dist/**/*.map',
      },
      telemetry: false,
    } : null,
  };
}
