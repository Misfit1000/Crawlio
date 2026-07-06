import { classifyIntent } from './intent';
import { estimateDifficulty } from './difficulty';

export function calculateOpportunityScore(
  keyword: string,
  relevance: number = 70, // Default relevance
  importedVolume?: number,
  importedDifficulty?: number
): number {
  const intent = classifyIntent(keyword);
  let intentValue = 50;
  if (intent === "Transactional") intentValue = 100;
  if (intent === "Commercial") intentValue = 80;
  if (intent === "Informational") intentValue = 60;
  
  const words = keyword.trim().split(/\s+/).length;
  const longTailScore = words >= 4 ? 100 : (words === 3 ? 70 : 40);
  
  let volumeScore = 50;
  if (importedVolume) {
    if (importedVolume > 10000) volumeScore = 100;
    else if (importedVolume > 1000) volumeScore = 80;
    else if (importedVolume > 100) volumeScore = 60;
    else volumeScore = 30;
  }
  
  const difficulty = importedDifficulty ?? estimateDifficulty(keyword);
  const difficultyPenalty = difficulty * 0.5; // 0 to 50 penalty

  let score = 0;
  if (importedVolume) {
    score = (relevance * 0.35) + (intentValue * 0.20) + (longTailScore * 0.15) + (volumeScore * 0.30) - difficultyPenalty;
  } else {
    // Redistribute weight if no volume
    score = (relevance * 0.50) + (intentValue * 0.30) + (longTailScore * 0.20) - difficultyPenalty;
  }
  
  return Math.min(Math.max(Math.round(score), 0), 100);
}
