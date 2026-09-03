-- ============================================================================
-- 20260903000300_ledger_post.sql
-- The single balanced-entry writer. Every app.post_* pattern in
-- docs/05-money.md §3 is built on top of this; none of them exist yet (they are
-- phase 5). This is here in phase 1 because 04-rls.sql forbids a direct INSERT
-- into financial_entry — "only app.post_*" — and 12-test-plan.md §fixtures
-- requires orders "with matching ledger transactions". See DECISION D7.
--
-- It deliberately does NOT check the balance itself: the deferred constraint
-- trigger app.assert_transaction_balanced() does that at COMMIT, which is what
-- lets a caller build a multi-leg transaction one statement at a time, and what
-- ledger test L14 asserts.
-- ============================================================================
set search_path = public, extensions;

create or replace function app.post_entries(
  p_transaction_id uuid,
  p_entries        jsonb,
  p_created_by     text default 'system'
) returns setof public.financial_entry
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) < 2 then
    raise exception 'a ledger transaction needs at least two legs'
      using errcode = 'BG002';
  end if;

  return query
  insert into public.financial_entry (
    transaction_id, entry_type, account, amount_minor, currency, market,
    partner_id, store_id, order_id, payment_id, payout_id,
    reference_type, reference_id, effective_at, contract_version_id,
    created_by, reason_code, reverses_entry_id
  )
  select
    p_transaction_id, e.entry_type, e.account, e.amount_minor, e.currency, e.market,
    e.partner_id, e.store_id, e.order_id, e.payment_id, e.payout_id,
    e.reference_type, e.reference_id, e.effective_at, e.contract_version_id,
    coalesce(e.created_by, p_created_by), e.reason_code, e.reverses_entry_id
  from jsonb_to_recordset(p_entries) as e(
    entry_type          public.entry_type,
    account             public.ledger_account,
    amount_minor        bigint,
    currency            char(3),
    market              public.market,
    partner_id          uuid,
    store_id            uuid,
    order_id            uuid,
    payment_id          uuid,
    payout_id           uuid,
    reference_type      public.reference_type,
    reference_id        uuid,
    effective_at        timestamptz,
    contract_version_id uuid,
    created_by          text,
    reason_code         text,
    reverses_entry_id   uuid
  )
  returning *;
end $$;

comment on function app.post_entries is
  'Writes one balanced ledger transaction. Balance is enforced at commit by the
   deferred constraint trigger, never here. Corrections are new reversing
   entries — financial_entry is append-only (05-money.md §1.3).';

revoke all on function app.post_entries(uuid, jsonb, text) from public, anon, authenticated;
