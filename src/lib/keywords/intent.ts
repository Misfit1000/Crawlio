export function classifyIntent(keyword: string): string {
  const normalized = keyword.toLowerCase();
  
  const informational = ["how", "what", "why", "guide", "tips", "tutorial", "learn", "examples", "ideas", "ways"];
  const commercial = ["best", "top", "review", "compare", "vs", "versus", "alternatives"];
  const transactional = ["buy", "price", "cost", "hire", "service", "near me", "cheap", "coupon", "discount", "software"];
  const navigational = ["login", "sign in", "app", "dashboard"];

  if (navigational.some(word => normalized.includes(word))) return "Navigational";
  if (transactional.some(word => normalized.includes(word))) return "Transactional";
  if (commercial.some(word => normalized.includes(word))) return "Commercial";
  if (informational.some(word => normalized.includes(word))) return "Informational";
  
  return "Informational"; // Default
}

export function getFunnelStage(intent: string): string {
  switch (intent) {
    case "Navigational": return "Awareness";
    case "Informational": return "Awareness";
    case "Commercial": return "Consideration";
    case "Transactional": return "Decision";
    default: return "Awareness";
  }
}
