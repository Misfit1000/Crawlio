begin;

create or replace function public.complete_vercel_blog_stage(
  job_id uuid, execution_id text, expected_stage text, next_stage text,
  next_state text, output_patch jsonb default '{}'::jsonb,
  progress_value integer default 0, message_value text default ''
)
returns setof public.blog_generation_jobs
language plpgsql security definer set search_path = public as $$
declare
  completed public.blog_generation_jobs;
  provider_ready_at timestamptz;
begin
  update public.blog_generation_jobs set
    workflow_stage = next_stage, state = next_state,
    stage_outputs = stage_outputs || coalesce(output_patch, '{}'::jsonb),
    stage_progress = greatest(0, least(100, progress_value)),
    status_message = left(coalesce(nullif(message_value, ''), replace(next_stage, '_', ' ')), 240),
    stage_attempt_count = 0, locked_by = null, locked_at = null, lease_expires_at = null,
    next_retry_at = null, last_safe_error_code = '', error = '', last_stage_at = now(), updated_at = now(),
    completed_at = case when next_stage in ('published','failed','cancelled','ready_for_review','scheduled') then now() else completed_at end
  where id = job_id and execution_target = 'vercel' and workflow_stage = expected_stage
    and locked_by = execution_id and lease_expires_at > now()
  returning * into completed;
  if completed.id is null then return; end if;

  -- Share successful provider cooldowns through the existing atomic checkpoint.
  if output_patch ? 'nextProviderRequestAt' then
    begin
      provider_ready_at = least(now() + interval '15 minutes',
        greatest(now(), (output_patch->>'nextProviderRequestAt')::timestamptz));
    exception when invalid_datetime_format or datetime_field_overflow then
      provider_ready_at = now() + interval '30 seconds';
    end;
  end if;
  update public.blog_dispatcher_state set
    last_successful_stage_at = now(), dispatched_stages = dispatched_stages + 1,
    last_safe_error_code = '',
    consecutive_rate_limits = case when provider_ready_at is not null then 0 else consecutive_rate_limits end,
    provider_pause_until = case when provider_ready_at is not null then provider_ready_at else provider_pause_until end,
    updated_at = now()
  where id = 'vercel';
  return next completed;
end;
$$;

revoke all on function public.complete_vercel_blog_stage(uuid,text,text,text,text,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.complete_vercel_blog_stage(uuid,text,text,text,text,jsonb,integer,text) to service_role;
notify pgrst, 'reload schema';
commit;
