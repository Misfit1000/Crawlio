import React, { useState } from "react";
import { PieChart, Download, Loader2, FileJson, FileSpreadsheet, Printer, ShieldCheck, AlertTriangle, Search, Lock } from "lucide-react";
import { BarList, CategoryScoreBar, MetricCard, RadialScoreGauge, SectionHeader, SeverityDistribution, SitePreviewSection, StatusBadge, SurfaceCard } from './ui/visual-system';

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
                csvContent = "URL,Title,Fix,Priority\nhttps://example.com,Home,Missing main heading,High\n"; // Placeholder for other audits
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
    <div className="w-full space-y-8 animate-rise">
      <SectionHeader
        eyebrow="Reports"
        title="Client-ready website reports"
        description="Start with the executive summary, show top fixes first, then export details for clients and developers."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Overall score" value="84" detail="Latest report sample" icon={<PieChart className="h-6 w-6" />} tone="green" />
        <MetricCard label="Urgent fixes" value="3" detail="Fix these first" icon={<AlertTriangle className="h-6 w-6" />} tone="red" />
        <MetricCard label="Browser safety" value="A-" detail="Non-invasive checks" icon={<ShieldCheck className="h-6 w-6" />} tone="green" />
        <MetricCard label="Export formats" value="3" detail="JSON, CSV, PDF" icon={<Download className="h-6 w-6" />} tone="accent" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SurfaceCard className="p-6">
          <h2 className="text-xl font-bold">Executive summary</h2>
          <p className="mb-5 text-sm text-muted-foreground">A quick score breakdown before the detailed fix list.</p>
          <div className="grid gap-5 lg:grid-cols-[0.42fr_0.58fr]">
            <div className="flex items-center justify-center rounded-3xl border border-border bg-background/70 p-5">
              <RadialScoreGauge value={84} label="Report score" detail="Example report summary" />
            </div>
            <div className="grid gap-3">
              {[
                { label: 'SEO', value: 84, tone: 'green' as const },
                { label: 'Website health', value: 76, tone: 'accent' as const },
                { label: 'Speed signals', value: 68, tone: 'yellow' as const },
                { label: 'Browser safety', value: 88, tone: 'green' as const },
                { label: 'Google access', value: 79, tone: 'accent' as const },
              ].map((item) => (
                <CategoryScoreBar key={item.label} label={item.label} value={item.value} tone={item.tone} />
              ))}
            </div>
          </div>
        </SurfaceCard>
        <SurfaceCard className="p-6">
          <h2 className="text-xl font-bold">Fix priority</h2>
          <p className="mb-5 text-sm text-muted-foreground">A compact view of what should be handled first.</p>
          <SeverityDistribution critical={3} high={6} medium={12} low={8} />
        </SurfaceCard>
      </div>

      <SitePreviewSection
        url="https://example.com"
        hostname="example.com"
        title="Example Homepage - SEO and Browser Safety Report"
        description="A polished report preview showing how scanned page details become desktop, mobile, and Google-style previews."
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <SurfaceCard className="p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-accent/10 p-3 text-accent"><Search className="h-6 w-6" /></div>
              <div>
                <h2 className="text-xl font-bold">SEO visibility report</h2>
                <p className="text-sm text-muted-foreground">Titles, descriptions, Google access, content structure, links, and search previews.</p>
              </div>
            </div>
            <StatusBadge tone="accent">Full audit</StatusBadge>
          </div>
          <BarList items={[
            { label: 'Title / description / Google preview', value: 86, tone: 'green' },
            { label: 'Google access / site map', value: 78, tone: 'accent' },
            { label: 'Internal links', value: 72, tone: 'accent' },
            { label: 'Images / alt text', value: 66, tone: 'yellow' },
            { label: 'Structured data / social previews', value: 61, tone: 'yellow' },
          ]} />
        </SurfaceCard>
        <SurfaceCard className="p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-green-500/10 p-3 text-green-600"><Lock className="h-6 w-6" /></div>
              <div>
                <h2 className="text-xl font-bold">Browser safety report</h2>
                <p className="text-sm text-muted-foreground">HTTPS, browser protection settings, privacy policy signals, and passive safety posture.</p>
              </div>
            </div>
            <StatusBadge tone="success">Passive</StatusBadge>
          </div>
          <BarList items={[
            { label: 'HTTPS / redirects', value: 92, tone: 'green' },
            { label: 'Browser protections', value: 74, tone: 'accent' },
            { label: 'Cookie posture', value: 70, tone: 'accent' },
            { label: 'Mixed content signals', value: 88, tone: 'green' },
            { label: 'Public file signals', value: 82, tone: 'green' },
          ]} />
        </SurfaceCard>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">

        <SurfaceCard className="flex flex-col items-start space-y-4 p-6">
          <div className="p-3 bg-accent/10 rounded-xl">
             <FileJson className="w-6 h-6 text-accent" />
          </div>
          <h2 className="text-xl font-bold font-display">Full audit data</h2>
          <p className="text-sm text-muted-foreground">Export the complete report data with fixes, pages scanned, and site summary fields.</p>
          <button onClick={handleExportJson} disabled={!!loading} className="mt-auto px-4 py-2 bg-muted hover:bg-muted/80 font-semibold rounded-lg inline-flex items-center gap-2 transition-colors">
            {loading === 'json' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export JSON
          </button>
        </SurfaceCard>

        <SurfaceCard className="flex flex-col items-start space-y-4 p-6">
          <div className="p-3 bg-green-500/10 rounded-xl">
             <FileSpreadsheet className="w-6 h-6 text-green-500" />
          </div>
          <h2 className="text-xl font-bold font-display">CSV Exports</h2>
          <p className="text-sm text-muted-foreground">Download spreadsheet-friendly files for fixes, scanned pages, search data, and keywords.</p>

          <div className="flex flex-wrap gap-2 mt-auto">
            <button onClick={() => handleExportCsv('issues')} disabled={!!loading} className="px-3 py-1.5 bg-muted hover:bg-muted/80 text-sm font-medium rounded-lg inline-flex items-center gap-2 transition-colors">
              {loading === 'csv-issues' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Fixes CSV
            </button>
            <button onClick={() => handleExportCsv('pages')} disabled={!!loading} className="px-3 py-1.5 bg-muted hover:bg-muted/80 text-sm font-medium rounded-lg inline-flex items-center gap-2 transition-colors">
              {loading === 'csv-pages' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Scanned Pages CSV
            </button>
            <button onClick={() => handleExportCsv('search')} disabled={!!loading} className="px-3 py-1.5 bg-muted hover:bg-muted/80 text-sm font-medium rounded-lg inline-flex items-center gap-2 transition-colors">
              {loading === 'csv-search' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Search Data CSV
            </button>
            <button onClick={() => handleExportCsv('keywords')} disabled={!!loading} className="px-3 py-1.5 bg-muted hover:bg-muted/80 text-sm font-medium rounded-lg inline-flex items-center gap-2 transition-colors">
              {loading === 'csv-keywords' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Keywords CSV
            </button>
          </div>
        </SurfaceCard>

        <SurfaceCard className="flex flex-col items-start space-y-4 p-6">
          <div className="p-3 bg-purple-500/10 rounded-xl">
             <Printer className="w-6 h-6 text-purple-500" />
          </div>
          <h2 className="text-xl font-bold font-display">Printable client report</h2>
          <p className="text-sm text-muted-foreground">Create a clean print-ready report with summary scores, top fixes, and next steps.</p>
          <button onClick={handlePrint} className="mt-auto px-4 py-2 bg-muted hover:bg-muted/80 font-semibold rounded-lg inline-flex items-center gap-2 transition-colors">
            <Printer className="w-4 h-4" />
            Print / Save as PDF
          </button>
        </SurfaceCard>

      </div>
    </div>
  );
}
