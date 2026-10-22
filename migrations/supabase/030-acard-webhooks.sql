-- acard-webhook (#113): outgoing webhooks per workspace. A user registers an https URL; when pages change, the Worker
-- queues one delivery per endpoint and page, debounced, and the acard-workspace Worker's alarm/cron sends it.
--   webhook_endpoints   registered URLs, event filter, on/off, failure count, the AES-GCM encrypted signing secret
--   webhook_deliveries  one row per send. The open (pending) row of an endpoint+page collects changes until send_after;
--                       sent rows keep the page state they described, so the next change is compared with what the
--                       receiver last heard (rename / move / trash / restore).
-- RLS on with no policies and every grant revoked from anon/authenticated: only the Worker (service role) reaches the
-- data, and only through the functions below (EXECUTE revoked from PUBLIC/anon/authenticated). No triggers.
-- Debounce, max wait, backoff, attempts and auto-disable come from the Worker in p_config (gate/webhooks.ts
-- WEBHOOK_CONFIG); an endpoint's tuning column (service role only, used for QA) overrides them.
--
-- Rollback (drops webhook data only; nothing else references these objects):
--   DROP FUNCTION IF EXISTS public.webhook_events(jsonb, jsonb, text[]), public.webhook_rank(text),
--     public.webhook_public(public.webhook_endpoints), public.webhook_create(text, uuid, text, text, text[], text, text, int),
--     public.webhook_list(text), public.webhook_update(text, uuid, jsonb), public.webhook_delete(text, uuid),
--     public.webhook_target(text, uuid), public.webhook_log(text, uuid, int),
--     public.webhook_record(text, uuid, text, boolean, int, text, int), public.webhook_enqueue(text, jsonb, jsonb, jsonb),
--     public.webhook_claim(int, int), public.webhook_result(uuid, boolean, int, text, int, jsonb), public.webhook_next(),
--     public.webhook_prune(int);
--   DROP TABLE IF EXISTS public.webhook_deliveries, public.webhook_endpoints;

CREATE TABLE IF NOT EXISTS public.webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ws text NOT NULL CHECK (ws = 'owner' OR ws ~ '^[0-9a-f]{32}$'),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url text NOT NULL CHECK (url LIKE 'https://%' AND length(url) <= 2000),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 200),
  events text[] NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  secret_enc text NOT NULL,
  secret_hint text NOT NULL,
  consecutive_failures int NOT NULL DEFAULT 0,
  disabled_reason text,
  disabled_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_status int,
  tuning jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_endpoints_ws ON public.webhook_endpoints (ws, created_at);

CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id uuid NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  ws text NOT NULL,
  page_slug text NOT NULL,
  event_type text NOT NULL,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  page jsonb,
  actor jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'retry', 'delivered', 'failed', 'skipped')),
  first_change_at timestamptz NOT NULL DEFAULT now(),
  last_change_at timestamptz NOT NULL DEFAULT now(),
  send_after timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz,
  lease_until timestamptz,
  attempts int NOT NULL DEFAULT 0,
  last_status int,
  last_error text,
  last_ms int,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS webhook_deliveries_open ON public.webhook_deliveries (endpoint_id, page_slug) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS webhook_deliveries_due ON public.webhook_deliveries (status, send_after);
CREATE INDEX IF NOT EXISTS webhook_deliveries_page ON public.webhook_deliveries (endpoint_id, page_slug, last_change_at DESC);
CREATE INDEX IF NOT EXISTS webhook_deliveries_recent ON public.webhook_deliveries (endpoint_id, created_at DESC);

ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_endpoints, public.webhook_deliveries FROM anon, authenticated;

-- Events of one change, from the state the receiver last heard (b, null if never) and the state now (s), plus hints
-- the Worker read off the request: created, deleted, trashed, restored, content, and rename/move only from the explicit
-- rename and move routes (a plain save rewrites the title and parent with the same values).
CREATE OR REPLACE FUNCTION public.webhook_events(b jsonb, s jsonb, hints text[]) RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  out text[] := '{}';
  ex boolean := coalesce((s->>'exists')::boolean, false);
  tr boolean := coalesce((s->>'trashed')::boolean, false);
  bex boolean := b IS NOT NULL AND coalesce((b->>'exists')::boolean, true);
  btr boolean := coalesce((b->>'trashed')::boolean, false);
BEGIN
  IF NOT ex THEN
    IF bex OR (b IS NULL AND 'deleted' = ANY(hints)) THEN RETURN ARRAY['page.deleted']; END IF;
    RETURN out;
  END IF;
  IF 'created' = ANY(hints) AND NOT bex THEN out := out || 'page.created'::text; END IF;
  IF tr AND ((bex AND NOT btr) OR (b IS NULL AND 'trashed' = ANY(hints))) THEN out := out || 'page.trashed'::text; END IF;
  IF NOT tr AND ((bex AND btr) OR (b IS NULL AND 'restored' = ANY(hints))) THEN out := out || 'page.restored'::text; END IF;
  IF 'page.created' <> ALL(out) THEN
    IF (bex AND (b->>'title') IS DISTINCT FROM (s->>'title')) OR (b IS NULL AND 'rename' = ANY(hints)) THEN out := out || 'page.renamed'::text; END IF;
    IF (bex AND (b->>'parent') IS DISTINCT FROM (s->>'parent')) OR (b IS NULL AND 'move' = ANY(hints)) THEN out := out || 'page.moved'::text; END IF;
  END IF;
  IF cardinality(out) = 0 AND hints && ARRAY['content', 'rename', 'move'] THEN out := ARRAY['page.updated']; END IF;
  RETURN out;
END $$;

-- The headline event of a delivery is the strongest of its changes.
CREATE OR REPLACE FUNCTION public.webhook_rank(t text) RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE t WHEN 'page.deleted' THEN 7 WHEN 'page.trashed' THEN 6 WHEN 'page.restored' THEN 5 WHEN 'page.created' THEN 4
    WHEN 'page.moved' THEN 3 WHEN 'page.renamed' THEN 2 WHEN 'page.updated' THEN 1 ELSE 0 END
$$;

-- What the settings screen may see of an endpoint: never secret_enc, never tuning.
CREATE OR REPLACE FUNCTION public.webhook_public(e public.webhook_endpoints) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('id', e.id, 'url', e.url, 'description', e.description, 'events', to_jsonb(e.events), 'enabled', e.enabled,
    'disabled_reason', e.disabled_reason, 'disabled_at', e.disabled_at, 'consecutive_failures', e.consecutive_failures,
    'last_success_at', e.last_success_at, 'last_failure_at', e.last_failure_at, 'last_status', e.last_status,
    'secret_hint', e.secret_hint, 'created_at', e.created_at, 'updated_at', e.updated_at)
$$;

-- Creates an endpoint unless the workspace already has p_limit of them (counted under a per-workspace lock).
CREATE OR REPLACE FUNCTION public.webhook_create(p_ws text, p_user uuid, p_url text, p_description text, p_events text[], p_secret_enc text,
  p_secret_hint text, p_limit int) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE made public.webhook_endpoints;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('acard-webhooks:' || p_ws));
  IF (SELECT count(*) FROM public.webhook_endpoints WHERE ws = p_ws) >= p_limit THEN RETURN jsonb_build_object('error', 'limit'); END IF;
  INSERT INTO public.webhook_endpoints (ws, user_id, url, description, events, secret_enc, secret_hint)
  VALUES (p_ws, p_user, p_url, coalesce(p_description, ''), p_events, p_secret_enc, p_secret_hint) RETURNING * INTO made;
  RETURN public.webhook_public(made);
END $$;

CREATE OR REPLACE FUNCTION public.webhook_list(p_ws text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(public.webhook_public(e) ORDER BY e.created_at), '[]'::jsonb) FROM public.webhook_endpoints e WHERE e.ws = p_ws
$$;

-- p_patch keys: url, description, events, enabled, secret_enc + secret_hint. Turning an endpoint on clears its failures.
CREATE OR REPLACE FUNCTION public.webhook_update(p_ws text, p_id uuid, p_patch jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE row public.webhook_endpoints;
BEGIN
  UPDATE public.webhook_endpoints e SET
    url = coalesce(p_patch->>'url', e.url),
    description = coalesce(p_patch->>'description', e.description),
    events = CASE WHEN p_patch ? 'events' THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'events')) ELSE e.events END,
    enabled = coalesce((p_patch->>'enabled')::boolean, e.enabled),
    consecutive_failures = CASE WHEN (p_patch->>'enabled')::boolean THEN 0 ELSE e.consecutive_failures END,
    disabled_reason = CASE WHEN (p_patch->>'enabled')::boolean THEN NULL WHEN (p_patch->>'enabled')::boolean = false THEN 'user' ELSE e.disabled_reason END,
    disabled_at = CASE WHEN (p_patch->>'enabled')::boolean THEN NULL WHEN (p_patch->>'enabled')::boolean = false THEN now() ELSE e.disabled_at END,
    secret_enc = coalesce(p_patch->>'secret_enc', e.secret_enc),
    secret_hint = coalesce(p_patch->>'secret_hint', e.secret_hint),
    updated_at = now()
  WHERE e.ws = p_ws AND e.id = p_id RETURNING * INTO row;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF (p_patch->>'enabled')::boolean = false THEN
    UPDATE public.webhook_deliveries SET status = 'skipped', updated_at = now() WHERE endpoint_id = p_id AND status IN ('pending', 'retry');
  END IF;
  RETURN public.webhook_public(row);
END $$;

CREATE OR REPLACE FUNCTION public.webhook_delete(p_ws text, p_id uuid) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.webhook_endpoints WHERE ws = p_ws AND id = p_id;
  RETURN FOUND;
END $$;

-- Address and encrypted secret of one endpoint, for a test send; the Worker decrypts it and never returns it.
CREATE OR REPLACE FUNCTION public.webhook_target(p_ws text, p_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('url', e.url, 'secret_enc', e.secret_enc) FROM public.webhook_endpoints e WHERE e.ws = p_ws AND e.id = p_id
$$;

CREATE OR REPLACE FUNCTION public.webhook_log(p_ws text, p_id uuid, p_limit int) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'created_at' DESC), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('id', d.id, 'event', d.event_type, 'page', d.page_slug, 'title', d.page->>'title', 'status', d.status,
      'attempts', d.attempts, 'http_status', d.last_status, 'error', d.last_error, 'ms', d.last_ms, 'created_at', d.created_at,
      'updated_at', d.updated_at, 'delivered_at', d.delivered_at, 'next_attempt_at', d.next_attempt_at) AS x
    FROM public.webhook_deliveries d WHERE d.ws = p_ws AND d.endpoint_id = p_id ORDER BY d.created_at DESC LIMIT p_limit
  ) s
$$;

-- A test send ("ping") is sent at once by the Worker and only recorded here; it does not count toward auto-disable.
CREATE OR REPLACE FUNCTION public.webhook_record(p_ws text, p_id uuid, p_type text, p_ok boolean, p_status int, p_error text, p_ms int) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.webhook_deliveries (endpoint_id, ws, page_slug, event_type, changes, status, attempts, last_status, last_error, last_ms, delivered_at)
  SELECT e.id, e.ws, '', p_type, jsonb_build_array(p_type), CASE WHEN p_ok THEN 'delivered' ELSE 'failed' END, 1, p_status, left(p_error, 300), p_ms,
    CASE WHEN p_ok THEN now() END
  FROM public.webhook_endpoints e WHERE e.ws = p_ws AND e.id = p_id
  RETURNING id
$$;

-- p_items: [{slug, state: {exists, title, parent, kind, trashed}, hints: [...]}]. Returns {endpoints, queued, next (epoch ms)}.
CREATE OR REPLACE FUNCTION public.webhook_enqueue(p_ws text, p_items jsonb, p_actor jsonb, p_config jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  e record;
  it jsonb;
  cfg jsonb;
  slug text;
  st jsonb;
  b jsonb;
  pend record;
  have boolean;
  evs text[];
  merged jsonb;
  endpoints int := 0;
  queued int := 0;
  soonest timestamptz;
  due timestamptz;
BEGIN
  FOR e IN SELECT * FROM public.webhook_endpoints WHERE ws = p_ws AND enabled ORDER BY created_at LOOP
    endpoints := endpoints + 1;
    cfg := coalesce(p_config, '{}'::jsonb) || e.tuning;
    FOR it IN SELECT * FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) LOOP
      slug := it->>'slug';
      CONTINUE WHEN slug IS NULL OR slug = '' OR length(slug) > 200;
      -- Two requests saving the same page at once can both find no open row; the one whose insert loses merges instead.
      FOR attempt IN 1..2 LOOP
        st := it->'state';
        SELECT * INTO pend FROM public.webhook_deliveries WHERE endpoint_id = e.id AND page_slug = slug AND status = 'pending' FOR UPDATE;
        have := FOUND;
        IF have THEN b := pend.page;
        ELSE b := (SELECT d.page FROM public.webhook_deliveries d WHERE d.endpoint_id = e.id AND d.page_slug = slug ORDER BY d.last_change_at DESC LIMIT 1);
        END IF;
        evs := public.webhook_events(b, st, ARRAY(SELECT jsonb_array_elements_text(coalesce(it->'hints', '[]'::jsonb))));
        evs := ARRAY(SELECT x FROM unnest(evs) x WHERE x = ANY(e.events));
        EXIT WHEN cardinality(evs) = 0;
        -- A deleted page keeps the title and parent the receiver knew, so the payload still says which page it was.
        IF NOT coalesce((st->>'exists')::boolean, false) THEN st := coalesce(b, '{}'::jsonb) || jsonb_build_object('exists', false); END IF;
        IF have THEN
          merged := (SELECT jsonb_agg(x ORDER BY public.webhook_rank(x) DESC) FROM (SELECT DISTINCT x FROM jsonb_array_elements_text(pend.changes || to_jsonb(evs)) x) s);
          due := least(now() + make_interval(secs => (cfg->>'debounce_ms')::numeric / 1000),
                       pend.first_change_at + make_interval(secs => (cfg->>'max_wait_ms')::numeric / 1000));
          UPDATE public.webhook_deliveries SET changes = merged, event_type = merged->>0, page = st, actor = p_actor,
            last_change_at = now(), send_after = due, updated_at = now()
          WHERE id = pend.id;
        ELSE
          due := now() + make_interval(secs => (cfg->>'debounce_ms')::numeric / 1000);
          merged := (SELECT jsonb_agg(x ORDER BY public.webhook_rank(x) DESC) FROM (SELECT DISTINCT x FROM unnest(evs) x) s);
          BEGIN
            INSERT INTO public.webhook_deliveries (endpoint_id, ws, page_slug, event_type, changes, page, actor, send_after)
            VALUES (e.id, p_ws, slug, merged->>0, merged, st, p_actor, due);
          EXCEPTION WHEN unique_violation THEN
            CONTINUE;
          END;
        END IF;
        queued := queued + 1;
        soonest := least(soonest, due);
        EXIT;
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('endpoints', endpoints, 'queued', queued,
    'next', CASE WHEN soonest IS NULL THEN NULL ELSE floor(extract(epoch FROM soonest) * 1000) END);
END $$;

-- Leases up to p_limit due deliveries (debounce over, retry time reached, or a send whose lease ran out), so a cron
-- tick and an alarm tick running together never send the same row twice.
CREATE OR REPLACE FUNCTION public.webhook_claim(p_limit int, p_lease_ms int) RETURNS jsonb LANGUAGE sql AS $$
  WITH due AS (
    SELECT d.id FROM public.webhook_deliveries d JOIN public.webhook_endpoints e ON e.id = d.endpoint_id
    WHERE e.enabled AND ((d.status = 'pending' AND d.send_after <= now()) OR (d.status = 'retry' AND d.next_attempt_at <= now())
      OR (d.status = 'sending' AND d.lease_until < now()))
    ORDER BY coalesce(d.next_attempt_at, d.send_after) LIMIT p_limit FOR UPDATE OF d SKIP LOCKED
  ), took AS (
    UPDATE public.webhook_deliveries d SET status = 'sending', lease_until = now() + make_interval(secs => p_lease_ms::numeric / 1000),
      attempts = d.attempts + 1, updated_at = now()
    FROM due WHERE d.id = due.id RETURNING d.*
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'endpoint_id', t.endpoint_id, 'ws', t.ws, 'page_slug', t.page_slug,
    'event_type', t.event_type, 'changes', t.changes, 'page', t.page, 'actor', t.actor, 'attempts', t.attempts,
    'last_change_at', t.last_change_at, 'url', e.url, 'secret_enc', e.secret_enc, 'tuning', e.tuning)), '[]'::jsonb)
  FROM took t JOIN public.webhook_endpoints e ON e.id = t.endpoint_id
$$;

-- Records one attempt. A failure schedules the next try at base * 2^(attempt-1), capped, until max_attempts; an endpoint
-- that failed disable_after times in a row turns itself off and its queued deliveries are skipped.
CREATE OR REPLACE FUNCTION public.webhook_result(p_id uuid, p_ok boolean, p_status int, p_error text, p_ms int, p_config jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  d record;
  e record;
  cfg jsonb;
  fails int;
  wait_ms numeric;
  off boolean;
  last_try boolean;
BEGIN
  SELECT * INTO d FROM public.webhook_deliveries WHERE id = p_id AND status = 'sending' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_sending'); END IF;
  SELECT * INTO e FROM public.webhook_endpoints WHERE id = d.endpoint_id FOR UPDATE;
  cfg := coalesce(p_config, '{}'::jsonb) || e.tuning;
  IF p_ok THEN
    UPDATE public.webhook_deliveries SET status = 'delivered', delivered_at = now(), lease_until = NULL, last_status = p_status,
      last_error = NULL, last_ms = p_ms, updated_at = now() WHERE id = p_id;
    UPDATE public.webhook_endpoints SET consecutive_failures = 0, last_success_at = now(), last_status = p_status, updated_at = now() WHERE id = e.id;
    RETURN jsonb_build_object('status', 'delivered');
  END IF;
  fails := e.consecutive_failures + 1;
  off := fails >= (cfg->>'disable_after')::int;
  last_try := off OR d.attempts >= (cfg->>'max_attempts')::int;
  wait_ms := least((cfg->>'backoff_base_ms')::numeric * power(2, greatest(d.attempts - 1, 0)), (cfg->>'backoff_max_ms')::numeric);
  UPDATE public.webhook_deliveries SET
    status = CASE WHEN last_try THEN 'failed' ELSE 'retry' END,
    next_attempt_at = CASE WHEN last_try THEN NULL ELSE now() + make_interval(secs => wait_ms / 1000) END,
    lease_until = NULL, last_status = p_status, last_error = left(p_error, 300), last_ms = p_ms, updated_at = now()
  WHERE id = p_id;
  UPDATE public.webhook_endpoints SET consecutive_failures = fails, last_failure_at = now(), last_status = p_status,
    enabled = enabled AND NOT off,
    disabled_reason = CASE WHEN off THEN 'failures' ELSE disabled_reason END,
    disabled_at = CASE WHEN off THEN now() ELSE disabled_at END, updated_at = now()
  WHERE id = e.id;
  IF off THEN
    UPDATE public.webhook_deliveries SET status = 'skipped', updated_at = now() WHERE endpoint_id = e.id AND status IN ('pending', 'retry');
  END IF;
  RETURN jsonb_build_object('status', CASE WHEN off THEN 'disabled' WHEN last_try THEN 'failed' ELSE 'retry' END,
    'retry_in_ms', CASE WHEN last_try THEN NULL ELSE wait_ms END);
END $$;

-- When the next delivery is due (epoch ms), for the sender's alarm; null when nothing waits.
CREATE OR REPLACE FUNCTION public.webhook_next() RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT floor(extract(epoch FROM min(CASE WHEN d.status = 'pending' THEN d.send_after WHEN d.status = 'retry' THEN d.next_attempt_at ELSE d.lease_until END)) * 1000)::bigint
  FROM public.webhook_deliveries d JOIN public.webhook_endpoints e ON e.id = d.endpoint_id
  WHERE e.enabled AND d.status IN ('pending', 'retry', 'sending')
$$;

-- Finished rows older than p_days go, except the newest row of each endpoint+page (it holds the state the receiver knows).
CREATE OR REPLACE FUNCTION public.webhook_prune(p_days int) RETURNS int LANGUAGE plpgsql AS $$
DECLARE removed int;
BEGIN
  DELETE FROM public.webhook_deliveries d
  WHERE d.status IN ('delivered', 'failed', 'skipped') AND d.updated_at < now() - make_interval(days => p_days)
    AND (d.page_slug = '' OR EXISTS (SELECT 1 FROM public.webhook_deliveries newer
      WHERE newer.endpoint_id = d.endpoint_id AND newer.page_slug = d.page_slug AND newer.last_change_at > d.last_change_at));
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END $$;

REVOKE ALL ON FUNCTION public.webhook_events(jsonb, jsonb, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.webhook_rank(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.webhook_public(public.webhook_endpoints) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.webhook_create(text, uuid, text, text, text[], text, text, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.webhook_list(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.webhook_update(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.webhook_delete(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.webhook_target(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.webhook_log(text, uuid, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.webhook_record(text, uuid, text, boolean, int, text, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.webhook_enqueue(text, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.webhook_claim(int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.webhook_result(uuid, boolean, int, text, int, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.webhook_next() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.webhook_prune(int) FROM PUBLIC, anon, authenticated;
