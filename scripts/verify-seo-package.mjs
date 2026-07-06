import fs from 'fs';
import path from 'path';

let fail = false;

function checkFile(p) {
  if (!fs.existsSync(p)) {
    console.error(`FAIL: Missing ${p}`);
    fail = true;
  } else {
    console.log(`PASS: Found ${p}`);
  }
}

const reqFiles = [
  'src/lib/seo/crawler.ts',
  'src/lib/seo/robots.ts',
  'src/lib/seo/sitemap.ts',
  'src/lib/seo/url-utils.ts',
  'src/lib/seo/html-parser.ts',
  'src/lib/seo/scoring.ts',
  'src/lib/seo/checks/runner.ts',
  'src/lib/seo/checks/on-page.ts',
  'src/lib/seo/checks/technical.ts',
  'src/lib/seo/checks/content.ts',
  'src/lib/seo/checks/images.ts',
  'src/lib/seo/checks/links.ts',
  'src/lib/seo/checks/schema.ts',
  'src/lib/seo/checks/social.ts',
  'src/lib/seo/checks/security.ts',
  'src/lib/seo/checks/mobile.ts',
  'src/lib/seo/checks/sitemap.ts',
  'src/lib/seo/checks/robots.ts',
  'src/lib/seo/checks/indexability.ts',
  'src/lib/seo/checks/performance.ts',
  'src/lib/seo/checks/local.ts',
  'src/lib/seo/checks/international.ts',
  'src/lib/audit/audit-runner.ts',
  'src/lib/audit/audit-store.ts',
  'src/lib/audit/types.ts'
];

reqFiles.forEach(checkFile);

// Check SEO check count
let count = 0;
let hasEvaluationLogic = false;

try {
  const registryContent = fs.readFileSync('src/lib/seo/checks/all-checks.ts', 'utf8');
  count = (registryContent.match(/registerCheck/g) || []).length;
  
  const checkModules = [
    'src/lib/seo/checks/images.ts',
    'src/lib/seo/checks/indexability.ts',
    'src/lib/seo/checks/international.ts',
    'src/lib/seo/checks/local.ts',
    'src/lib/seo/checks/mobile.ts',
    'src/lib/seo/checks/performance.ts',
    'src/lib/seo/checks/robots.ts',
    'src/lib/seo/checks/schema.ts',
    'src/lib/seo/checks/security.ts',
    'src/lib/seo/checks/sitemap.ts',
    'src/lib/seo/checks/social.ts',
    'src/lib/seo/checks/technical.ts',
    'src/lib/seo/checks/on-page.ts',
    'src/lib/seo/checks/content.ts',
    'src/lib/seo/checks/links.ts'
  ];
  
  let totalEvaluated = 0;
  for (const mod of checkModules) {
    if (fs.existsSync(mod)) {
      const content = fs.readFileSync(mod, 'utf8');
      const evals = (content.match(/p\(/g) || []).length;
      totalEvaluated += evals;
    }
  }
  
  const allChecksContent = fs.readFileSync('src/lib/seo/checks/all-checks.ts', 'utf8');
  const generatedEvals = (allChecksContent.match(/p\(/g) || []).length;
  totalEvaluated += generatedEvals;
  
  if (totalEvaluated >= 30) {
    hasEvaluationLogic = true;
  }
} catch (e) {}

console.log(`INFO: Found ${count} SEO checks registered with ${hasEvaluationLogic ? 'real evaluation logic' : 'no evaluation logic'}`);

if (count < 70) {
  console.error(`FAIL: Only ${count} checks found. Need >= 70`);
  fail = true;
} else if (!hasEvaluationLogic) {
  console.error(`FAIL: Checks must have real evaluation logic. Found too few p() evaluations.`);
  fail = true;
} else {
  console.log(`PASS: Registered >= 70 SEO checks with evaluation logic`);
}

// Check package.json AI packages
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const aiPackages = ['@google/genai', '@google/generative-ai', 'openai', 'ai', '@ai-sdk/google'];
for (const aiPkg of aiPackages) {
  if ((pkg.dependencies && pkg.dependencies[aiPkg]) || (pkg.devDependencies && pkg.devDependencies[aiPkg])) {
    console.error(`FAIL: Found AI package in package.json: ${aiPkg}`);
    fail = true;
  }
}

if (fail) {
  console.error('VERIFICATION FAILED');
  process.exit(1);
} else {
  console.log('VERIFICATION PASSED');
  process.exit(0);
}
