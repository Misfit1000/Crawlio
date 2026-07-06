export interface GapKeyword {
  keyword: string;
  inMySite: boolean;
  competitorsUsing: string[]; // List of competitor domains using it
  gapType: 'Missing' | 'Shared' | 'Unique' | 'Competitor Only';
}

export function analyzeCompetitorGap(
  myKeywords: string[],
  competitorKeywords: Record<string, string[]>
): GapKeyword[] {
  const allKeywords = new Set<string>([...myKeywords]);
  const competitorDomains = Object.keys(competitorKeywords);
  
  for (const domain of competitorDomains) {
    competitorKeywords[domain].forEach(kw => allKeywords.add(kw));
  }

  const results: GapKeyword[] = [];

  for (const kw of allKeywords) {
    const inMySite = myKeywords.includes(kw);
    const competitorsUsing = competitorDomains.filter(domain => competitorKeywords[domain].includes(kw));
    
    let gapType: GapKeyword['gapType'] = 'Missing';
    
    if (inMySite && competitorsUsing.length === 0) {
      gapType = 'Unique';
    } else if (inMySite && competitorsUsing.length > 0) {
      gapType = 'Shared';
    } else if (!inMySite && competitorsUsing.length === competitorDomains.length && competitorDomains.length > 0) {
      gapType = 'Missing';
    } else {
      gapType = 'Competitor Only';
    }

    results.push({
      keyword: kw,
      inMySite,
      competitorsUsing,
      gapType
    });
  }

  return results.sort((a, b) => b.competitorsUsing.length - a.competitorsUsing.length);
}
