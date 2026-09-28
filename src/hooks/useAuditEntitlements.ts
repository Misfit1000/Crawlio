import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { AUDIT_MODES, type AuditMode } from '../lib/audit/audit-config';
import { loadPublicPlanProjection } from '../lib/plans/public-plan-client';
import type { PublicPlanItem } from '../lib/plans/public-plan-presentation';

const GUEST_FALLBACK: Pick<PublicPlanItem, 'allowedModes' | 'availableModes' | 'pageLimits' | 'exportsEnabled' | 'pdfEnabled' | 'scheduledAuditsEnabled'> = {
  allowedModes: ['quick'],
  availableModes: ['quick'],
  pageLimits: { quick: 5, standard: 0, deep: 0 },
  exportsEnabled: true,
  pdfEnabled: false,
  scheduledAuditsEnabled: false,
};

export function useAuditEntitlements() {
  const { user, loading, refreshAuditEntitlements } = useAuth();
  const [guestPlan, setGuestPlan] = useState<PublicPlanItem | null>(null);

  useEffect(() => {
    if (loading && !user) return;
    if (user) {
      setGuestPlan(null);
      return;
    }
    const controller = new AbortController();
    void loadPublicPlanProjection(controller.signal)
      .then((projection) => setGuestPlan(projection.plans.find((item) => item.sourcePlan === 'free') || null))
      .catch(() => undefined);
    return () => controller.abort();
  }, [loading, user]);

  const source = user?.auditEntitlements || guestPlan || GUEST_FALLBACK;
  const allowedModes = source.allowedModes;
  const availableModes = source.availableModes;
  const pageLimits = source.pageLimits;
  const selectableModes = AUDIT_MODES.filter((mode) => allowedModes.includes(mode) && availableModes.includes(mode) && pageLimits[mode] > 0);

  return {
    user,
    authLoading: loading,
    plan: user?.plan || 'free',
    allowedModes,
    availableModes,
    pageLimits,
    selectableModes,
    exportsEnabled: source.exportsEnabled,
    pdfEnabled: source.pdfEnabled,
    scheduledAuditsEnabled: source.scheduledAuditsEnabled,
    unavailableReasons: user?.auditEntitlements.unavailableReasons || ({} as Partial<Record<AuditMode, string>>),
    refreshAuditEntitlements,
  };
}
