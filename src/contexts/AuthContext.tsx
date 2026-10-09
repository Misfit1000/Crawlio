import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Session, User as SupabaseUser } from "@supabase/supabase-js";
import { AccountActionError, AccountProfileError, accountActionError, finishRegistration, type RegistrationOutcome } from '../lib/auth/account-state';
import type { PlanLimits, UserProfileEntitlement } from '../lib/billing/entitlements';
import { API_ROUTES } from "../lib/api/routes";
import { safeJsonFetch } from "../lib/http/safe-json";
import { clearInflightReads } from '../lib/http/inflight-read';
import {
  AUDIT_MODES,
  AUDIT_MODE_PAGE_CEILINGS,
  enforceAuditPageLimit,
  normalizeAuditModes,
  type AuditMode,
} from "../lib/audit/audit-config";

export interface AuditEntitlements {
  allowedModes: AuditMode[];
  availableModes: AuditMode[];
  pageLimits: Record<AuditMode, number>;
  dailyAudits: number;
  monthlyAudits: number;
  exportsEnabled: boolean;
  pdfEnabled: boolean;
  scheduledAuditsEnabled: boolean;
  unavailableReasons: Partial<Record<AuditMode, string>>;
  updatedAt: string | null;
}

export interface User {
  id: string;
  username: string;
  email: string;
  fullName: string;
  bio: string;
  photoURL: string;
  creationTime: string;
  lastSignInTime: string;
  role: 'admin' | 'support' | 'user';
  plan: 'free' | 'paid' | 'agency' | 'admin';
  subscriptionStatus: 'inactive' | 'trialing' | 'active' | 'past_due' | 'cancelled';
  auditQuotaUsedDaily: number;
  auditQuotaUsedMonthly: number;
  auditEntitlements: AuditEntitlements;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, legalConsent: { accepted: boolean; version: string }) => Promise<RegistrationOutcome>;
  retryProfile: () => Promise<void>;
  profilePending: boolean;
  logout: () => Promise<void>;
  updateUserProfile: (data: Partial<User>) => Promise<void>;
  refreshAuditEntitlements: () => Promise<AuditEntitlements | null>;
  error: string | null;
  unverifiedEmail: string | null;
  setUnverifiedEmail: (email: string | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface ServerProfilePayload {
  profile: UserProfileEntitlement;
  limits: PlanLimits & { updatedAt?: string };
  auditCapabilities?: {
    availableModes?: AuditMode[];
    pageCeilings?: Partial<Record<AuditMode, number>>;
    unavailableReasons?: Partial<Record<AuditMode, string>>;
  };
}

function fallbackAvatar(userId: string) {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`;
}

function hasSupabaseBrowserConfig() {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

function shouldHydrateAuthOnLoad() {
  if (typeof window === 'undefined') return false;
  const pathRequiresSession = /^\/(?:app|admin)(?:\/|$)/.test(window.location.pathname);
  if (pathRequiresSession) return true;
  try {
    return Object.keys(window.localStorage).some((key) => key.startsWith('sb-') && key.includes('-auth-token'));
  } catch {
    return false;
  }
}

async function getSupabaseClientOrThrow() {
  const { getSupabaseBrowserClient } = await import("../lib/supabase/client");
  const client = getSupabaseBrowserClient();
  if (!client) throw new Error("Supabase is not configured");
  return client;
}

async function loadSupabaseDataService() {
  return import("../services/supabaseDataService");
}

function scheduleIdleWork(callback: () => void) {
  const requestIdleCallback = (window as any).requestIdleCallback as undefined | ((cb: () => void, options?: { timeout: number }) => number);
  const cancelIdleCallback = (window as any).cancelIdleCallback as undefined | ((handle: number) => void);

  if (requestIdleCallback && cancelIdleCallback) {
    const handle = requestIdleCallback(callback, { timeout: 1500 });
    return () => cancelIdleCallback(handle);
  }

  const timeout = window.setTimeout(callback, 250);
  return () => window.clearTimeout(timeout);
}

async function fetchServerProfile(accessToken?: string) {
  if (!accessToken) throw new AccountProfileError(401);
  const response = await safeJsonFetch<{ success: boolean; data?: ServerProfilePayload }>(API_ROUTES.meProfile, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (response.success === false) throw new AccountProfileError(response.status);
  const payload = response.data.success ? response.data.data : undefined;
  if (!payload?.profile?.id || !payload.limits) throw new AccountProfileError();
  if (payload.profile.disabled) throw new AccountProfileError(403);
  return payload;
}

const FALLBACK_AUDIT_ENTITLEMENTS: Record<User['plan'], AuditEntitlements> = {
  free: { allowedModes: ['quick'], availableModes: ['quick'], pageLimits: { quick: 5, standard: 0, deep: 0 }, dailyAudits: 3, monthlyAudits: 30, exportsEnabled: true, pdfEnabled: false, scheduledAuditsEnabled: false, unavailableReasons: {}, updatedAt: null },
  paid: { allowedModes: ['quick', 'standard'], availableModes: ['quick', 'standard'], pageLimits: { quick: 50, standard: 50, deep: 0 }, dailyAudits: 25, monthlyAudits: 500, exportsEnabled: true, pdfEnabled: true, scheduledAuditsEnabled: false, unavailableReasons: {}, updatedAt: null },
  agency: { allowedModes: ['quick', 'standard', 'deep'], availableModes: ['quick', 'standard'], pageLimits: { quick: 50, standard: 50, deep: 75 }, dailyAudits: 100, monthlyAudits: 3000, exportsEnabled: true, pdfEnabled: true, scheduledAuditsEnabled: true, unavailableReasons: { deep: 'Deep audits are temporarily unavailable because the dedicated audit engine is not enabled.' }, updatedAt: null },
  admin: { allowedModes: ['quick', 'standard', 'deep'], availableModes: ['quick', 'standard'], pageLimits: { quick: 50, standard: 50, deep: 100 }, dailyAudits: 1000, monthlyAudits: 100000, exportsEnabled: true, pdfEnabled: true, scheduledAuditsEnabled: true, unavailableReasons: { deep: 'Deep audits are temporarily unavailable because the dedicated audit engine is not enabled.' }, updatedAt: null },
};

function clientPageLimit(mode: AuditMode, value: unknown, fallback: number, plan: string, runtimeCeiling: unknown) {
  const numeric = Number(value);
  const ceiling = Number(runtimeCeiling);
  const runtimeLimit = Number.isFinite(ceiling) && ceiling >= 0 ? ceiling : AUDIT_MODE_PAGE_CEILINGS[mode];
  return Number.isFinite(numeric) && numeric > 0 ? Math.min(runtimeLimit, enforceAuditPageLimit(mode, numeric, fallback || 1, plan)) : 0;
}

function mapAuditEntitlements(payload: ServerProfilePayload, plan: User['plan']): AuditEntitlements {
  const fallback = FALLBACK_AUDIT_ENTITLEMENTS[plan];
  const limits = payload.limits;
  const capabilities = payload?.auditCapabilities || {};
  const pageLimits = {
    quick: clientPageLimit('quick', limits.maxPagesQuick, fallback.pageLimits.quick, plan, capabilities.pageCeilings?.quick),
    standard: clientPageLimit('standard', limits.maxPagesStandard, fallback.pageLimits.standard, plan, capabilities.pageCeilings?.standard),
    deep: clientPageLimit('deep', limits.maxPagesDeep, fallback.pageLimits.deep, plan, capabilities.pageCeilings?.deep),
  };
  const allowedModes = normalizeAuditModes(limits.allowedModes, fallback.allowedModes).filter((mode) => pageLimits[mode] > 0);
  const runtimeModes = Array.isArray(capabilities.availableModes)
    ? AUDIT_MODES.filter((mode) => capabilities.availableModes.includes(mode))
    : fallback.availableModes;
  return {
    allowedModes,
    availableModes: allowedModes.filter((mode) => runtimeModes.includes(mode)),
    pageLimits,
    dailyAudits: Math.max(0, Number(limits.dailyAudits ?? fallback.dailyAudits) || 0),
    monthlyAudits: Math.max(0, Number(limits.monthlyAudits ?? fallback.monthlyAudits) || 0),
    exportsEnabled: typeof limits.exportsEnabled === 'boolean' ? limits.exportsEnabled : fallback.exportsEnabled,
    pdfEnabled: typeof limits.pdfEnabled === 'boolean' ? limits.pdfEnabled : fallback.pdfEnabled,
    scheduledAuditsEnabled: typeof limits.scheduledAuditsEnabled === 'boolean' ? limits.scheduledAuditsEnabled : fallback.scheduledAuditsEnabled,
    unavailableReasons: capabilities.unavailableReasons || fallback.unavailableReasons,
    updatedAt: typeof limits.updatedAt === 'string' ? limits.updatedAt : null,
  };
}

function normalizeRole(value: unknown): User['role'] {
  if (value === 'admin') return 'admin';
  if (value === 'support' || value === 'staff') return 'support';
  return 'user';
}

function normalizePlan(value: unknown): User['plan'] {
  if (value === 'paid' || value === 'agency' || value === 'admin') return value;
  return 'free';
}

async function mapSupabaseUser(supabaseUser: SupabaseUser, accessToken?: string): Promise<User> {
  const email = supabaseUser.email || '';
  const metadata = supabaseUser.user_metadata || {};

  const serverPayload = await fetchServerProfile(accessToken);
  const profile = serverPayload.profile;
  if (!profile) throw new AccountProfileError();
  if (profile.id !== supabaseUser.id) throw new AccountProfileError(401);
  const plan = normalizePlan(profile.plan);
  return {
    id: supabaseUser.id,
    username: email.split('@')[0] || 'User',
    email,
    fullName: profile.fullName || metadata.full_name || '',
    bio: '',
    photoURL: metadata.avatar_url || fallbackAvatar(supabaseUser.id),
    creationTime: supabaseUser.created_at || '',
    lastSignInTime: supabaseUser.last_sign_in_at || '',
    role: normalizeRole(profile.role),
    plan,
    subscriptionStatus: profile.subscriptionStatus,
    auditQuotaUsedDaily: profile.auditQuotaUsedDaily,
    auditQuotaUsedMonthly: profile.auditQuotaUsedMonthly,
    auditEntitlements: mapAuditEntitlements(serverPayload, plan),
  };
}

let recentHydration: { key: string; expiresAt: number; promise: Promise<User> } | null = null;

function hydrateSupabaseUser(user: SupabaseUser, accessToken?: string) {
  const key = `${user.id}:${accessToken || ''}`;
  if (recentHydration?.key === key && recentHydration.expiresAt > Date.now()) return recentHydration.promise;
  const promise = mapSupabaseUser(user, accessToken).catch((error) => {
    if (recentHydration?.promise === promise) clearRecentHydration();
    throw error;
  });
  recentHydration = { key, expiresAt: Date.now() + 5_000, promise };
  return promise;
}

function clearRecentHydration() {
  recentHydration = null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authRequested, setAuthRequested] = useState(shouldHydrateAuthOnLoad);
  const [loading, setLoading] = useState(() => hasSupabaseBrowserConfig() && shouldHydrateAuthOnLoad());
  const [error, setError] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [profilePending, setProfilePending] = useState(false);
  const sessionRef = useRef<Session | null>(null);
  const generationRef = useRef(0);
  const registrationRef = useRef<Promise<RegistrationOutcome> | null>(null);

  const hydrateSession = useCallback(async (session: Session | null, retry = false) => {
    if (retry || sessionRef.current?.user.id !== session?.user.id || sessionRef.current?.access_token !== session?.access_token) {
      generationRef.current += 1;
      clearRecentHydration();
      clearInflightReads();
    }
    sessionRef.current = session;
    const generation = generationRef.current;
    if (!session) {
      setUser(null);
      setProfilePending(false);
      setError(null);
      setLoading(false);
      return;
    }
    // An account switch must never retain another account's verified profile.
    setUser((previous) => previous?.id === session.user.id ? previous : null);
    try {
      const nextUser = await hydrateSupabaseUser(session.user, session.access_token);
      if (generation !== generationRef.current) throw new AccountProfileError(401);
      setUser(nextUser);
      setProfilePending(false);
      setUnverifiedEmail(null);
      setError(null);
    } catch (error) {
      const failure = error instanceof AccountProfileError ? error : new AccountProfileError();
      if (generation === generationRef.current) {
        setError(failure.message);
        setProfilePending(failure.retryable);
        setUser((previous) => failure.retryable && previous?.id === session.user.id ? previous : null);
      }
      throw failure;
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasSupabaseBrowserConfig() || !authRequested) {
      setUser(null);
      setLoading(false);
      return;
    }

    let active = true;
    let unsubscribe: (() => void) | null = null;

    const hydrateAuth = async () => {
      const client = await getSupabaseClientOrThrow();
      if (!active) return;
      const { data: subscription } = client.auth.onAuthStateChange((event, session) => {
        if (!active) return;
        if (event === 'SIGNED_OUT') clearRecentHydration();
        // Do not await account requests inside Supabase's auth callback lock.
        void Promise.resolve().then(() => {
          if (active) return hydrateSession(session);
        }).catch(() => { /* hydrateSession exposes safe recovery state. */ });
      });
      unsubscribe = () => subscription.subscription.unsubscribe();
      const { data, error: sessionError } = await client.auth.getSession();
      if (!active) return;
      if (sessionError) throw new AccountProfileError(401);
      await hydrateSession(data.session);
    };

    const cancelIdleWork = scheduleIdleWork(() => {
      hydrateAuth().catch((err) => {
        if (active) {
          setError(err instanceof AccountProfileError ? err.message : 'Account services are unavailable. Check your connection and retry.');
          setLoading(false);
        }
      });
    });

    return () => {
      active = false;
      cancelIdleWork();
      unsubscribe?.();
    };
  }, [authRequested, hydrateSession]);

  const login = async (email: string, password: string) => {
    setError(null);
    setAuthRequested(true);
    setLoading(true);
    try {
      const client = await getSupabaseClientOrThrow();
      const { data, error: signInError } = await client.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      if (!data.session) throw new AccountProfileError(401);
      await hydrateSession(data.session);
    } catch (error) {
      const message = accountActionError(error, 'login');
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  };

  const register = (email: string, password: string, legalConsent: { accepted: boolean; version: string }): Promise<RegistrationOutcome> => {
    if (registrationRef.current) return registrationRef.current;
    const attempt = async (): Promise<RegistrationOutcome> => {
      setError(null);
      if (!legalConsent.accepted) throw new Error('Accept the Terms and Privacy Notice to create an account.');
      if (sessionRef.current) return finishRegistration(true, () => hydrateSession(sessionRef.current, true));
      setAuthRequested(true);
      try {
        const client = await getSupabaseClientOrThrow();
        const acceptedAt = new Date().toISOString();
        const { data, error: signUpError } = await client.auth.signUp({
          email, password,
          options: { data: { legal_consent_version: legalConsent.version, terms_accepted_at: acceptedAt, privacy_accepted_at: acceptedAt } },
        });
        if (signUpError) throw signUpError;
        if (!data.user) throw new Error('Missing signup result');
        const result = await finishRegistration(Boolean(data.session), () => hydrateSession(data.session));
        if (result.status === 'confirmation_required') setUnverifiedEmail(email);
        return result;
      } catch (error) {
        const failure = new AccountActionError(error, 'register');
        setError(failure.message);
        throw failure;
      }
    };
    const promise = attempt().finally(() => { registrationRef.current = null; });
    registrationRef.current = promise;
    return promise;
  };

  const retryProfile = async () => {
    setLoading(true);
    try {
      const client = await getSupabaseClientOrThrow();
      const { data } = await client.auth.getSession();
      if (!data.session) throw new AccountProfileError(401);
      await hydrateSession(data.session, true);
    } catch (error) {
      const failure = error instanceof AccountProfileError ? error : new AccountProfileError();
      setError(failure.message);
      if (!failure.retryable) { setProfilePending(false); setUser(null); }
      throw failure;
    } finally {
      setLoading(false);
    }
  };

  const updateUserProfile = async (data: Partial<User>) => {
    if (!user) throw new Error("Not authenticated");
    const client = await getSupabaseClientOrThrow();

    if (data.fullName !== undefined || data.photoURL !== undefined) {
      const { error: updateError } = await client.auth.updateUser({
        data: {
          full_name: data.fullName !== undefined ? data.fullName : user.fullName,
          avatar_url: data.photoURL !== undefined ? data.photoURL : user.photoURL,
        },
      });
      if (updateError) throw updateError;
    }

    const dataService = await loadSupabaseDataService();
    await dataService.updateUserProfileData(user.id, data);
    setUser((prev) => prev ? { ...prev, ...data } : null);
  };

  const refreshAuditEntitlements = async () => {
    if (!user || !hasSupabaseBrowserConfig()) return user?.auditEntitlements || null;
    const client = await getSupabaseClientOrThrow();
    const { data } = await client.auth.getSession();
    let payload: ServerProfilePayload;
    try {
      payload = await fetchServerProfile(data.session?.access_token);
      if (payload.profile.id !== user.id) throw new AccountProfileError(401);
    } catch (error) {
      if (error instanceof AccountProfileError && !error.retryable && sessionRef.current?.user.id === user.id) setUser(null);
      throw error;
    }
    const plan = normalizePlan(payload.profile.plan);
    const entitlements = mapAuditEntitlements(payload, plan);
    setUser((previous) => previous?.id === user.id ? {
      ...previous,
      plan,
      role: normalizeRole(payload.profile.role),
      subscriptionStatus: payload.profile.subscriptionStatus,
      auditQuotaUsedDaily: payload.profile.auditQuotaUsedDaily,
      auditQuotaUsedMonthly: payload.profile.auditQuotaUsedMonthly,
      auditEntitlements: entitlements,
    } : previous);
    return entitlements;
  };

  const logout = async () => {
    if (!hasSupabaseBrowserConfig()) return;
    const client = await getSupabaseClientOrThrow();
    const { error: signOutError } = await client.auth.signOut();
    if (signOutError) throw signOutError;
    clearRecentHydration();
    await hydrateSession(null);
    setUnverifiedEmail(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, retryProfile, profilePending, logout, updateUserProfile, refreshAuditEntitlements, error, unverifiedEmail, setUnverifiedEmail }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
