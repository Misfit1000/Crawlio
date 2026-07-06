import { Router } from 'express';
import { crawlDomain } from '../lib/seo/crawler';
import { auditFullCrawl } from '../lib/seo/page-audit';
import { generateKeywords } from '../lib/keywords/generator';
import { clusterKeywords } from '../lib/keywords/clustering';
import { buildContentBrief } from '../lib/keywords/content-brief';
import { analyzeCompetitorGap } from '../lib/keywords/competitor-gap';
import { auditStore } from '../lib/audit/audit-store';
import { runAuditJob } from '../lib/audit/audit-runner';

export const apiRouter = Router();

apiRouter.post('/audit/start', (req, res) => {
  const { url, maxPages } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  
  const jobId = auditStore.createJob(url);
  // Start job asynchronously
  runAuditJob(jobId, maxPages || 25);
  
  res.json({ jobId });
});

apiRouter.get('/audit/status/:id', (req, res) => {
  const job = auditStore.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ status: job.status, jobId: job.jobId, pagesCrawled: job.pagesCrawled });
});

apiRouter.get('/audit/result/:id', (req, res) => {
  const job = auditStore.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

apiRouter.post('/audit/rerun/:id', (req, res) => {
  const job = auditStore.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  
  auditStore.updateJob(job.jobId, { status: 'pending', pagesCrawled: 0, error: undefined });
  runAuditJob(job.jobId, 25);
  
  res.json({ success: true });
});

apiRouter.post('/keyword/research', (req, res) => {
  const { seed } = req.body;
  if (!seed) return res.status(400).json({ error: 'Seed keyword is required' });
  
  const keywords = generateKeywords(seed);
  res.json({ keywords });
});

apiRouter.post('/website/analyze', async (req, res) => {
  const { url, maxPages } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  
  try {
    const crawls = await crawlDomain(url, { maxPages: maxPages || 25 });
    const audit = auditFullCrawl(crawls);
    
    // For single page/initial URL representation
    const initialCrawl = crawls.find(c => c.url === url || c.finalUrl === url) || crawls[0];
    
    res.json({ 
      success: true, 
      crawledPages: crawls.length,
      data: initialCrawl?.data, 
      fullAudit: audit,
      audit: audit.pageResults.find(p => p.url === initialCrawl?.url)?.audit || audit.pageResults[0]?.audit
    });
  } catch(e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
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
  const { myUrl, competitorUrls, maxPages } = req.body;
  
  try {
    const myCrawls = await crawlDomain(myUrl, { maxPages: maxPages || 25 });
    const myPhrases = new Set<string>();
    myCrawls.forEach(c => c.data?.topPhrases.forEach(p => myPhrases.add(p)));
    myCrawls.forEach(c => c.data?.topKeywords.forEach(p => myPhrases.add(p)));
    const myKeywords = Array.from(myPhrases);
    
    const competitorKeywords: Record<string, string[]> = {};
    const crawledCounts: Record<string, number> = {};
    crawledCounts[myUrl] = myCrawls.length;
    
    for (const url of (competitorUrls || [])) {
      let domain = url;
      try { domain = new URL(url).hostname; } catch(e){}
      
      const crawls = await crawlDomain(url, { maxPages: maxPages || 25 });
      const phrases = new Set<string>();
      crawls.forEach(c => c.data?.topPhrases.forEach(p => phrases.add(p)));
      crawls.forEach(c => c.data?.topKeywords.forEach(p => phrases.add(p)));
      competitorKeywords[domain] = Array.from(phrases);
      crawledCounts[url] = crawls.length;
    }
    
    const gaps = analyzeCompetitorGap(myKeywords, competitorKeywords);
    res.json({ gaps, crawledCounts });
  } catch(e: any) {
    res.status(500).json({ error: e.message });
  }
});
