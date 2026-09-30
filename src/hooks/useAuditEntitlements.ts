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

interface AuditEntitlementOptions {
  loadGuestPlan?: boolean;
  guestPlan?: PublicPlanItem | null;
}

export function useAuditEntitlements({ loadGuestPlan = true, guestPlan: suppliedGuestPlan = null }: AuditEntitlementOptions = {}) {
  const { user, loading, refreshAuditEntitlements } = useAuth();
  const [guestPlan, setGuestPlan] = useState<PublicPlanItem | null>(null);
  const [guestPlanError, setGuestPlanError] = useState<string | null>(null);
  const [guestPlanAttempt, setGuestPlanAttempt] = useState(0);

  useEffect(() => {
    if (loading && !user) return;
    if (user) {
      setGuestPlan(null);
      setGuestPlanError(null);
      return;
    }
    if (!loadGuestPlan || suppliedGuestPlan) return;
    const controller = new AbortController();
    let active = true;
    setGuestPlanError(null);
    void loadPublicPlanProjection(controller.signal)
      .then((projection) => {
        const freePlan = projection.plans.find((item) => item.sourcePlan === 'free');
        if (!freePlan) throw new Error('Guest audit options are unavailable.');
        if (active) setGuestPlan(freePlan);
      })
      .catch((error) => {
        if (active && error?.name !== 'AbortError') setGuestPlanError('Audit options could not be loaded. Please retry.');
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [loading, user, loadGuestPlan, suppliedGuestPlan, guestPlanAttempt]);

  const currentGuestPlan = suppliedGuestPlan || guestPlan;
  const source = user?.auditEntitlements || currentGuestPlan || GUEST_FALLBACK;
  const allowedModes = source.allowedModes;
  const availableModes = source.availableModes;
  const pageLimits = source.pageLimits;
  const selectableModes = AUDIT_MODES.filter((mode) => allowedModes.includes(mode) && availableModes.includes(mode) && pageLimits[mode] > 0);

  return {
    user,
    authLoading: loading,
    hasCurrentEntitlements: Boolean(user || currentGuestPlan),
    guestPlanLoading: !user && !currentGuestPlan && loadGuestPlan && !guestPlanError,
    guestPlanError: currentGuestPlan ? null : guestPlanError,
    retryGuestPlan: () => setGuestPlanAttempt((attempt) => attempt + 1),
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
