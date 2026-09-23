export function Pagination({ page, hasMore, loading, onChange }: { page: number; hasMore: boolean; loading: boolean; onChange: (page: number) => void }) {
  return <nav aria-label="Results pages" className="flex items-center justify-between gap-3 border-t border-border py-4 text-sm">
    <span className="text-muted-foreground">Page {page + 1}</span>
    <div className="flex gap-2"><button className="quiet-button min-h-9" disabled={loading || page === 0} onClick={() => onChange(page - 1)}>Previous</button><button className="quiet-button min-h-9" disabled={loading || !hasMore} onClick={() => onChange(page + 1)}>Next</button></div>
  </nav>;
}
