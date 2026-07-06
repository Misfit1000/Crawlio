# KeywordsIntel

KeywordsIntel has been rebuilt into a professional, full-featured SEO keyword research and SEO intelligence web app that operates **entirely without external AI/LLM APIs**.

## Features

- **Local Keyword Research**: Deterministic, rule-based keyword variation generation using modifier templates and n-gram expansion.
- **Website Keyword Extraction**: Built-in website crawler (`cheerio`) to extract meta tags, headers, paragraphs, and analyze term frequency (TF-IDF).
- **Competitor Keyword Gap**: Compare extracted keyword topics from your site against competitors to find missing opportunities.
- **Keyword Clustering**: Group related keywords automatically using local Jaccard similarity and string-matching algorithms.
- **Content Brief Builder**: Generate rule-based SEO outlines from clusters without relying on AI APIs.
- **SEO Page Audit**: Run over 15+ checks on any URL for on-page SEO issues, missing tags, and structure problems.
- **Data Imports**: Support for CSV imports to integrate real search volume, CPC, and backlink data (since we no longer fake this data).

## Important Limitations & Setup

- **No AI Dependency**: This app does NOT use Gemini, OpenAI, Claude, or any paid AI API.
- **Local Estimates**: Keyword difficulty and opportunity scores are *estimated* based on heuristics (keyword length, commercial intent modifiers, etc.).
- **Real Data via Import**: To view real search volume, live Google rankings, and CPC, you must import a CSV or integrate a compliant third-party provider (e.g., DataForSEO, Semrush) via the Settings panel (disabled by default).
- **Backlinks**: Backlink analytics requires imported data.

## Getting Started

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run the development server:**
   ```bash
   npm run dev
   ```

3. **Build for production:**
   ```bash
   npm run build
   ```

## Deployment

This app can be deployed seamlessly to Vercel or any Node.js hosting environment running Express and Vite.
