import ToolsPage from './ToolsPage';
import RobotsSandbox from './RobotsSandbox';

export default function ToolsHub() {
  return <div className="min-w-0 space-y-8">
    <header><p className="text-xs font-semibold uppercase text-accent">Crawlio utilities</p><h1 className="mt-2 text-3xl font-semibold">Free SEO tools</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Work locally with metadata, robots rules and structured data. Your pasted content stays in this browser tab. These tools do not fetch your website or alter an audit score.</p></header>
    <ToolsPage embedded />
    <section className="border-t border-border pt-6" aria-labelledby="robots-sandbox-heading"><RobotsSandbox /></section>
    <p className="text-sm text-muted-foreground">Open Audit tools in a report for evidence-based sitemap downloads, crawl-depth analysis, executive summaries and owner-authorized public score badges.</p>
  </div>;
}
