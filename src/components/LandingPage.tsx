import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Globe, ShieldCheck, Zap, LineChart, FileText, Activity, LayoutDashboard, Database, HardDrive, ArrowRight, Search } from 'lucide-react';

interface Props {
  onStartAudit: (url: string) => void;
  onExploreFeatures: () => void;
}

export default function LandingPage({ onStartAudit, onExploreFeatures }: Props) {
  const [url, setUrl] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) {
      onStartAudit(url);
    }
  };

  return (
    <div className="w-full flex-col flex bg-background text-foreground selection:bg-accent/30 overflow-x-hidden">
      {/* Hero Section */}
      <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 px-6 flex flex-col items-center justify-center min-h-[80vh]">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-accent/20 via-background to-background"></div>
        
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/10 text-accent font-medium text-sm border border-accent/20 mb-4">
            <Activity className="w-4 h-4" />
            <span>Complete Website Audit Suite</span>
          </div>
          
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight font-display leading-[1.1]">
            SEO, Performance & Security Audits <br className="hidden md:block"/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-blue-500">
              in One Dashboard
            </span>
          </h1>
          
          <p className="text-xl md:text-2xl text-muted-foreground font-light max-w-3xl mx-auto leading-relaxed">
            Run live website audits, crawl pages in a worker, detect technical SEO issues, check passive security signals, review performance basics, and export actionable reports.
          </p>

          <form onSubmit={handleSubmit} className="mt-10 max-w-2xl mx-auto relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-accent to-blue-500 rounded-3xl blur opacity-20 group-hover:opacity-40 transition duration-500"></div>
            <div className="relative flex flex-col md:flex-row items-center bg-card/90 backdrop-blur-xl border border-border rounded-3xl p-2 shadow-2xl focus-within:ring-2 focus-within:ring-accent/50">
              <div className="flex items-center flex-1 px-4 py-4 w-full">
                <Globe className="w-6 h-6 text-muted-foreground mr-4 shrink-0" />
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="example.com"
                  className="w-full bg-transparent border-none outline-none text-xl text-foreground placeholder:text-muted-foreground/50"
                  required
                />
              </div>
              
              <button
                type="submit"
                className="w-full md:w-auto bg-accent text-accent-foreground hover:bg-accent/90 px-8 py-4 rounded-2xl font-bold transition-colors whitespace-nowrap flex items-center justify-center gap-2"
              >
                Start Quick Audit <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          </form>

          <div className="flex flex-wrap items-center justify-center gap-6 mt-8 text-sm font-medium text-muted-foreground">
            <div className="flex items-center gap-2"><CheckCircle /> No paid API required</div>
            <div className="flex items-center gap-2"><CheckCircle /> Worker-backed crawling</div>
            <div className="flex items-center gap-2"><CheckCircle /> Passive security checks</div>
          </div>
        </div>
      </section>

      {/* Mockup Preview */}
      <section className="px-6 -mt-10 relative z-10 pb-20">
        <div className="max-w-6xl mx-auto rounded-3xl overflow-hidden border border-border shadow-2xl bg-card">
          <div className="h-12 bg-muted/50 border-b border-border flex items-center px-4 gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
            <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
            <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
            <div className="ml-4 flex-1 bg-background/50 h-6 rounded-md flex items-center px-3 text-xs text-muted-foreground">
              <Globe className="w-3 h-3 mr-2" /> seointel-audit-dashboard
            </div>
          </div>
          <div className="p-8 grid md:grid-cols-4 gap-6 bg-background/50">
            <div className="col-span-4 flex justify-between items-center mb-4">
               <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Demo preview</div>
                  <h3 className="text-2xl font-bold">Audit Progress: example.com</h3>
                  <p className="text-muted-foreground">Showing sample live progress from a Quick Audit.</p>
               </div>
               <div className="text-3xl font-mono text-accent font-bold">62%</div>
            </div>
            
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
              <p className="text-sm text-muted-foreground mb-1">Overall Health</p>
              <div className="text-4xl font-bold text-yellow-500">84</div>
            </div>
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
              <p className="text-sm text-muted-foreground mb-1">Pages Crawled</p>
              <div className="text-4xl font-bold text-accent">7 / 10</div>
            </div>
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
              <p className="text-sm text-muted-foreground mb-1">Critical Issues</p>
              <div className="text-4xl font-bold text-red-500">3</div>
            </div>
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
              <p className="text-sm text-muted-foreground mb-1">Warnings</p>
              <div className="text-4xl font-bold text-orange-500">24</div>
            </div>
            
            <div className="col-span-4 md:col-span-2 bg-card border border-border rounded-2xl p-6">
               <h4 className="font-semibold mb-4 flex items-center gap-2"><Activity className="w-5 h-5 text-accent" /> Live Activity Feed</h4>
               <div className="space-y-4">
                  <div className="flex gap-3 text-sm">
                    <span className="text-green-500 font-mono">14:02:11</span>
                    <span className="text-muted-foreground">Crawled /about-us - 200 OK</span>
                  </div>
                  <div className="flex gap-3 text-sm">
                    <span className="text-red-500 font-mono">14:02:15</span>
                    <span className="text-foreground">Issue: Missing HSTS Header on /contact</span>
                  </div>
                  <div className="flex gap-3 text-sm">
                    <span className="text-orange-500 font-mono">14:02:18</span>
                    <span className="text-foreground">Warning: Large image (2.4MB) on /gallery</span>
                  </div>
                  <div className="flex gap-3 text-sm">
                    <span className="text-accent font-mono animate-pulse">14:02:22</span>
                    <span className="text-muted-foreground">Extracting Schema markup on /products</span>
                  </div>
               </div>
            </div>
            
            <div className="col-span-4 md:col-span-2 bg-card border border-border rounded-2xl p-6">
               <h4 className="font-semibold mb-4">Checks Running</h4>
               <div className="space-y-3">
                 <div className="flex justify-between items-center text-sm"><span>Security Headers</span><span className="text-accent">90%</span></div>
                 <div className="w-full bg-muted rounded-full h-1.5"><div className="bg-accent h-1.5 rounded-full w-[90%]"></div></div>
                 <div className="flex justify-between items-center text-sm mt-2"><span>Performance</span><span className="text-accent">45%</span></div>
                 <div className="w-full bg-muted rounded-full h-1.5"><div className="bg-accent h-1.5 rounded-full w-[45%]"></div></div>
                 <div className="flex justify-between items-center text-sm mt-2"><span>Schema Validation</span><span className="text-accent">12%</span></div>
                 <div className="w-full bg-muted rounded-full h-1.5"><div className="bg-accent h-1.5 rounded-full w-[12%]"></div></div>
               </div>
            </div>

          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-24 px-6 bg-muted/30 border-y border-border">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4 tracking-tight">Everything you need to audit a website</h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">Deterministic checks. No black-box AI magic. Just solid rules and actionable data.</p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-6">
            <FeatureCard 
              icon={<Search />} 
              title="Full SEO Audit" 
              desc="Crawl your site, inspect pages, detect issues, and get a prioritized action plan with a multi-page crawler." 
            />
            <FeatureCard 
              icon={<LayoutDashboard />} 
              title="Technical SEO" 
              desc="Catch metadata issues, broken canonicals, indexability problems, redirects, and duplicate tags." 
            />
            <FeatureCard 
              icon={<Zap />} 
              title="Performance Audit" 
              desc="Find speed and performance bottlenecks including large assets, missing compression, and heavy HTML." 
            />
            <FeatureCard 
              icon={<ShieldCheck />} 
              title="Security Audit" 
              desc="Passive security configuration checks for HTTPS, HSTS, CSP, cookie flags, and exposed files." 
              badge="Passive Check"
            />
            <FeatureCard 
              icon={<HardDrive />} 
              title="Crawlability & Indexability" 
              desc="Understand how search engines see your site through robots.txt, sitemap parsing, and depth analysis." 
            />
            <FeatureCard 
              icon={<FileText />} 
              title="Links & Images" 
              desc="Fix link and image SEO issues. Spot broken internal/external links, missing alt text, and heavy files." 
            />
            <FeatureCard 
              icon={<Database />} 
              title="Search Data Imports" 
              desc="Import real CSV data from Google Search Console, Bing Webmaster Tools, and Rank Trackers." 
              badge="Bring Your Own Data"
            />
            <FeatureCard 
              icon={<LineChart />} 
              title="Content Opportunities" 
              desc="Cluster keywords, find competitor gaps, and build content briefs using your verified data." 
            />
            <FeatureCard 
              icon={<FileText />} 
              title="Professional Reports" 
              desc="Export JSON, CSV issues, and clean printable PDF reports to share with clients or your team." 
            />
          </div>
        </div>
      </section>

      {/* Comparison Section */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-4xl font-bold mb-12 text-center">Built for honest audits</h2>
          
          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-card border border-border rounded-3xl p-8 shadow-sm">
              <h3 className="text-2xl font-bold mb-6 flex items-center gap-2"><CheckCircle2 className="text-green-500" /> SEOIntel</h3>
              <ul className="space-y-4">
                <ComparisonItem text="Local website crawler" positive />
                <ComparisonItem text="Rule-based, deterministic checks" positive />
                <ComparisonItem text="Free/imported data from GSC" positive />
                <ComparisonItem text="No fake ranking or volume data" positive />
                <ComparisonItem text="No AI API dependency required" positive />
                <ComparisonItem text="Passive, safe security audits" positive />
                <ComparisonItem text="Exportable, professional reports" positive />
              </ul>
            </div>
            
            <div className="bg-muted/50 border border-border rounded-3xl p-8">
              <h3 className="text-2xl font-bold mb-6 flex items-center gap-2 text-muted-foreground"><AlertTriangle className="text-red-400" /> Other "AI SEO" Tools</h3>
              <ul className="space-y-4 opacity-80">
                <ComparisonItem text="Fake, inaccurate search volume" />
                <ComparisonItem text="Made-up backlinks & authority" />
                <ComparisonItem text="Hallucinated rankings" />
                <ComparisonItem text="Black-box AI answers to technical issues" />
                <ComparisonItem text="Invasive, risky security testing" />
                <ComparisonItem text="Pay-per-credit pricing models" />
                <ComparisonItem text="Locked-in proprietary data" />
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section className="py-24 px-6 bg-accent/5 border-t border-accent/10">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-4xl font-bold mb-16">How it works</h2>
          
          <div className="grid md:grid-cols-4 gap-8">
            <Step number="1" title="Enter your URL" desc="Start by entering the domain you want to audit." />
            <Step number="2" title="Watch live progress" desc="See every page crawled and every check as it runs in real-time." />
            <Step number="3" title="Review issues" desc="Prioritize fixes by severity: critical, high, medium, and low." />
            <Step number="4" title="Export & fix" desc="Export reports for clients, developers, or your own team to action." />
          </div>
          
          <div className="mt-16 text-center text-sm text-muted-foreground border-t border-border pt-8 max-w-3xl mx-auto">
             <p className="font-semibold mb-2">Honesty & Security Disclaimer</p>
             <p>SEOIntel does not fake paid SEO metrics. Search volume, CPC, live rankings, and backlink authority require imported or verified data sources. Technical SEO, crawlability, performance, and passive security checks work from public website data.</p>
             <p className="mt-2">The security audit is passive and non-invasive. It checks public configuration signals and does not exploit vulnerabilities or perform penetration testing.</p>
          </div>
        </div>
      </section>

    </div>
  );
}

function CheckCircle() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-green-500"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>;
}

function CheckCircle2(props: any) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`w-6 h-6 ${props.className || ''}`}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>;
}

function AlertTriangle(props: any) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`w-6 h-6 ${props.className || ''}`}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" x2="12" y1="9" y2="13"></line><line x1="12" x2="12.01" y1="17" y2="17"></line></svg>;
}

function FeatureCard({ icon, title, desc, badge }: { icon: React.ReactNode, title: string, desc: string, badge?: string }) {
  return (
    <div className="bg-card border border-border p-6 rounded-2xl flex flex-col hover:border-accent/50 transition-colors shadow-sm">
      <div className="flex justify-between items-start mb-4">
        <div className="p-3 bg-accent/10 text-accent rounded-xl w-fit">
          {icon}
        </div>
        {badge && <span className="text-xs font-medium px-2.5 py-1 bg-muted text-muted-foreground rounded-full">{badge}</span>}
      </div>
      <h3 className="font-bold text-lg mb-2">{title}</h3>
      <p className="text-muted-foreground text-sm leading-relaxed">{desc}</p>
    </div>
  );
}

function ComparisonItem({ text, positive }: { text: string, positive?: boolean }) {
  return (
    <li className="flex items-start gap-3">
      {positive ? (
        <CheckCircle2 className="text-green-500 w-5 h-5 shrink-0 mt-0.5" />
      ) : (
        <AlertTriangle className="text-red-400 w-5 h-5 shrink-0 mt-0.5" />
      )}
      <span className={positive ? "font-medium" : "text-muted-foreground"}>{text}</span>
    </li>
  );
}

function Step({ number, title, desc }: { number: string, title: string, desc: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="w-12 h-12 bg-accent text-accent-foreground rounded-full flex items-center justify-center font-bold text-xl mb-4 shadow-lg shadow-accent/20">
        {number}
      </div>
      <h4 className="font-bold text-lg mb-2">{title}</h4>
      <p className="text-muted-foreground text-sm">{desc}</p>
    </div>
  );
}
