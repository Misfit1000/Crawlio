import type { ReactNode } from 'react';

/** Animate the new measurement without displaying interpolated, unmeasured values. */
export function UpdatedValue({ value }: { value: ReactNode }) {
  return <span key={typeof value === 'number' || typeof value === 'string' ? value : undefined} className="updated-value">{value}</span>;
}
