import { KeywordResult } from './generator';
import { removeStopwords } from './stopwords';

export interface Cluster {
  id: string;
  name: string;
  primaryKeyword: string;
  keywords: string[];
  intent: string;
  opportunityScore: number;
  difficulty: number;
  suggestedContentType: string;
}

function jaccardSimilarity(str1: string, str2: string): number {
  const set1 = new Set(str1.split(/\s+/));
  const set2 = new Set(str2.split(/\s+/));
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return intersection.size / union.size;
}

export function clusterKeywords(keywords: KeywordResult[]): Cluster[] {
  const clusters: Cluster[] = [];
  const processed = new Set<string>();

  for (const kw of keywords) {
    if (processed.has(kw.keyword)) continue;

    const currentCluster: string[] = [kw.keyword];
    processed.add(kw.keyword);
    
    const kwClean = removeStopwords(kw.keyword.toLowerCase());

    for (const other of keywords) {
      if (processed.has(other.keyword)) continue;
      
      const otherClean = removeStopwords(other.keyword.toLowerCase());
      
      // Group if similarity > 0.4 or one is a substring of the other (after stopword removal)
      if (jaccardSimilarity(kwClean, otherClean) > 0.4 || 
          kwClean.includes(otherClean) || 
          otherClean.includes(kwClean)) {
        currentCluster.push(other.keyword);
        processed.add(other.keyword);
      }
    }

    // Pick primary keyword (usually shortest or highest volume, here we pick shortest)
    const primary = currentCluster.reduce((a, b) => a.length <= b.length ? a : b);
    const primaryResult = keywords.find(k => k.keyword === primary) || kw;

    // Calculate cluster averages
    const clusterResults = keywords.filter(k => currentCluster.includes(k.keyword));
    const avgOpp = clusterResults.reduce((sum, k) => sum + k.opportunityScore, 0) / currentCluster.length;
    const avgDiff = clusterResults.reduce((sum, k) => sum + k.estimatedDifficulty, 0) / currentCluster.length;

    clusters.push({
      id: `cluster-${clusters.length + 1}`,
      name: primary,
      primaryKeyword: primary,
      keywords: currentCluster.filter(k => k !== primary),
      intent: primaryResult.intent,
      opportunityScore: Math.round(avgOpp),
      difficulty: Math.round(avgDiff),
      suggestedContentType: primaryResult.suggestedContentType
    });
  }

  return clusters;
}
