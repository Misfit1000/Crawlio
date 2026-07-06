
import { parseHtml, ParsedPageData } from './html-parser';
import { normalizeUrl, isSameDomain, stripTrackingParams } from './url-utils';
import { fetchRobotsTxt, isBlockedByRobots, getSitemapUrlsFromRobots, parseRobotsTxt } from './robots';
import { auditStore } from '../audit/audit-store';
import { eventEmitter } from '../audit/event-emitter';

export interface CrawlResult {
  url: string;
  finalUrl: string;
  status: number;
  success: boolean;
  error?: string;
  data?: ParsedPageData;
  headers: Record<string, string>;
  loadTimeMs: number;
  pageSizeBytes: number;
  contentType: string;
  depth?: number;
  discoveredFrom?: string;
}

export interface CrawlOptions {
  auditId?: string;
  maxPages?: number;
  timeoutMs?: number;
  concurrency?: number;
  respectRobots?: boolean;
}

interface QueueItem {
  url: string;
  depth: number;
  discoveredFrom?: string;
}

export async function crawlDomain(startUrl: string, options: CrawlOptions = {}): Promise<CrawlResult[]> {
  const maxPages = options.maxPages || 25;
  const timeoutMs = options.timeoutMs || 10000;
  const concurrency = options.concurrency || 3;
  const respectRobots = options.respectRobots !== false;
  
  let robotsTxt = '';
  if (options.auditId) {
    eventEmitter.emitStepStarted(options.auditId, 'Checking robots.txt', 'Fetching robots.txt');
    eventEmitter.emitAuditEvent(options.auditId, { progress: 5 });
  }
  if (respectRobots) {
    const origin = new URL(startUrl).origin;
    const r = await fetchRobotsTxt(origin);
    if (r) {
      robotsTxt = r;
    }
  }

  const visited = new Set<string>();
  const toVisit: QueueItem[] = [{ url: startUrl, depth: 0 }];
  const results: CrawlResult[] = [];
  
  let activeWorkers = 0;
  let isDone = false;
  
  return new Promise((resolve) => {
    const processQueue = async () => {
      if (options.auditId) {
        auditStore.appendAuditEvent(options.auditId, {
          type: 'page_discovered',
          pagesDiscovered: visited.size + toVisit.length,
          pagesCrawled: results.length,
          progress: 15 + Math.floor((results.length / maxPages) * 40)
        });
      }
      if (visited.size >= maxPages && activeWorkers === 0) {
        if (!isDone) {
          isDone = true;
          resolve(results);
        }
        return;
      }
      
      if (toVisit.length === 0 && activeWorkers === 0) {
        if (!isDone) {
          isDone = true;
          resolve(results);
        }
        return;
      }
      
      while (activeWorkers < concurrency && toVisit.length > 0 && visited.size < maxPages) {
        const item = toVisit.shift()!;
        let currentUrl = stripTrackingParams(item.url);
        
        if (visited.has(currentUrl)) continue;
        visited.add(currentUrl);
        
        if (respectRobots && robotsTxt && isBlockedByRobots(currentUrl, parseRobotsTxt(robotsTxt))) {
          results.push({
            url: currentUrl,
            finalUrl: currentUrl,
            status: 403,
            success: false,
            error: 'Blocked by robots.txt',
            headers: {},
            loadTimeMs: 0,
            pageSizeBytes: 0,
            contentType: '',
            depth: item.depth,
            discoveredFrom: item.discoveredFrom
          });
          continue;
        }

        activeWorkers++;
        
        if (options.auditId) eventEmitter.emitPageCrawling(options.auditId, currentUrl);
        // Use an IIFE so the async work doesn't block this while-loop execution.
        (async (url, depth, discoveredFrom) => {
          try {
            const startTime = Date.now();
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            const response = await fetch(url, {
              headers: { 'User-Agent': 'SEOIntelBot/1.0 (Local Analysis Tools)' },
              signal: controller.signal
            });
            clearTimeout(timeout);
            const loadTimeMs = Date.now() - startTime;
            const headers: Record<string, string> = {};
            response.headers.forEach((val, key) => { headers[key.toLowerCase()] = val; });
            const contentType = headers['content-type'] || '';
            
            if (!contentType.includes('text/html')) {
              if (options.auditId) {
                eventEmitter.emitPageCrawled(options.auditId, url);
                eventEmitter.emitAuditEvent(options.auditId, { progress: 5 + Math.floor((results.length / (options.maxPages || 25)) * 50) });
              }
              results.push({
                url,
                finalUrl: response.url,
                status: response.status,
                success: true,
                headers,
                loadTimeMs,
                pageSizeBytes: 0,
                contentType,
                depth,
                discoveredFrom
              });
            } else {
              const html = await response.text();
              const pageSizeBytes = Buffer.byteLength(html, 'utf8');
              const parsedData = parseHtml(html, response.url);
              
              if (options.auditId) {
                eventEmitter.emitPageCrawled(options.auditId, url);
                eventEmitter.emitAuditEvent(options.auditId, { progress: 5 + Math.floor((results.length / (options.maxPages || 25)) * 50) });
              }

              results.push({
                url,
                finalUrl: response.url,
                status: response.status,
                success: true,
                data: parsedData,
                headers,
                loadTimeMs,
                pageSizeBytes,
                contentType,
                depth,
                discoveredFrom
              });
              
              for (const link of parsedData.internalLinks) {
                const normalized = normalizeUrl(link.href, response.url);
                if (normalized && isSameDomain(normalized, startUrl)) {
                  const cleanUrl = stripTrackingParams(normalized);
                  if (!visited.has(cleanUrl)) {
                    toVisit.push({ url: cleanUrl, depth: depth + 1, discoveredFrom: url });
                  }
                }
              }
            }
          } catch (error: any) {
            if (options.auditId) {
              eventEmitter.emitPageFailed(options.auditId, url, error.message);
              eventEmitter.emitAuditEvent(options.auditId, { progress: 5 + Math.floor((results.length / (options.maxPages || 25)) * 50) });
            }
            results.push({
              url,
              finalUrl: url,
              status: 0,
              success: false,
              error: error.message,
              headers: {},
              loadTimeMs: 0,
              pageSizeBytes: 0,
              contentType: '',
              depth,
              discoveredFrom
            });
          } finally {
            activeWorkers--;
            processQueue();
          }
        })(currentUrl, item.depth, item.discoveredFrom);
      }
    };
    
    processQueue();
  });
}
