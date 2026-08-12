-- Add queryable, privacy-safe tracing dimensions to AI usage. Raw questions,
-- answers and prompts remain excluded; the existing metadata sanitizer still
-- applies before this function receives an event.

alter table deckaura.ai_usage_events
  add column stage text,
  add column reading_id text,
  add column conversation_id uuid,
  add column turn_index smallint,
  add column error_code text;
alter table deckaura.ai_usage_events
  add constraint ai_usage_events_stage_length
    check (stage is null or char_length(stage) between 1 and 64),
  add constraint ai_usage_events_reading_id_length
    check (reading_id is null or char_length(reading_id) between 1 and 100),
  add constraint ai_usage_events_turn_index
    check (turn_index is null or turn_index between 0 and 32),
  add constraint ai_usage_events_error_code_length
    check (error_code is null or char_length(error_code) between 1 and 96);
create index ai_usage_events_reading_created_idx
  on deckaura.ai_usage_events (reading_id, created_at desc)
  where reading_id is not null;
create index ai_usage_events_conversation_turn_idx
  on deckaura.ai_usage_events (conversation_id, turn_index, created_at)
  where conversation_id is not null;
create index ai_usage_events_stage_created_idx
  on deckaura.ai_usage_events (stage, created_at desc)
  where stage is not null;
create or replace function deckaura.record_ai_usage(
  p_idempotency_key text,
  p_claim_id uuid,
  p_request_id text,
  p_feature text,
  p_route text,
  p_provider text,
  p_model text,
  p_status text,
  p_locale text,
  p_page text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cached_input_tokens integer,
  p_cost_micros bigint,
  p_latency_ms integer,
  p_retry_count integer,
  p_fallback_from text,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_event deckaura.ai_usage_events%rowtype;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_conversation_id uuid;
  v_turn_index smallint;
begin
  begin
    v_conversation_id := nullif(v_metadata ->> 'conversationId', '')::uuid;
  exception when invalid_text_representation then
    v_conversation_id := null;
  end;
  begin
    v_turn_index := nullif(v_metadata ->> 'turnIndex', '')::smallint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    v_turn_index := null;
  end;

  insert into deckaura.ai_usage_events(
    idempotency_key, claim_id, request_id, feature, route, provider, model,
    status, locale, page, input_tokens, output_tokens, cached_input_tokens,
    cost_micros, latency_ms, retry_count, fallback_from, metadata,
    stage, reading_id, conversation_id, turn_index, error_code
  ) values (
    p_idempotency_key, p_claim_id, p_request_id, p_feature, nullif(p_route, ''),
    p_provider, p_model, p_status, nullif(p_locale, ''), nullif(p_page, ''),
    greatest(0, coalesce(p_input_tokens, 0)),
    greatest(0, coalesce(p_output_tokens, 0)),
    greatest(0, coalesce(p_cached_input_tokens, 0)),
    greatest(0, coalesce(p_cost_micros, 0)),
    greatest(0, coalesce(p_latency_ms, 0)),
    greatest(0, least(coalesce(p_retry_count, 0), 10)),
    nullif(p_fallback_from, ''), v_metadata,
    nullif(left(v_metadata ->> 'stage', 64), ''),
    nullif(left(v_metadata ->> 'readingId', 100), ''),
    v_conversation_id,
    v_turn_index,
    nullif(left(v_metadata ->> 'errorCode', 96), '')
  )
  on conflict (idempotency_key) do nothing;

  select * into v_event
    from deckaura.ai_usage_events
   where idempotency_key = p_idempotency_key
   for update;

  if v_event.request_id <> p_request_id
     or v_event.feature <> p_feature
     or v_event.provider <> p_provider
     or v_event.model <> p_model
     or (v_event.claim_id is not null and p_claim_id is not null and v_event.claim_id <> p_claim_id) then
    raise exception 'AI usage idempotency conflict';
  end if;

  update deckaura.ai_usage_events
     set claim_id = coalesce(p_claim_id, claim_id),
         status = p_status,
         input_tokens = greatest(0, coalesce(p_input_tokens, 0)),
         output_tokens = greatest(0, coalesce(p_output_tokens, 0)),
         cached_input_tokens = greatest(0, coalesce(p_cached_input_tokens, 0)),
         cost_micros = greatest(0, coalesce(p_cost_micros, 0)),
         latency_ms = greatest(0, coalesce(p_latency_ms, 0)),
         retry_count = greatest(0, least(coalesce(p_retry_count, 0), 10)),
         fallback_from = nullif(p_fallback_from, ''),
         metadata = v_metadata,
         stage = nullif(left(v_metadata ->> 'stage', 64), ''),
         reading_id = nullif(left(v_metadata ->> 'readingId', 100), ''),
         conversation_id = v_conversation_id,
         turn_index = v_turn_index,
         error_code = nullif(left(v_metadata ->> 'errorCode', 96), '')
   where id = v_event.id
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function deckaura.record_ai_usage(
  text, uuid, text, text, text, text, text, text, text, text,
  integer, integer, integer, bigint, integer, integer, text, jsonb
) from public, anon, authenticated;
