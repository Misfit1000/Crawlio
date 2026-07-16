import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
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
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(dirName, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(dirName, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

