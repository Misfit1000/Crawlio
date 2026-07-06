import { Cluster } from './clustering';

export interface ContentBrief {
  titleTemplates: string[];
  metaDescriptionTemplates: string[];
  h1Suggestions: string[];
  h2Outline: string[];
  faqs: string[];
  relatedKeywords: string[];
  targetIntent: string;
  suggestedFormat: string;
  wordCount: string;
}

export function buildContentBrief(cluster: Cluster): ContentBrief {
  const primary = cluster.primaryKeyword;
  const capitalized = primary.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  
  const brief: ContentBrief = {
    titleTemplates: [],
    metaDescriptionTemplates: [],
    h1Suggestions: [],
    h2Outline: [],
    faqs: [],
    relatedKeywords: cluster.keywords,
    targetIntent: cluster.intent,
    suggestedFormat: cluster.suggestedContentType,
    wordCount: "1000 - 1500 words"
  };

  if (cluster.intent === "Informational") {
    brief.titleTemplates = [
      `What is ${capitalized}? A Complete Guide`,
      `The Ultimate Guide to ${capitalized} in ${new Date().getFullYear()}`
    ];
    brief.metaDescriptionTemplates = [
      `Learn everything you need to know about ${primary}. Discover how it works, benefits, and common mistakes to avoid.`,
    ];
    brief.h1Suggestions = [`What is ${capitalized}?`, `Complete Guide to ${capitalized}`];
    brief.h2Outline = [
      `Introduction to ${capitalized}`,
      `How ${capitalized} Works`,
      `Key Benefits of ${capitalized}`,
      `Common Mistakes to Avoid`,
      `Conclusion`
    ];
    brief.faqs = [
      `What is the main purpose of ${primary}?`,
      `How do I get started with ${primary}?`,
      `Is ${primary} worth the investment?`
    ];
  } else if (cluster.intent === "Commercial") {
    brief.titleTemplates = [
      `Best ${capitalized} Services in ${new Date().getFullYear()}`,
      `Top 10 ${capitalized} Options Compared`
    ];
    brief.metaDescriptionTemplates = [
      `Comparing the best ${primary} options? Read our comprehensive review to find the perfect fit for your needs and budget.`,
    ];
    brief.h1Suggestions = [`Best ${capitalized} Options`, `Comparing ${capitalized} Services`];
    brief.h2Outline = [
      `Top ${capitalized} Reviews`,
      `Comparison Table`,
      `Key Features to Look For`,
      `Pricing Guide`,
      `Final Verdict`
    ];
    brief.faqs = [
      `Which ${primary} is the best overall?`,
      `How much does ${primary} typically cost?`,
      `What are the alternatives to ${primary}?`
    ];
  } else if (cluster.intent === "Transactional") {
    brief.titleTemplates = [
      `${capitalized} Services - Expert Help`,
      `Affordable ${capitalized} Near You`
    ];
    brief.metaDescriptionTemplates = [
      `Need professional ${primary}? We offer expert services at competitive prices. Contact us today for a free quote.`,
    ];
    brief.h1Suggestions = [`Professional ${capitalized} Services`, `Expert ${capitalized}`];
    brief.h2Outline = [
      `Our ${capitalized} Services`,
      `Why Choose Us for ${capitalized}?`,
      `Pricing Plans`,
      `Client Testimonials`,
      `Get a Free Quote`
    ];
    brief.faqs = [
      `How long does the ${primary} process take?`,
      `What is included in your ${primary} service?`,
      `Do you offer guarantees for ${primary}?`
    ];
    brief.wordCount = "500 - 800 words";
  } else {
    // Navigational or default
    brief.titleTemplates = [`${capitalized}`];
    brief.metaDescriptionTemplates = [`Official page for ${primary}.`];
    brief.h1Suggestions = [`${capitalized}`];
    brief.h2Outline = [`About ${capitalized}`];
    brief.faqs = [];
    brief.wordCount = "300 - 500 words";
  }

  return brief;
}
