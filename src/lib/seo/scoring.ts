import { AuditIssue } from '../audit/types';

export function calculateScore(issues: AuditIssue[], pageCount: number = 1) {
  let criticalCount = 0;
  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;
  
  issues.forEach(i => {
    if (i.severity === 'critical') criticalCount++;
    else if (i.severity === 'high') highCount++;
    else if (i.severity === 'medium') mediumCount++;
    else if (i.severity === 'low') lowCount++;
  });
  
  const totalWeight = (criticalCount * 10) + (highCount * 5) + (mediumCount * 2) + lowCount;
  const baseScore = 100 - (totalWeight / Math.max(1, pageCount));
  const overallScore = Math.max(0, Math.min(100, Math.round(baseScore)));
  
  const categoryScores: any = {};
  const passedChecks: string[] = [];
  const topFixes = issues.filter(i => i.severity === 'critical' || i.severity === 'high').slice(0, 5).map(i => i.title);
  
  return {
    overallScore,
    categoryScores,
    passedChecks,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    topFixes,
    scoreExplanation: ''
  };
}
