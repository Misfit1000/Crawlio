export function estimateDifficulty(keyword: string): number {
  let score = 50; // Base score
  
  const words = keyword.trim().split(/\s+/).length;
  
  // Longer tail keywords are usually easier
  if (words >= 4) score -= 15;
  if (words >= 6) score -= 10;
  if (words === 1) score += 20;
  if (words === 2) score += 10;
  
  const normalized = keyword.toLowerCase();
  
  // High competition modifiers
  const highComp = ["best", "top", "software", "service", "buy", "hire"];
  if (highComp.some(w => normalized.includes(w))) {
    score += 15;
  }
  
  return Math.min(Math.max(Math.round(score), 0), 100);
}
