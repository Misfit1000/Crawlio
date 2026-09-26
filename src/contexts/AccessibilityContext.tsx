import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type TextScale = 'default' | 'large';
export type InterfaceDensity = 'comfortable' | 'compact';
export type MotionPreference = 'system' | 'reduced';
export type ChartContrast = 'standard' | 'high';

export interface AccessibilityPreferences {
  textScale: TextScale;
  density: InterfaceDensity;
  motion: MotionPreference;
  chartContrast: ChartContrast;
}

const STORAGE_KEY = 'crawlio_accessibility_preferences';
const DEFAULTS: AccessibilityPreferences = {
  textScale: 'default',
  density: 'comfortable',
  motion: 'system',
  chartContrast: 'standard',
};

function readPreferences(): AccessibilityPreferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<AccessibilityPreferences>;
    return {
      textScale: parsed.textScale === 'large' ? 'large' : 'default',
      density: parsed.density === 'compact' ? 'compact' : 'comfortable',
      motion: parsed.motion === 'reduced' ? 'reduced' : 'system',
      chartContrast: parsed.chartContrast === 'high' ? 'high' : 'standard',
    };
  } catch {
    return DEFAULTS;
  }
}

function applyPreferences(preferences: AccessibilityPreferences) {
  const root = document.documentElement;
  root.dataset.textScale = preferences.textScale;
  root.dataset.density = preferences.density;
  root.dataset.motion = preferences.motion;
  root.dataset.chartContrast = preferences.chartContrast;
}

interface AccessibilityContextValue {
  preferences: AccessibilityPreferences;
  updatePreferences: (next: Partial<AccessibilityPreferences>) => void;
  resetPreferences: () => void;
}

const AccessibilityContext = createContext<AccessibilityContextValue | null>(null);

export function AccessibilityProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<AccessibilityPreferences>(readPreferences);

  useEffect(() => {
    applyPreferences(preferences);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences]);

  const updatePreferences = useCallback((next: Partial<AccessibilityPreferences>) => {
    setPreferences((current) => ({ ...current, ...next }));
  }, []);

  const resetPreferences = useCallback(() => setPreferences(DEFAULTS), []);
  const value = useMemo(() => ({ preferences, updatePreferences, resetPreferences }), [preferences, resetPreferences, updatePreferences]);

  return <AccessibilityContext.Provider value={value}>{children}</AccessibilityContext.Provider>;
}

export function useAccessibilityPreferences() {
  const value = useContext(AccessibilityContext);
  if (!value) throw new Error('useAccessibilityPreferences must be used within AccessibilityProvider.');
  return value;
}
