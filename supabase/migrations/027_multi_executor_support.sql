-- Phase 17, 38, and 54: Multi-Executor Support

-- 1. Add executor identity columns to the audits table
ALTER TABLE public.audits
  ADD COLUMN IF NOT EXISTS executor_type text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS executor_instance_id text DEFAULT NULL;

-- 2. Add executor version tracking columns
ALTER TABLE public.audits
  ADD COLUMN IF NOT EXISTS audit_engine_version text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS check_registry_version text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS scoring_version text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS evidence_version text DEFAULT NULL;

-- 3. Add executor preference column (default 'auto')
ALTER TABLE public.audits
  ADD COLUMN IF NOT EXISTS executor_preference text DEFAULT 'auto';

-- 4. Add executor tracking to audit_crawl_runs
ALTER TABLE public.audit_crawl_runs
  ADD COLUMN IF NOT EXISTS executor_type text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS executor_instance_id text DEFAULT NULL;

-- 5. Create an executor health registry table
CREATE TABLE IF NOT EXISTS public.executor_health (
  executor_type text NOT NULL,
  executor_instance_id text NOT NULL,
  healthy boolean DEFAULT true,
  audit_engine_version text NOT NULL,
  check_registry_version text NOT NULL,
  scoring_version text NOT NULL,
  evidence_version text NOT NULL,
  supported_profiles text[] DEFAULT '{}',
  active_jobs integer DEFAULT 0,
  last_heartbeat_at timestamptz DEFAULT now(),
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (executor_type, executor_instance_id)
);

-- 6. Enable RLS on executor_health and create appropriate policies
ALTER TABLE public.executor_health ENABLE ROW LEVEL SECURITY;

-- Service role: full CRUD
CREATE POLICY "Service role full access to executor_health"
  ON public.executor_health
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated admin: SELECT only via existing is_admin_user function
CREATE POLICY "Admin select access to executor_health"
  ON public.executor_health
  FOR SELECT
  TO authenticated
  USING (public.is_admin_user(auth.uid()));

-- 7. Add an index for querying audits by executor
CREATE INDEX IF NOT EXISTS idx_audits_executor_type ON public.audits (executor_type) WHERE executor_type IS NOT NULL;

-- 8. Create an RPC function claim_audit_for_executor
CREATE OR REPLACE FUNCTION public.claim_audit_for_executor(
  p_worker_id text,
  p_executor_type text,
  p_engine_version text,
  p_check_version text,
  p_scoring_version text
) RETURNS uuid AS $$
DECLARE
  v_audit_id uuid;
BEGIN
  -- set search_path
  PERFORM set_config('search_path', '', true);

  -- Find the oldest queued audit matching executor_preference
  SELECT id INTO v_audit_id
  FROM public.audits
  WHERE status = 'queued'
    AND (executor_preference = 'auto' OR executor_preference = p_executor_type)
  ORDER BY created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_audit_id IS NOT NULL THEN
    -- Claim the audit
    UPDATE public.audits
    SET status = 'running',
        locked_by = p_worker_id,
        executor_type = p_executor_type,
        executor_instance_id = p_worker_id,
        audit_engine_version = p_engine_version,
        check_registry_version = p_check_version,
        scoring_version = p_scoring_version,
        lease_expires_at = now() + interval '5 minutes',
        started_at = now(),
        updated_at = now()
    WHERE id = v_audit_id;
  END IF;

  RETURN v_audit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 9. Update the deployment_versions schema version to 15
UPDATE public.deployment_versions
SET api_schema_version = 15,
    audit_engine_version = '2026.09',
    scoring_version = '2.2',
    check_registry_version = '3.1',
    updated_at = now()
WHERE component = 'database';
