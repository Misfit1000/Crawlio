import { AlertTriangle, CheckCircle2, Loader2, RotateCcw } from 'lucide-react';
import type { BlogGenerationReview } from '../../lib/blog/generation-review';

export default function BlogGenerationReviewPanel({ review, loading, error, onRetry }: {
  review: BlogGenerationReview | null; loading: boolean; error: string; onRetry: () => void;
}) {
  const needsReview = review?.status !== 'passed';
  return <section aria-label="AI claim review" className="rounded-lg border border-border bg-muted/20 p-4">
    <h5 className="flex items-center gap-2 text-sm font-semibold">
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : needsReview ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />} AI claim review
    </h5>
    {loading ? <p className="mt-2 text-xs text-muted-foreground">Loading the original draft review.</p> : error ? <div className="mt-2"><p role="alert" className="text-xs text-muted-foreground">{error}</p><button type="button" className="quiet-button mt-3" onClick={onRetry}><RotateCcw className="h-4 w-4" /> Retry review</button></div> : <>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{review?.status === 'passed' ? 'The generated draft passed the automated evidence check.' : review?.status === 'needs_review' ? 'The generated draft was held for factual review. Resolve these notes against the sources before confirming editorial review.' : 'No completed automated claim check is available. Check the facts against the sources before confirming editorial review.'} These notes describe the original AI draft, not later edits. They cannot be fixed automatically.</p>
      {review?.warnings.length ? <ul className="mt-3 list-disc space-y-2 pl-5 text-xs leading-5 text-foreground">{review.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
      {review?.recommendation && <details className="mt-3 text-xs"><summary className="cursor-pointer font-semibold">Review guidance</summary><p className="mt-2 leading-5 text-muted-foreground">{review.recommendation}</p></details>}
    </>}
  </section>;
}
