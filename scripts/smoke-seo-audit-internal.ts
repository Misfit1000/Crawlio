import { runAllChecks } from '../src/lib/seo/checks/runner';
import { parseHtml } from '../src/lib/seo/html-parser';
import { calculateScore } from '../src/lib/seo/scoring';
import { CHECK_REGISTRY } from '../src/lib/seo/checks/registry';

const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Smoke Test Title</title>
  <meta name="description" content="This is a test description for the smoke test of the SEO package.">
  <link rel="canonical" href="https://example.com/smoke">
</head>
<body>
  <h1>Smoke Test Heading</h1>
  <p>Test content to ensure we have enough words to not trigger the empty content rule, but maybe it will trigger thin content. We need to add more text here. This is a very interesting test. SEO is important. We are testing the auditing capability of this package. This is enough text to be parsed.</p>
  <img src="test.jpg" alt="test image">
  <img src="missing-alt.png">
  <a href="https://example.com/other">Internal link</a>
</body>
</html>
`;

console.log("Registered Checks Count:", Object.keys(CHECK_REGISTRY).length);
if (Object.keys(CHECK_REGISTRY).length === 0) {
  throw new Error("No checks registered!");
}

const parsed = parseHtml(html, 'https://example.com/smoke');
const issues = runAllChecks(parsed);
const score = calculateScore(issues);

console.log("Issues found:", issues.length);
console.log("Overall Score:", score.overallScore);
console.log("JSON Stringify Output Test:", JSON.stringify({ issues: issues.slice(0, 1), score }).substring(0, 100) + "...");
console.log("Smoke test passed successfully.");
