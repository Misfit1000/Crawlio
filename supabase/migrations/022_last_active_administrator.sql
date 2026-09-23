create or replace function public.guard_last_active_administrator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'admin'
     and old.disabled = false
     and (new.role <> 'admin' or new.disabled = true) then
    perform pg_advisory_xact_lock(hashtext('crawlio'), hashtext('active_administrator'));
    if (select count(*) from public.user_profiles where role = 'admin' and disabled = false) <= 1 then
      raise exception 'The final active administrator cannot be removed.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_last_active_administrator() from public, anon, authenticated;

drop trigger if exists guard_last_active_administrator on public.user_profiles;
create trigger guard_last_active_administrator
before update of role, disabled on public.user_profiles
for each row execute function public.guard_last_active_administrator();
