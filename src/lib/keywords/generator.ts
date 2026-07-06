import { classifyIntent, getFunnelStage } from './intent';
import { estimateDifficulty } from './difficulty';
import { calculateOpportunityScore } from './opportunity';

export interface KeywordResult {
  id: string;
  keyword: string;
  intent: string;
  funnelStage: string;
  relevanceScore: number;
  estimatedDifficulty: number;
  importedDifficulty?: number;
  importedVolume?: number;
  importedCpc?: number;
  opportunityScore: number;
  clusterId?: string;
  suggestedContentType: string;
  source: string;
}

export function generateKeywords(seed: string): KeywordResult[] {
  const normalizedSeed = seed.toLowerCase().trim();
  const results: KeywordResult[] = [];
  let idCounter = 1;

  const addResult = (kw: string, source: string, rel: number = 70) => {
    const diff = estimateDifficulty(kw);
    const intent = classifyIntent(kw);
    
    let contentType = "Blog Post";
    if (intent === "Transactional") contentType = "Service/Product Page";
    if (intent === "Commercial") contentType = "Comparison/Review Page";

    results.push({
      id: String(idCounter++),
      keyword: kw,
      intent,
      funnelStage: getFunnelStage(intent),
      relevanceScore: rel,
      estimatedDifficulty: diff,
      opportunityScore: calculateOpportunityScore(kw, rel),
      suggestedContentType: contentType,
      source
    });
  };

  // 1. Core variations
  addResult(`${normalizedSeed} services`, 'Core Variation', 90);
  addResult(`${normalizedSeed} software`, 'Core Variation', 90);
  addResult(`what is ${normalizedSeed}`, 'Question Modifier', 85);
  addResult(`how to do ${normalizedSeed}`, 'Question Modifier', 85);
  
  // 2. Commercial Modifiers
  const commercialMods = ['best', 'top', 'affordable', 'custom'];
  commercialMods.forEach(mod => addResult(`${mod} ${normalizedSeed}`, 'Commercial Modifier', 80));
  
  // 3. Local Modifiers
  const localMods = ['near me', 'company', 'agency'];
  localMods.forEach(mod => addResult(`${normalizedSeed} ${mod}`, 'Local Modifier', 75));
  
  // 4. Problem/Solution
  addResult(`${normalizedSeed} mistakes`, 'Problem/Solution', 85);
  addResult(`${normalizedSeed} checklist`, 'Problem/Solution', 85);
  addResult(`outsourced ${normalizedSeed}`, 'Solution Modifier', 80);

  // 5. Comparison
  addResult(`${normalizedSeed} vs accounting`, 'Comparison Modifier', 70);

  // Filter out exact duplicates
  const uniqueResults = Array.from(new Map(results.map(item => [item.keyword, item])).values());
  
  return uniqueResults;
}
