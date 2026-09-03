-- ============================================================================
-- 20260903000400_staff_invite.sql
-- app.invite_staff — the one authorisation rule RLS cannot express.
-- 04-rls.sql says of staff_assignment: "Invites and revocations go through
-- app.invite_staff() / app.revoke_staff(); a manager may only manage 'staff',
-- enforced in the function." RLS test 4 asserts the BG100 raise, so the
-- function has to exist in phase 1. See DECISION D8.
-- ============================================================================
set search_path = public, extensions;

create or replace function app.invite_staff(
  p_user     uuid,
  p_partner  uuid,
  p_store    uuid,
  p_role     public.partner_role
) returns public.staff_assignment
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_role public.partner_role;
  v_row         public.staff_assignment;
begin
  -- Resolve the caller's own role at this store. Partner-wide roles (owner,
  -- accountant) count for every store under the partner.
  select a.role into v_caller_role
  from public.staff_assignment a
  where a.user_id = auth.uid()
    and a.revoked_at is null
    and a.partner_id = p_partner
    and (a.store_id = p_store or a.partner_wide)
  order by case a.role when 'owner' then 1 when 'manager' then 2 else 3 end
  limit 1;

  if v_caller_role is null then
    raise exception 'not authorised to manage staff for this partner'
      using errcode = 'BG100';
  end if;

  -- An owner may invite anyone. A manager may invite ONLY staff: letting a
  -- manager mint another manager is a privilege-escalation path.
  if v_caller_role = 'manager' and p_role <> 'staff' then
    raise exception 'a manager may only invite staff, not %', p_role
      using errcode = 'BG100';
  end if;

  if v_caller_role not in ('owner', 'manager') then
    raise exception 'role % may not invite staff', v_caller_role
      using errcode = 'BG100';
  end if;

  insert into public.staff_assignment (user_id, partner_id, store_id, role,
                                       partner_wide, invited_by)
  values (p_user, p_partner, p_store, p_role, p_store is null, auth.uid())
  returning * into v_row;

  insert into public.audit_log (actor_user, actor_role, operation, target_type,
                                target_id, after)
  values (auth.uid(), v_caller_role::text, 'invite_staff', 'staff_assignment',
          v_row.id, to_jsonb(v_row));

  return v_row;
end $$;

comment on function app.invite_staff is
  'Invites a partner user to a store. A manager may only invite staff; anything
   else raises BG100 (12-test-plan.md §RLS-4).';

grant execute on function app.invite_staff(uuid, uuid, uuid, public.partner_role) to authenticated;
