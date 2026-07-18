declare const __CRAWLIO_RELEASE__: string;
declare const __CRAWLIO_ENVIRONMENT__: string;

interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENABLE_DEVELOPMENT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
