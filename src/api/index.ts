import { Router } from 'express';
import { fetchAndAnalyze } from '../lib/seo/fetch-url';
import { generateKeywords } from '../lib/keywords/generator';
import { clusterKeywords } from '../lib/keywords/clustering';
import { buildContentBrief } from '../lib/keywords/content-brief';
import { analyzeCompetitorGap } from '../lib/keywords/competitor-gap';

export const apiRouter = Router();

apiRouter.post('/keyword/research', (req, res) => {
  const { seed } = req.body;
  if (!seed) return res.status(400).json({ error: 'Seed keyword is required' });
  
  const keywords = generateKeywords(seed);
  res.json({ keywords });
});

apiRouter.post('/website/analyze', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  
  const result = await fetchAndAnalyze(url);
  res.json(result);
});

apiRouter.post('/clusters', (req, res) => {
  const { keywords } = req.body;
  if (!keywords || !Array.isArray(keywords)) return res.status(400).json({ error: 'Keywords array is required' });
  
  const clusters = clusterKeywords(keywords);
  res.json({ clusters });
});

apiRouter.post('/content-brief', (req, res) => {
  const { cluster } = req.body;
  if (!cluster) return res.status(400).json({ error: 'Cluster object is required' });
  
  const brief = buildContentBrief(cluster);
  res.json({ brief });
});

apiRouter.post('/competitor-gap', async (req, res) => {
  const { myUrl, competitorUrls } = req.body;
  
  // This is a simplified version. In a real app, we would crawl all URLs.
  // For demonstration, we'll fetch just the homepages.
  
  try {
    const myResult = await fetchAndAnalyze(myUrl);
    const myKeywords = myResult.success && myResult.data ? myResult.data.topKeywords : [];
    
    const competitorKeywords: Record<string, string[]> = {};
    for (const url of (competitorUrls || [])) {
      const result = await fetchAndAnalyze(url);
      if (result.success && result.data) {
        let domain = url;
        try { domain = new URL(url).hostname; } catch(e){}
        competitorKeywords[domain] = result.data.topKeywords;
      }
    }
    
    const gaps = analyzeCompetitorGap(myKeywords, competitorKeywords);
    res.json({ gaps });
  } catch(e: any) {
    res.status(500).json({ error: e.message });
  }
});
