const fs = require('fs');
let code = fs.readFileSync('src/components/Imports.tsx', 'utf8');
code = code.replace(/    \); \n}$/, `
            {(keywordData.length > 0 || backlinkData.length > 0 || gscData.length > 0) && (
                <div className="flex justify-end mt-6">
                    <button 
                        onClick={() => {
                            if (keywordData.length > 0) localStorage.setItem('seo_keyword_data', JSON.stringify(keywordData));
                            if (backlinkData.length > 0) localStorage.setItem('seo_backlink_data', JSON.stringify(backlinkData));
                            if (gscData.length > 0) localStorage.setItem('seo_gsc_data', JSON.stringify(gscData));
                            alert('Data imported successfully!');
                        }}
                        className="px-6 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
                    >
                        Confirm & Save Imports
                    </button>
                </div>
            )}
        </div>
    );
}
`);
fs.writeFileSync('src/components/Imports.tsx', code);
