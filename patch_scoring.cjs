const fs = require('fs');
let code = fs.readFileSync('src/lib/seo/scoring.ts', 'utf8');

code = code.replace(
  /return {/g,
  `const categoryScores: any = {};
  const passedChecks: string[] = [];
  const topFixes = issues.filter(i => i.severity === 'critical' || i.severity === 'high').slice(0, 5).map(i => i.title);
  
  return {`
);

code = code.replace(/categoryScores: {},/g, 'categoryScores,');
code = code.replace(/passedChecks: \[\],/g, 'passedChecks,');
code = code.replace(/topFixes: \[\],/g, 'topFixes,');

fs.writeFileSync('src/lib/seo/scoring.ts', code);
