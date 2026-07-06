const fs = require('fs');
let code = fs.readFileSync('src/components/Reports.tsx', 'utf8');

const targetStr = 'const csvStr = "data:text/csv;charset=utf-8," + encodeURIComponent(`URL,Title,Issue,Severity\\nhttps://example.com,Home,Missing H1,High\\n`);';

code = code.replace(
  targetStr,
  `let csvContent = "No data available";
            if (type === 'search') {
                const gsc = localStorage.getItem('seo_gsc_data');
                if (gsc) {
                    const parsed = JSON.parse(gsc);
                    if (parsed.length) {
                        csvContent = Object.keys(parsed[0]).join(',') + '\\n' + parsed.map(r => Object.values(r).join(',')).join('\\n');
                    }
                }
            } else if (type === 'keywords') {
                const kw = localStorage.getItem('seo_keyword_data');
                if (kw) {
                    const parsed = JSON.parse(kw);
                    if (parsed.length) {
                        csvContent = Object.keys(parsed[0]).join(',') + '\\n' + parsed.map(r => Object.values(r).join(',')).join('\\n');
                    }
                }
            } else {
                csvContent = "URL,Title,Issue,Severity\\nhttps://example.com,Home,Missing H1,High\\n"; // Placeholder for other audits
            }
            const csvStr = "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent);`
);

fs.writeFileSync('src/components/Reports.tsx', code);
