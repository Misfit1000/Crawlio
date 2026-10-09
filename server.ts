import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { readFile } from 'node:fs/promises';
import { buildPublicPageHtml } from './scripts/build-public-metadata.mjs';
import { publicPageForPath } from './src/components/public/public-pages.mjs';
import { isKnownWorkspacePath } from './src/app/routes';
import { apiRouter } from "./src/api/index";
import { securityRouter } from "./src/lib/security/api/index";
import { canonicalSiteOrigin, renderBlogNewsSitemap, renderBlogRss, renderBlogSitemap } from "./src/lib/blog/sitemap";
import { blogRepository } from "./src/lib/blog/repository";
import { renderBlogArticleHtml } from "./src/lib/blog/render";
import { normalizeBlogSlug } from "./src/lib/blog/slug";
import {
  apiErrorHandler,
  apiSecurityHeaders,
  createRateLimiter,
  jsonBodyParser,
  jsonParseErrorHandler,
  requireJsonContentType,
  strictCorsAndOrigin,
} from "./src/lib/api/http-hardening";
import { ApiError, requestIdMiddleware } from "./src/lib/api/errors";
import { publicVersionPayload } from "./src/lib/platform/version";

const dirName = typeof __dirname !== 'undefined' ? __dirname : process.cwd();

const configuredPort = Number(process.env.PORT || 3000);
const PORT = Number.isInteger(configuredPort) && configuredPort >= 1 && configuredPort <= 65535 ? configuredPort : 3000;
const legacyPaths = new Set(['/dashboard', '/seo-audit', '/audit-history', '/reports', '/settings']);
const clientPath = (pathname: string) => isKnownWorkspacePath(pathname) || legacyPaths.has(pathname) || ['/login', '/register', '/blog'].includes(pathname)
  || /^\/audit\/live\/[^/]+$/.test(pathname) || /^\/share\/[A-Za-z0-9_-]{40,80}$/.test(pathname);
const missingPage = { path: '/404', title: 'Page not found', description: 'This page does not exist. Browse Crawlio audits and tools.', kind: 'not-found', noindex: true };

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(requestIdMiddleware);
  app.use(apiSecurityHeaders);
  app.use(strictCorsAndOrigin);
  app.use(createRateLimiter({ namespace: 'local-api', windowMs: 60_000, maxRequests: 300 }));
  app.use(jsonBodyParser());
  app.use(jsonParseErrorHandler);
  app.use(requireJsonContentType);
  app.get('/api/version', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json(publicVersionPayload());
  });

  // Mount tool APIs
  app.use('/api/tools/audit/start', createRateLimiter({ namespace: 'local-audit-start', windowMs: 60_000, maxRequests: 20 }));
  app.use('/api/tools', apiRouter);
  app.use('/api/security-audit', securityRouter);
  app.get('/sitemap.xml', async (req, res, next) => {
    try {
      res.type('application/xml').send(await renderBlogSitemap(canonicalSiteOrigin(req)));
    } catch (error) {
      next(error);
    }
  });
  app.get('/rss.xml', async (req, res, next) => {
    try { res.type('application/rss+xml').send(await renderBlogRss(canonicalSiteOrigin(req))); } catch (error) { next(error); }
  });
  app.get('/news-sitemap.xml', async (req, res, next) => {
    try { res.type('application/xml').send(await renderBlogNewsSitemap(canonicalSiteOrigin(req))); } catch (error) { next(error); }
  });
  app.get('/blog/:slug', async (req, res, next) => {
    try {
      const post = await blogRepository.getPublishedBySlug(normalizeBlogSlug(req.params.slug));
      if (!post) return res.status(404).type('html').send('<!doctype html><html><head><meta name="robots" content="noindex"></head><body><h1>Article not found</h1><p><a href="/blog">Return to the blog</a></p></body></html>');
      if (!post.relatedArticles.length) {
        const related = await blogRepository.relatedPublished(post, 4);
        post.relatedArticles = related.map((item) => ({ postId: item.id, slug: item.slug, title: item.title, reason: item.topicCluster ? `More guidance about ${item.topicCluster}.` : '' }));
      }
      res.type('html').send(renderBlogArticleHtml(post, canonicalSiteOrigin(req)));
    } catch (error) { next(error); }
  });

  // Fallback 404 for API routes to always return JSON
  app.use('/api', (_req, _res, next) => next(new ApiError('API_ROUTE_NOT_FOUND', 'The requested API route was not found.', 404)));
  app.use(apiErrorHandler);

  // Vite middleware for development

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "custom",
    });
    app.use(vite.middlewares);
    app.get('*', async (req, res, next) => {
      try {
        const pathname = req.path.replace(/\/$/, '') || '/';
        const publicPage = publicPageForPath(pathname);
        const known = Boolean(publicPage) || clientPath(pathname);
        const page = publicPage || (known ? { path: pathname, title: pathname === '/blog' ? 'Crawlio blog' : 'Crawlio workspace', description: pathname === '/blog' ? 'Practical website auditing guides.' : 'Sign in to manage private audits and reports.', kind: 'private', noindex: pathname !== '/blog' } : missingPage);
        const source = await readFile(path.join(dirName, 'index.html'), 'utf8');
        const html = buildPublicPageHtml(source, page, canonicalSiteOrigin(req));
        res.status(known ? 200 : 404).type('html').send(await vite.transformIndexHtml(req.originalUrl, html));
      } catch (error) { next(error); }
    });
  } else {
    const dist = path.basename(dirName) === 'dist' ? dirName : path.join(dirName, 'dist');
    app.use(express.static(dist, { redirect: false }));
    app.get("*", (req, res) => {
      const pathname = req.path.replace(/\/$/, '') || '/';
      if (publicPageForPath(pathname)) return res.sendFile(path.join(dist, pathname === '/' ? 'index.html' : `${pathname.slice(1)}/index.html`));
      if (clientPath(pathname)) return res.sendFile(path.join(dist, 'app-shell.html'));
      res.status(404).sendFile(path.join(dist, '404.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

