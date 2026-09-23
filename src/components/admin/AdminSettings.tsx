import { Loader2,Settings } from 'lucide-react';
import { useEffect,useState } from 'react';
import {
getPlatformSettings,
updatePlatformSettings
} from '../../services/supabaseDataService';
import { Notice } from '../ui/page-system';
import { useAdminActionReason } from './AdminActionDialog';
import { useAdminData } from './useAdminData';


import { Field,Loading,Panel } from './shared';
export default function AdminSettings() {
  const requestAdminReason = useAdminActionReason();
  const settings = useAdminData(() => getPlatformSettings(), []);
  const [draft, setDraft] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);

  const save = async () => {
    const reason = await requestAdminReason('updating platform settings');
    if (!reason) return;
    setSaving(true);
    setError(null);
    setMessage('');
    try {
      await updatePlatformSettings(draft, reason);
      setMessage('Platform settings saved.');
      settings.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Settings could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  if (settings.loading) return <Loading />;
  return (
    <Panel title="Platform settings" description="Safe operational controls stored in Supabase. Sensitive keys remain environment variables." icon={Settings}>
      {(settings.error || error) && <Notice tone="danger" className="mb-4">{settings.error || error}</Notice>}
      {message && <Notice tone="success" className="mb-4">{message}</Notice>}
      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Platform name" value={draft.platformName || ''} onChange={(platformName) => setDraft({ ...draft, platformName })} />
        <Field label="Support email" value={draft.supportEmail || ''} onChange={(supportEmail) => setDraft({ ...draft, supportEmail })} />
        <Field label="Queue fairness paid burst" value={String(draft.value?.queueFairnessPaidBurst ?? 5)} onChange={(value) => setDraft({ ...draft, value: { ...(draft.value || {}), queueFairnessPaidBurst: Number(value) } })} />
        <label className="block text-sm"><span className="font-semibold">Guest audit access</span><select value={String(draft.value?.guestAuditEnabled ?? true)} onChange={(event) => setDraft({ ...draft, value: { ...(draft.value || {}), guestAuditEnabled: event.target.value === 'true' } })} className="suite-input mt-2"><option value="true">Enabled</option><option value="false">Disabled</option></select></label>
        <label className="block text-sm"><span className="font-semibold">Maintenance mode</span><select value={String(draft.value?.maintenanceMode ?? false)} onChange={(event) => setDraft({ ...draft, value: { ...(draft.value || {}), maintenanceMode: event.target.value === 'true' } })} className="suite-input mt-2"><option value="false">Off</option><option value="true">Block new audits</option></select></label>
        <label className="block text-sm"><span className="font-semibold">New Free audits</span><select value={String(draft.value?.pauseFreeSubmissions ?? false)} onChange={(event) => setDraft({ ...draft, value: { ...(draft.value || {}), pauseFreeSubmissions: event.target.value === 'true' } })} className="suite-input mt-2"><option value="false">Accepting</option><option value="true">Paused</option></select></label>
        <label className="block text-sm"><span className="font-semibold">Guest verification</span><select value={String(draft.value?.captchaRequired ?? false)} onChange={(event) => setDraft({ ...draft, value: { ...(draft.value || {}), captchaRequired: event.target.value === 'true' } })} className="suite-input mt-2"><option value="false">Not required</option><option value="true">Require configured token</option></select></label>
        <Field label="Soft queue warning" value={String(draft.value?.softQueueWarning ?? 40)} onChange={(value) => setDraft({ ...draft, value: { ...(draft.value || {}), softQueueWarning: Math.max(1, Number(value)) } })} />
        <Field label="Hard global queue limit" value={String(draft.value?.hardQueueLimit ?? 50)} onChange={(value) => setDraft({ ...draft, value: { ...(draft.value || {}), hardQueueLimit: Math.max(1, Number(value)) } })} />
        <fieldset className="rounded-lg border border-border p-3 md:col-span-2"><legend className="px-1 text-sm font-semibold">Temporarily disabled audit types</legend><div className="mt-2 flex flex-wrap gap-4">{['quick', 'standard', 'deep'].map((mode) => { const disabled = Array.isArray(draft.value?.disabledAuditModes) && draft.value.disabledAuditModes.includes(mode); return <label key={mode} className="flex items-center gap-2 text-sm capitalize"><input type="checkbox" checked={disabled} onChange={(event) => { const current = Array.isArray(draft.value?.disabledAuditModes) ? draft.value.disabledAuditModes : []; const disabledAuditModes = event.target.checked ? [...new Set([...current, mode])] : current.filter((item: string) => item !== mode); setDraft({ ...draft, value: { ...(draft.value || {}), disabledAuditModes } }); }} className="h-4 w-4 accent-[var(--accent)]" />{mode}</label>; })}</div></fieldset>
      </div>
      <button onClick={save} disabled={saving} className="trust-button mt-5">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings className="h-4 w-4" />} Save settings</button>
    </Panel>
  );
}
