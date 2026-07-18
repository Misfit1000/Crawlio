import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import path from 'path';
import {defineConfig} from 'vite';
import { resolveSentryBuildConfiguration } from './src/lib/monitoring/sentry-build';

export default defineConfig(({ mode }) => {
  const sentry = resolveSentryBuildConfiguration(process.env, mode);
  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(sentry.sourceMapOptions ? [sentryVitePlugin(sentry.sourceMapOptions)] : []),
    ],
    define: {
      __CRAWLIO_RELEASE__: JSON.stringify(sentry.release),
      __CRAWLIO_ENVIRONMENT__: JSON.stringify(sentry.environment),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    build: {
      // Hidden maps are generated only for authenticated uploads and deleted by
      // the Sentry plugin after upload, so they are not deployed publicly.
      sourcemap: sentry.sourceMapsConfigured ? 'hidden' : false,
      chunkSizeWarningLimit: 500,
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalizedId = id.replace(/\\/g, '/');
            if (!normalizedId.includes('node_modules')) return;
            if (normalizedId.includes('/@sentry/')) {
              return 'sentry-vendor';
            }
            if (normalizedId.includes('/react/') || normalizedId.includes('/react-dom/')) {
              return 'react-vendor';
            }
            if (normalizedId.includes('@supabase')) {
              return 'supabase-vendor';
            }
            if (normalizedId.includes('/lucide-react/')) {
              return 'icons-vendor';
            }
            if (normalizedId.includes('/motion/')) {
              return 'motion-vendor';
            }
          },
        },
      },
    },
  };
});
