import { Link } from '../../app/router';

export function AuditScopeNotIncluded() {
  return <section className="border-y border-border py-6" aria-labelledby="scope-not-included">
    <h2 id="scope-not-included" className="text-lg font-semibold">Not included in this audit</h2>
    <p className="mt-2 text-sm text-muted-foreground">This report contains only the selected checks. No result is available for this section.</p>
    <Link to="/app/audits/new" className="quiet-button mt-4">Start an audit with these checks</Link>
  </section>;
}
