import { Router } from 'express';

import { generateKeywords } from '../lib/keywords/generator';

import { clusterKeywords } from '../lib/keywords/clustering';

import { buildContentBrief } from '../lib/keywords/content-brief';

import { ApiError } from '../lib/api/errors';


export const apiRouter = Router();


function asyncJsonRoute(handler: any) {
  return async (req: any, res: any, next: any) => {
    try {
      await handler(req, res, next);
    } catch (error: unknown) {
      next(error);
    }
  };
}

apiRouter.post('/keyword/research', asyncJsonRoute((req, res) => {
  const seed = String(req.body?.seed || '').trim();
  if (!seed || seed.length > 200) throw new ApiError('INVALID_KEYWORD_SEED', 'Enter a keyword between 1 and 200 characters.', 400);
  const keywords = generateKeywords(seed);
  res.json({ success: true, data: { keywords } });
}));

apiRouter.post('/clusters', asyncJsonRoute((req, res) => {
  const { keywords } = req.body || {};
  if (!Array.isArray(keywords) || !keywords.length || keywords.length > 500) throw new ApiError('INVALID_KEYWORD_LIST', 'Provide between 1 and 500 keywords.', 400);
  const clusters = clusterKeywords(keywords.slice(0, 500));
  res.json({ success: true, data: { clusters } });
}));

apiRouter.post('/content-brief', asyncJsonRoute((req, res) => {
  const { cluster } = req.body || {};
  if (!cluster || typeof cluster !== 'object') throw new ApiError('INVALID_CONTENT_CLUSTER', 'A valid keyword cluster is required.', 400);
  const brief = buildContentBrief(cluster);
  res.json({ success: true, data: { brief } });
}));

apiRouter.post('/competitor-gap', asyncJsonRoute(async (req, res) => {
  return res.status(501).json({
    success: false,
    error: 'Competitor Gap is temporarily disabled while worker-backed analysis is being enabled.',
  });
}));
