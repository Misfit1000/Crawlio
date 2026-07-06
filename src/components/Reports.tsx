import React, { useState } from "react"; 
import { PieChart, Download, Loader2 } from "lucide-react"; 

export default function Reports() { 
  const [loading, setLoading] = useState(false);

  const handleExport = () => {
    setLoading(true);
    // Simulate export generation
    setTimeout(() => {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ 
        report: "SEOIntel Export",
        date: new Date().toISOString()
      }, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href",     dataStr);
      downloadAnchorNode.setAttribute("download", "seo-report.json");
      document.body.appendChild(downloadAnchorNode); // required for firefox
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
      setLoading(false);
    }, 1000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold">Reports</h1>
      <p className="text-muted-foreground">Export your data to CSV or JSON formats.</p>
      
      <div className="bg-card border border-border p-8 rounded-2xl text-center space-y-6 mt-8">
        <PieChart className="w-12 h-12 text-muted-foreground mx-auto" />
        <h2 className="text-xl font-bold">Project Reports</h2>
        <p className="text-muted-foreground max-w-sm mx-auto">Generate comprehensive SEO reports from your localized data and analysis.</p>
        
        <button 
          onClick={handleExport}
          disabled={loading}
          className="px-6 py-2 bg-accent text-accent-foreground font-semibold rounded-xl inline-flex items-center gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Generate JSON Report
        </button>
      </div>
    </div>
  ); 
}
