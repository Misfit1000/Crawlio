import { SeoCheck, registerCheck } from './registry';

registerCheck({
  "id": "url-reachable",
  "category": "Technical SEO",
  "severity": "critical",
  "title": "URL Reachable",
  "description": "URL should return 200 OK.",
  "recommendation": "Ensure the page is accessible and returns a 200 HTTP status code."
});

registerCheck({
  "id": "homepage-status",
  "category": "Technical SEO",
  "severity": "critical",
  "title": "Homepage Status 200",
  "description": "Homepage must return a 200 OK.",
  "recommendation": "Fix homepage server configuration."
});

registerCheck({
  "id": "4xx-detected",
  "category": "Technical SEO",
  "severity": "high",
  "title": "4xx Pages Detected",
  "description": "Client error found on page.",
  "recommendation": "Fix broken links pointing to this page or redirect it."
});

registerCheck({
  "id": "5xx-detected",
  "category": "Technical SEO",
  "severity": "critical",
  "title": "5xx Pages Detected",
  "description": "Server error found on page.",
  "recommendation": "Fix server-side issues causing 5xx."
});

registerCheck({
  "id": "redirect-differs",
  "category": "Technical SEO",
  "severity": "medium",
  "title": "Redirect Final URL Differs",
  "description": "URL redirects to a different final URL.",
  "recommendation": "Update internal links to point to the final URL directly."
});

registerCheck({
  "id": "https-missing",
  "category": "Technical SEO",
  "severity": "high",
  "title": "HTTPS Missing",
  "description": "Page is served over HTTP instead of HTTPS.",
  "recommendation": "Install an SSL certificate and force HTTPS."
});

registerCheck({
  "id": "http-to-https-missing",
  "category": "Technical SEO",
  "severity": "high",
  "title": "HTTP to HTTPS Redirect Missing",
  "description": "HTTP version does not redirect to HTTPS.",
  "recommendation": "Add a 301 redirect from HTTP to HTTPS."
});

registerCheck({
  "id": "www-non-www-inconsistent",
  "category": "Technical SEO",
  "severity": "medium",
  "title": "WWW/Non-WWW Inconsistency",
  "description": "Both www and non-www versions are accessible without redirect.",
  "recommendation": "Choose one version and 301 redirect the other."
});

registerCheck({
  "id": "mixed-content",
  "category": "Security",
  "severity": "high",
  "title": "Mixed HTTP Links on HTTPS Page",
  "description": "HTTPS page contains insecure HTTP resources or links.",
  "recommendation": "Update all resources to use HTTPS."
});

registerCheck({
  "id": "missing-title",
  "category": "On-page SEO",
  "severity": "critical",
  "title": "Missing Title",
  "description": "Page is missing a <title> tag.",
  "recommendation": "Add a descriptive title tag."
});

registerCheck({
  "id": "short-title",
  "category": "On-page SEO",
  "severity": "medium",
  "title": "Title Too Short",
  "description": "Title is less than 30 characters.",
  "recommendation": "Expand title to 50-60 characters."
});

registerCheck({
  "id": "long-title",
  "category": "On-page SEO",
  "severity": "medium",
  "title": "Title Too Long",
  "description": "Title is over 60 characters.",
  "recommendation": "Shorten title to prevent truncation in SERPs."
});

registerCheck({
  "id": "multiple-titles",
  "category": "On-page SEO",
  "severity": "high",
  "title": "Multiple Title Tags",
  "description": "Page has more than one title tag.",
  "recommendation": "Ensure only one <title> tag exists in the <head>."
});

registerCheck({
  "id": "duplicate-titles",
  "category": "On-page SEO",
  "severity": "high",
  "title": "Duplicate Title Across Pages",
  "description": "Title is identical to another page.",
  "recommendation": "Write unique titles for every page."
});

registerCheck({
  "id": "missing-meta-desc",
  "category": "On-page SEO",
  "severity": "high",
  "title": "Missing Meta Description",
  "description": "Page is missing a meta description.",
  "recommendation": "Add a compelling meta description."
});

registerCheck({
  "id": "short-meta-desc",
  "category": "On-page SEO",
  "severity": "medium",
  "title": "Meta Description Too Short",
  "description": "Meta description is less than 70 characters.",
  "recommendation": "Expand to 120-150 characters."
});

registerCheck({
  "id": "long-meta-desc",
  "category": "On-page SEO",
  "severity": "medium",
  "title": "Meta Description Too Long",
  "description": "Meta description is over 160 characters.",
  "recommendation": "Shorten to under 160 characters."
});

registerCheck({
  "id": "multiple-meta-desc",
  "category": "On-page SEO",
  "severity": "high",
  "title": "Multiple Meta Descriptions",
  "description": "Page has multiple meta descriptions.",
  "recommendation": "Keep only one meta description tag."
});

registerCheck({
  "id": "duplicate-meta-desc",
  "category": "On-page SEO",
  "severity": "high",
  "title": "Duplicate Meta Descriptions",
  "description": "Meta description matches another page.",
  "recommendation": "Write unique meta descriptions."
});

registerCheck({
  "id": "missing-h1",
  "category": "On-page SEO",
  "severity": "high",
  "title": "Missing H1",
  "description": "Page has no H1 tag.",
  "recommendation": "Add exactly one H1 tag summarizing the page content."
});

registerCheck({
  "id": "multiple-h1",
  "category": "On-page SEO",
  "severity": "medium",
  "title": "Multiple H1 Tags",
  "description": "Page has more than one H1 tag.",
  "recommendation": "Use only one H1 tag per page."
});

registerCheck({
  "id": "empty-h1",
  "category": "On-page SEO",
  "severity": "high",
  "title": "Empty H1",
  "description": "H1 tag is empty.",
  "recommendation": "Add text to the H1 tag."
});

registerCheck({
  "id": "long-h1",
  "category": "On-page SEO",
  "severity": "low",
  "title": "H1 Too Long",
  "description": "H1 is longer than 70 characters.",
  "recommendation": "Keep H1 concise."
});

registerCheck({
  "id": "empty-headings",
  "category": "On-page SEO",
  "severity": "low",
  "title": "Empty Headings",
  "description": "Page contains empty heading tags (H2-H6).",
  "recommendation": "Remove empty heading tags."
});

registerCheck({
  "id": "skipped-heading-hierarchy",
  "category": "On-page SEO",
  "severity": "low",
  "title": "Skipped Heading Hierarchy",
  "description": "Headings skip levels (e.g., H1 to H3).",
  "recommendation": "Maintain sequential heading levels."
});

registerCheck({
  "id": "weak-heading-structure",
  "category": "On-page SEO",
  "severity": "low",
  "title": "Weak Heading Structure",
  "description": "Page uses very few headings relative to word count.",
  "recommendation": "Break up long text with subheadings."
});

registerCheck({
  "id": "thin-content",
  "category": "Content",
  "severity": "high",
  "title": "Thin Content",
  "description": "Page has very little text content.",
  "recommendation": "Add more comprehensive content to satisfy user intent."
});

registerCheck({
  "id": "very-low-word-count",
  "category": "Content",
  "severity": "medium",
  "title": "Very Low Word Count",
  "description": "Word count is below 100 words.",
  "recommendation": "Consider adding more content if this is a key page."
});

registerCheck({
  "id": "duplicate-body-content",
  "category": "Content",
  "severity": "high",
  "title": "Duplicate Body Content",
  "description": "Exact body content found on another page.",
  "recommendation": "Rewrite content to be unique."
});

registerCheck({
  "id": "near-duplicate-content",
  "category": "Content",
  "severity": "medium",
  "title": "Near Duplicate Content Heuristic",
  "description": "Content is very similar to another page.",
  "recommendation": "Differentiate the content significantly."
});

registerCheck({
  "id": "keyword-stuffing",
  "category": "Content",
  "severity": "medium",
  "title": "Keyword Stuffing Heuristic",
  "description": "A single word appears excessively.",
  "recommendation": "Use natural phrasing and synonyms."
});

registerCheck({
  "id": "missing-clear-intro",
  "category": "Content",
  "severity": "low",
  "title": "Missing Clear Intro",
  "description": "First paragraph does not contain focus topics.",
  "recommendation": "Include core topics early in the content."
});

registerCheck({
  "id": "missing-faq",
  "category": "Content",
  "severity": "info",
  "title": "Informational Page Missing FAQ",
  "description": "Long-form content lacks an FAQ section.",
  "recommendation": "Add an FAQ section for better visibility."
});

registerCheck({
  "id": "missing-author",
  "category": "Content",
  "severity": "low",
  "title": "Article Missing Author",
  "description": "Blog post has no identifiable author.",
  "recommendation": "Add author name for E-E-A-T."
});

registerCheck({
  "id": "missing-date",
  "category": "Content",
  "severity": "low",
  "title": "Article Missing Date",
  "description": "Blog post lacks publish or update date.",
  "recommendation": "Display dates on articles."
});

registerCheck({
  "id": "missing-alt-text",
  "category": "Images",
  "severity": "medium",
  "title": "Missing Alt Text",
  "description": "Images are missing alt text.",
  "recommendation": "Add descriptive alt text to all informative images."
});

registerCheck({
  "id": "empty-alt-text",
  "category": "Images",
  "severity": "low",
  "title": "Empty Alt Text",
  "description": "Images have empty alt=\"\" attribute.",
  "recommendation": "Ensure empty alt text is only used for purely decorative images."
});

registerCheck({
  "id": "duplicate-alt-text",
  "category": "Images",
  "severity": "low",
  "title": "Duplicate Alt Text",
  "description": "Multiple images share the same alt text.",
  "recommendation": "Use unique alt text for each image."
});

registerCheck({
  "id": "long-alt-text",
  "category": "Images",
  "severity": "low",
  "title": "Alt Text Too Long",
  "description": "Alt text is longer than 100 characters.",
  "recommendation": "Keep alt text concise."
});

registerCheck({
  "id": "broken-image-url",
  "category": "Images",
  "severity": "high",
  "title": "Broken Image URL",
  "description": "An image URL returns an error.",
  "recommendation": "Fix or replace the broken image."
});

registerCheck({
  "id": "missing-width-height",
  "category": "Images",
  "severity": "low",
  "title": "Missing Width/Height",
  "description": "Images lack width and height attributes.",
  "recommendation": "Specify dimensions to prevent cumulative layout shift (CLS)."
});

registerCheck({
  "id": "non-descriptive-filename",
  "category": "Images",
  "severity": "low",
  "title": "Non-Descriptive Image Filename",
  "description": "Image filename is generic (e.g., IMG_1234.jpg).",
  "recommendation": "Use descriptive filenames with keywords separated by hyphens."
});

registerCheck({
  "id": "broken-internal-links",
  "category": "Internal Links",
  "severity": "high",
  "title": "Broken Internal Links",
  "description": "Page links to a 4xx or 5xx internal page.",
  "recommendation": "Remove or update broken links."
});

registerCheck({
  "id": "broken-external-links",
  "category": "External Links",
  "severity": "medium",
  "title": "Broken External Links",
  "description": "Page links to a dead external site.",
  "recommendation": "Remove or update dead external links."
});

registerCheck({
  "id": "empty-anchor-text",
  "category": "Internal Links",
  "severity": "medium",
  "title": "Empty Anchor Text",
  "description": "Links without anchor text found.",
  "recommendation": "Add descriptive anchor text to all links."
});

registerCheck({
  "id": "generic-anchor-text",
  "category": "Internal Links",
  "severity": "low",
  "title": "Generic Anchor Text",
  "description": "Links use generic text like \"click here\".",
  "recommendation": "Use descriptive anchor text."
});

registerCheck({
  "id": "internal-nofollow",
  "category": "Internal Links",
  "severity": "medium",
  "title": "Internal Nofollow Links",
  "description": "Internal links use rel=\"nofollow\".",
  "recommendation": "Remove nofollow from internal links to allow PageRank flow."
});

registerCheck({
  "id": "too-many-links",
  "category": "Internal Links",
  "severity": "low",
  "title": "Too Many Links on Page",
  "description": "Page has over 100 links.",
  "recommendation": "Reduce links to focus link equity."
});

registerCheck({
  "id": "target-blank-missing-rel",
  "category": "Security",
  "severity": "low",
  "title": "target=\"_blank\" Missing rel=\"noopener noreferrer\"",
  "description": "External links opening in new tab lack security attributes.",
  "recommendation": "Add rel=\"noopener noreferrer\" to external target=\"_blank\" links."
});

registerCheck({
  "id": "too-few-internal-links",
  "category": "Internal Links",
  "severity": "low",
  "title": "Too Few Internal Links",
  "description": "Important page has very few incoming internal links.",
  "recommendation": "Link to this page from other relevant pages."
});

registerCheck({
  "id": "missing-canonical",
  "category": "Indexability",
  "severity": "medium",
  "title": "Missing Canonical",
  "description": "No canonical URL specified.",
  "recommendation": "Add a self-referencing canonical tag."
});

registerCheck({
  "id": "multiple-canonical",
  "category": "Indexability",
  "severity": "high",
  "title": "Multiple Canonical Tags",
  "description": "More than one canonical tag found.",
  "recommendation": "Keep only one canonical tag."
});

registerCheck({
  "id": "relative-canonical",
  "category": "Indexability",
  "severity": "high",
  "title": "Canonical is Relative URL",
  "description": "Canonical URL is relative, not absolute.",
  "recommendation": "Use absolute URLs for canonical tags."
});

registerCheck({
  "id": "canonical-different-domain",
  "category": "Indexability",
  "severity": "info",
  "title": "Canonical Points to Different Domain",
  "description": "Canonical URL points to an external domain.",
  "recommendation": "Ensure cross-domain canonicalization is intentional."
});

registerCheck({
  "id": "canonical-non-200",
  "category": "Indexability",
  "severity": "high",
  "title": "Canonical Points to Non-200 URL",
  "description": "Canonical URL returns an error.",
  "recommendation": "Canonical must point to a live 200 OK page."
});

registerCheck({
  "id": "duplicate-canonical",
  "category": "Indexability",
  "severity": "high",
  "title": "Duplicate Canonical Across Pages",
  "description": "Multiple different pages share the same canonical URL.",
  "recommendation": "Review if pages should be consolidated."
});

registerCheck({
  "id": "meta-noindex",
  "category": "Indexability",
  "severity": "high",
  "title": "Meta Noindex",
  "description": "Page contains meta robots noindex.",
  "recommendation": "Remove noindex if page should be indexed."
});

registerCheck({
  "id": "x-robots-noindex",
  "category": "Indexability",
  "severity": "high",
  "title": "X-Robots-Tag Noindex",
  "description": "HTTP header specifies noindex.",
  "recommendation": "Remove header if page should be indexed."
});

registerCheck({
  "id": "blocked-by-robots",
  "category": "Robots",
  "severity": "high",
  "title": "Page Blocked by robots.txt",
  "description": "Page URL matches a disallow rule in robots.txt.",
  "recommendation": "Update robots.txt if page should be crawled."
});

registerCheck({
  "id": "canonicalized-elsewhere",
  "category": "Indexability",
  "severity": "info",
  "title": "Page Canonicalized Elsewhere",
  "description": "Canonical URL points to a different page.",
  "recommendation": "Expected if this is a duplicate."
});

registerCheck({
  "id": "soft-404",
  "category": "Technical SEO",
  "severity": "high",
  "title": "Soft 404 Heuristic",
  "description": "Page appears to be a 404 but returns 200 OK.",
  "recommendation": "Return a 404 status code for not found pages."
});

registerCheck({
  "id": "indexable-missing-from-sitemap",
  "category": "Sitemap",
  "severity": "medium",
  "title": "Indexable Page Missing from Sitemap",
  "description": "A valid, indexable page is not in the sitemap.",
  "recommendation": "Add the URL to the XML sitemap."
});

registerCheck({
  "id": "robots-txt-missing",
  "category": "Robots",
  "severity": "medium",
  "title": "robots.txt Missing",
  "description": "No robots.txt file found at root.",
  "recommendation": "Create a robots.txt file."
});

registerCheck({
  "id": "robots-txt-unreachable",
  "category": "Robots",
  "severity": "high",
  "title": "robots.txt Unreachable",
  "description": "robots.txt returned 4xx or 5xx.",
  "recommendation": "Ensure robots.txt returns 200 OK or 404."
});

registerCheck({
  "id": "robots-txt-blocks-important",
  "category": "Robots",
  "severity": "high",
  "title": "robots.txt Blocks Important Pages",
  "description": "Homepage or key paths are blocked.",
  "recommendation": "Remove disallow rules for important content."
});

registerCheck({
  "id": "robots-txt-missing-sitemap",
  "category": "Robots",
  "severity": "medium",
  "title": "robots.txt Missing Sitemap Reference",
  "description": "No Sitemap directive in robots.txt.",
  "recommendation": "Add \"Sitemap: [url]\" to robots.txt."
});

registerCheck({
  "id": "sitemap-xml-missing",
  "category": "Sitemap",
  "severity": "medium",
  "title": "sitemap.xml Missing",
  "description": "No sitemap found.",
  "recommendation": "Create and submit an XML sitemap."
});

registerCheck({
  "id": "sitemap-invalid-xml",
  "category": "Sitemap",
  "severity": "high",
  "title": "Sitemap Invalid XML",
  "description": "Sitemap has XML syntax errors.",
  "recommendation": "Fix XML formatting in sitemap."
});

registerCheck({
  "id": "sitemap-url-non-200",
  "category": "Sitemap",
  "severity": "high",
  "title": "Sitemap URL Returns Non-200",
  "description": "URL in sitemap is dead or redirects.",
  "recommendation": "Only include live 200 OK URLs in sitemap."
});

registerCheck({
  "id": "sitemap-url-blocked",
  "category": "Sitemap",
  "severity": "high",
  "title": "Sitemap URL Blocked by Robots",
  "description": "URL in sitemap is disallowed by robots.txt.",
  "recommendation": "Remove blocked URLs from sitemap or allow in robots.txt."
});

registerCheck({
  "id": "crawled-missing-sitemap",
  "category": "Sitemap",
  "severity": "low",
  "title": "Crawled Page Missing from Sitemap",
  "description": "Discovered page is not in the sitemap.",
  "recommendation": "Add to sitemap if it should be indexed."
});

registerCheck({
  "id": "sitemap-page-not-discovered",
  "category": "Sitemap",
  "severity": "low",
  "title": "Sitemap Page Not Discovered by Crawler",
  "description": "Sitemap contains orphan pages.",
  "recommendation": "Add internal links to sitemap pages."
});

registerCheck({
  "id": "json-ld-missing",
  "category": "Structured Data",
  "severity": "low",
  "title": "JSON-LD Missing",
  "description": "No JSON-LD schema found.",
  "recommendation": "Implement JSON-LD for rich results."
});

registerCheck({
  "id": "invalid-json-ld",
  "category": "Structured Data",
  "severity": "medium",
  "title": "Invalid JSON-LD",
  "description": "JSON-LD has syntax errors.",
  "recommendation": "Fix JSON syntax."
});

registerCheck({
  "id": "missing-organization-schema",
  "category": "Structured Data",
  "severity": "low",
  "title": "Missing Organization Schema",
  "description": "Homepage lacks Organization schema.",
  "recommendation": "Add Organization schema to homepage."
});

registerCheck({
  "id": "missing-website-schema",
  "category": "Structured Data",
  "severity": "low",
  "title": "Missing WebSite Schema",
  "description": "Homepage lacks WebSite schema.",
  "recommendation": "Add WebSite schema for sitelinks search box."
});

registerCheck({
  "id": "missing-article-schema",
  "category": "Structured Data",
  "severity": "medium",
  "title": "Missing Article Schema",
  "description": "Blog post lacks Article schema.",
  "recommendation": "Add Article or BlogPosting schema."
});

registerCheck({
  "id": "missing-breadcrumb-schema",
  "category": "Structured Data",
  "severity": "low",
  "title": "Missing BreadcrumbList Schema",
  "description": "Deep page lacks Breadcrumb schema.",
  "recommendation": "Add BreadcrumbList schema."
});

registerCheck({
  "id": "missing-product-schema",
  "category": "Structured Data",
  "severity": "medium",
  "title": "Missing Product Schema",
  "description": "Product page lacks Product schema.",
  "recommendation": "Add Product schema."
});

registerCheck({
  "id": "missing-localbusiness-schema",
  "category": "Structured Data",
  "severity": "low",
  "title": "Missing LocalBusiness Schema",
  "description": "Local site lacks LocalBusiness schema.",
  "recommendation": "Add LocalBusiness schema."
});

registerCheck({
  "id": "missing-og-title",
  "category": "Social",
  "severity": "low",
  "title": "Missing og:title",
  "description": "No Open Graph title.",
  "recommendation": "Add og:title."
});

registerCheck({
  "id": "missing-og-description",
  "category": "Social",
  "severity": "low",
  "title": "Missing og:description",
  "description": "No Open Graph description.",
  "recommendation": "Add og:description."
});

registerCheck({
  "id": "missing-og-image",
  "category": "Social",
  "severity": "medium",
  "title": "Missing og:image",
  "description": "No Open Graph image.",
  "recommendation": "Add og:image."
});

registerCheck({
  "id": "missing-og-url",
  "category": "Social",
  "severity": "low",
  "title": "Missing og:url",
  "description": "No Open Graph URL.",
  "recommendation": "Add og:url."
});

registerCheck({
  "id": "missing-twitter-card",
  "category": "Social",
  "severity": "low",
  "title": "Missing twitter:card",
  "description": "No Twitter card type.",
  "recommendation": "Add twitter:card meta tag."
});

registerCheck({
  "id": "missing-twitter-title",
  "category": "Social",
  "severity": "low",
  "title": "Missing twitter:title",
  "description": "No Twitter title.",
  "recommendation": "Add twitter:title."
});

registerCheck({
  "id": "missing-twitter-description",
  "category": "Social",
  "severity": "low",
  "title": "Missing twitter:description",
  "description": "No Twitter description.",
  "recommendation": "Add twitter:description."
});

registerCheck({
  "id": "missing-twitter-image",
  "category": "Social",
  "severity": "low",
  "title": "Missing twitter:image",
  "description": "No Twitter image.",
  "recommendation": "Add twitter:image."
});

registerCheck({
  "id": "slow-server-response",
  "category": "Performance",
  "severity": "medium",
  "title": "Slow Server Response",
  "description": "TTFB is over 600ms.",
  "recommendation": "Optimize server response time."
});

registerCheck({
  "id": "large-html-size",
  "category": "Performance",
  "severity": "medium",
  "title": "Large HTML Size",
  "description": "HTML document is over 100KB.",
  "recommendation": "Minify HTML and reduce inline CSS/JS."
});

registerCheck({
  "id": "large-page-size",
  "category": "Performance",
  "severity": "high",
  "title": "Large Page Size",
  "description": "Total page size is very large.",
  "recommendation": "Optimize images and assets."
});

registerCheck({
  "id": "missing-compression-header",
  "category": "Performance",
  "severity": "medium",
  "title": "Missing Compression Header",
  "description": "Responses are not compressed (gzip/brotli).",
  "recommendation": "Enable gzip or brotli compression on server."
});

registerCheck({
  "id": "missing-cache-headers",
  "category": "Performance",
  "severity": "low",
  "title": "Missing Cache Headers",
  "description": "Static assets lack cache-control headers.",
  "recommendation": "Implement caching for static assets."
});

registerCheck({
  "id": "large-js-css-warning",
  "category": "Performance",
  "severity": "medium",
  "title": "Large JS/CSS Warning",
  "description": "Page loads heavy render-blocking scripts.",
  "recommendation": "Defer or asynchronously load JS."
});

registerCheck({
  "id": "missing-viewport-meta",
  "category": "Mobile",
  "severity": "critical",
  "title": "Missing Viewport Meta Tag",
  "description": "No viewport meta tag found.",
  "recommendation": "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">."
});

registerCheck({
  "id": "fixed-width-layout",
  "category": "Mobile",
  "severity": "high",
  "title": "Fixed-Width Layout Hints",
  "description": "CSS indicates a fixed width layout.",
  "recommendation": "Use responsive design techniques."
});

registerCheck({
  "id": "horizontal-overflow",
  "category": "Mobile",
  "severity": "high",
  "title": "Horizontal Overflow Warning",
  "description": "Content may exceed viewport width.",
  "recommendation": "Ensure no elements force horizontal scrolling."
});

registerCheck({
  "id": "missing-hsts",
  "category": "Security",
  "severity": "medium",
  "title": "Missing Strict-Transport-Security",
  "description": "HSTS header missing.",
  "recommendation": "Enable HSTS."
});

registerCheck({
  "id": "missing-csp",
  "category": "Security",
  "severity": "low",
  "title": "Missing Content-Security-Policy",
  "description": "CSP header missing.",
  "recommendation": "Implement a Content Security Policy."
});

registerCheck({
  "id": "missing-x-content-type-options",
  "category": "Security",
  "severity": "low",
  "title": "Missing X-Content-Type-Options",
  "description": "Header missing.",
  "recommendation": "Add X-Content-Type-Options: nosniff."
});

registerCheck({
  "id": "missing-x-frame-options",
  "category": "Security",
  "severity": "low",
  "title": "Missing X-Frame-Options",
  "description": "Header missing.",
  "recommendation": "Add X-Frame-Options header."
});

registerCheck({
  "id": "missing-referrer-policy",
  "category": "Security",
  "severity": "low",
  "title": "Missing Referrer-Policy",
  "description": "Header missing.",
  "recommendation": "Add Referrer-Policy header."
});

registerCheck({
  "id": "missing-html-lang",
  "category": "Accessibility",
  "severity": "medium",
  "title": "Missing HTML Lang",
  "description": "No lang attribute on <html> tag.",
  "recommendation": "Add a valid lang attribute."
});

registerCheck({
  "id": "empty-buttons",
  "category": "Accessibility",
  "severity": "low",
  "title": "Empty Buttons",
  "description": "Buttons lack accessible text.",
  "recommendation": "Add text or aria-labels to buttons."
});

registerCheck({
  "id": "empty-links-a11y",
  "category": "Accessibility",
  "severity": "low",
  "title": "Empty Links",
  "description": "Links lack accessible text.",
  "recommendation": "Add text or aria-labels to links."
});

registerCheck({
  "id": "missing-form-labels",
  "category": "Accessibility",
  "severity": "low",
  "title": "Missing Form Labels",
  "description": "Form inputs lack associated labels.",
  "recommendation": "Add <label> elements or aria-labels."
});

registerCheck({
  "id": "invalid-hreflang",
  "category": "International SEO",
  "severity": "high",
  "title": "Invalid Hreflang",
  "description": "Hreflang tags have syntax errors.",
  "recommendation": "Use valid language and region codes."
});

registerCheck({
  "id": "conflicting-canonical-hreflang",
  "category": "International SEO",
  "severity": "high",
  "title": "Conflicting Canonical and Hreflang",
  "description": "Hreflang URL canonicalizes elsewhere.",
  "recommendation": "Hreflang URLs must be self-canonicalizing."
});

registerCheck({
  "id": "missing-contact-page",
  "category": "Local SEO",
  "severity": "low",
  "title": "Missing Contact Page",
  "description": "No contact page found.",
  "recommendation": "Create a contact page."
});

registerCheck({
  "id": "missing-phone-number",
  "category": "Local SEO",
  "severity": "low",
  "title": "Missing Phone Number",
  "description": "No phone number found.",
  "recommendation": "Add a local phone number."
});

registerCheck({
  "id": "missing-address",
  "category": "Local SEO",
  "severity": "low",
  "title": "Missing Address",
  "description": "No physical address found.",
  "recommendation": "Add physical address."
});

registerCheck({
  "id": "missing-opening-hours",
  "category": "Local SEO",
  "severity": "low",
  "title": "Missing Opening Hours",
  "description": "No business hours found.",
  "recommendation": "Add opening hours."
});

registerCheck({
  id: 'a11y-document-language',
  category: 'Accessibility',
  severity: 'medium',
  title: 'Document language is missing',
  description: 'Assistive technology cannot reliably determine the page language.',
  recommendation: 'Add a valid lang attribute to the html element, such as lang="en".',
});

registerCheck({
  id: 'a11y-unnamed-links',
  category: 'Accessibility',
  severity: 'medium',
  title: 'Links without accessible names',
  description: 'Some links do not expose readable text or another detectable accessible name.',
  recommendation: 'Give every link descriptive text or a concise accessible label.',
});

registerCheck({
  id: 'a11y-unnamed-buttons',
  category: 'Accessibility',
  severity: 'high',
  title: 'Buttons without accessible names',
  description: 'Some buttons cannot be identified reliably by assistive technology.',
  recommendation: 'Add visible button text or an accurate accessible label.',
});

registerCheck({
  id: 'a11y-unlabeled-fields',
  category: 'Accessibility',
  severity: 'high',
  title: 'Form fields without detectable labels',
  description: 'Some form controls do not have a programmatically associated label.',
  recommendation: 'Associate each field with a label element or an accurate accessible label.',
});

registerCheck({
  id: 'a11y-missing-main-landmark',
  category: 'Accessibility',
  severity: 'low',
  title: 'Main content landmark is missing',
  description: 'The page does not expose a main content landmark for assistive navigation.',
  recommendation: 'Wrap the primary page content in one main element.',
});

registerCheck({
  id: 'a11y-multiple-main-landmarks',
  category: 'Accessibility',
  severity: 'medium',
  title: 'Multiple main content landmarks',
  description: 'The page exposes more than one main landmark without a clear distinction.',
  recommendation: 'Use one primary main landmark and label any exceptional additional landmark clearly.',
});

registerCheck({
  id: 'a11y-duplicate-ids',
  category: 'Accessibility',
  severity: 'medium',
  title: 'Duplicate element IDs',
  description: 'Duplicate IDs can break label, heading, and ARIA relationships.',
  recommendation: 'Make every element ID unique within the page.',
});

registerCheck({
  id: 'a11y-broken-aria-references',
  category: 'Accessibility',
  severity: 'medium',
  title: 'ARIA references missing elements',
  description: 'An aria-labelledby or aria-describedby value points to an ID that does not exist.',
  recommendation: 'Correct or remove invalid ARIA ID references.',
});

registerCheck({
  id: 'a11y-positive-tabindex',
  category: 'Accessibility',
  severity: 'low',
  title: 'Positive tabindex changes focus order',
  description: 'Positive tabindex values can create an unexpected keyboard navigation order.',
  recommendation: 'Use DOM order and tabindex="0" or tabindex="-1" instead of positive values.',
});

registerCheck({
  id: 'a11y-hidden-focusable',
  category: 'Accessibility',
  severity: 'high',
  title: 'Focusable controls hidden from assistive technology',
  description: 'An aria-hidden region contains elements that can still receive keyboard focus.',
  recommendation: 'Remove hidden controls from the tab order or do not hide the active region from assistive technology.',
});

registerCheck({
  id: 'a11y-zoom-restricted',
  category: 'Accessibility',
  severity: 'high',
  title: 'Page zoom is restricted',
  description: 'The viewport setting prevents or severely limits user zoom.',
  recommendation: 'Allow browser zoom by removing user-scalable=no and restrictive maximum-scale values.',
});

registerCheck({
  id: 'javascript-shell-limited-evidence',
  category: 'Crawlability',
  severity: 'high',
  title: 'Limited static HTML evidence',
  description: 'The downloaded page appears to rely on JavaScript for most visible content, so static audit coverage is limited.',
  recommendation: 'Render meaningful headings, navigation, and primary content in the initial HTML response or use server rendering.',
});
