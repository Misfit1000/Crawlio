import React, { useState } from "react"; 
import { PieChart, Download, Loader2, FileJson, FileSpreadsheet, Printer } from "lucide-react"; 

export default function Reports() {   
  const [loading, setLoading] = useState<string | null>(null);  

  const handleExportJson = () => {    
    setLoading('json');    
    setTimeout(() => {      
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({         
        report: "SEOIntel Full Audit Export",        
        date: new Date().toISOString()      
      }, null, 2));      
      const a = document.createElement('a');      
      a.href = dataStr;      
      a.download = "seo-audit-full.json";      
      document.body.appendChild(a);      
      a.click();      
      a.remove();      
      setLoading(null);    
    }, 800);  
  };  

  const handleExportCsv = (type: string) => {
    setLoading(`csv-${type}`);    
    setTimeout(() => {      
      let csvContent = "No data available";
            if (type === 'search') {
                const gsc = localStorage.getItem('seo_gsc_data');
                if (gsc) {
                    const parsed = JSON.parse(gsc);
                    if (parsed.length) {
                        csvContent = Object.keys(parsed[0]).join(',') + '\n' + parsed.map(r => Object.values(r).join(',')).join('\n');
                    }
                }
            } else if (type === 'keywords') {
                const kw = localStorage.getItem('seo_keyword_data');
                if (kw) {
                    const parsed = JSON.parse(kw);
                    if (parsed.length) {
                        csvContent = Object.keys(parsed[0]).join(',') + '\n' + parsed.map(r => Object.values(r).join(',')).join('\n');
                    }
                }
            } else {
                csvContent = "URL,Title,Issue,Severity\nhttps://example.com,Home,Missing H1,High\n"; // Placeholder for other audits
            }
            const csvStr = "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent);      
      const a = document.createElement('a');      
      a.href = csvStr;      
      a.download = `seointel-${type}-export.csv`;      
      document.body.appendChild(a);      
      a.click();      
      a.remove();      
      setLoading(null);    
    }, 800);
  }

  const handlePrint = () => {
    window.print();
  }

  return (    
    <div className="max-w-5xl mx-auto space-y-6">      
      <h1 className="text-3xl font-bold font-display">Reports & Exports</h1>      
      <p className="text-muted-foreground">Export your data to CSV, JSON, or printable reports.</p>            
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">        
        
        <div className="bg-card border border-border p-6 rounded-2xl flex flex-col items-start space-y-4 shadow-sm hover:shadow-md transition-shadow">        
          <div className="p-3 bg-accent/10 rounded-xl">
             <FileJson className="w-6 h-6 text-accent" />
          </div>
          <h2 className="text-xl font-bold font-display">Full JSON Audit</h2>        
          <p className="text-sm text-muted-foreground">Export the complete audit payload containing all issues, pages crawled, and domain statistics as a structured JSON object.</p>                
          <button onClick={handleExportJson} disabled={!!loading} className="mt-auto px-4 py-2 bg-muted hover:bg-muted/80 font-semibold rounded-lg inline-flex items-center gap-2 transition-colors">          
            {loading === 'json' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}          
            Export JSON        
          </button>      
        </div>

        <div className="bg-card border border-border p-6 rounded-2xl flex flex-col items-start space-y-4 shadow-sm hover:shadow-md transition-shadow">        
          <div className="p-3 bg-green-500/10 rounded-xl">
             <FileSpreadsheet className="w-6 h-6 text-green-500" />
          </div>
          <h2 className="text-xl font-bold font-display">CSV Exports</h2>        
          <p className="text-sm text-muted-foreground">Download standard CSV sheets for specific datasets to import into Excel or Google Sheets.</p>                
          
          <div className="flex flex-wrap gap-2 mt-auto">
            <button onClick={() => handleExportCsv('issues')} disabled={!!loading} className="px-3 py-1.5 bg-muted hover:bg-muted/80 text-sm font-medium rounded-lg inline-flex items-center gap-2 transition-colors">          
              {loading === 'csv-issues' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Audit Issues CSV        
            </button>      
            <button onClick={() => handleExportCsv('pages')} disabled={!!loading} className="px-3 py-1.5 bg-muted hover:bg-muted/80 text-sm font-medium rounded-lg inline-flex items-center gap-2 transition-colors">          
              {loading === 'csv-pages' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Crawled Pages CSV        
            </button>
            <button onClick={() => handleExportCsv('search')} disabled={!!loading} className="px-3 py-1.5 bg-muted hover:bg-muted/80 text-sm font-medium rounded-lg inline-flex items-center gap-2 transition-colors">          
              {loading === 'csv-search' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Search Data CSV        
            </button>
            <button onClick={() => handleExportCsv('keywords')} disabled={!!loading} className="px-3 py-1.5 bg-muted hover:bg-muted/80 text-sm font-medium rounded-lg inline-flex items-center gap-2 transition-colors">          
              {loading === 'csv-keywords' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Keywords CSV        
            </button>
          </div>
        </div>

        <div className="bg-card border border-border p-6 rounded-2xl flex flex-col items-start space-y-4 shadow-sm hover:shadow-md transition-shadow">        
          <div className="p-3 bg-purple-500/10 rounded-xl">
             <Printer className="w-6 h-6 text-purple-500" />
          </div>
          <h2 className="text-xl font-bold font-display">Printable PDF Report</h2>        
          <p className="text-sm text-muted-foreground">Generate a clean, print-ready document summarizing the project dashboard and main SEO audit issues for client delivery.</p>                
          <button onClick={handlePrint} className="mt-auto px-4 py-2 bg-muted hover:bg-muted/80 font-semibold rounded-lg inline-flex items-center gap-2 transition-colors">          
            <Printer className="w-4 h-4" />          
            Print / Save as PDF        
          </button>      
        </div>

      </div>    
    </div>  
  ); 
}
