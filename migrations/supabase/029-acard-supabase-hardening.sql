-- acard-supabase-hardening: the anon / authenticated keys lose the table rights the Worker never uses them for, and the
-- account objects that were only made in the Supabase dashboard are written down here.
-- Audit 2026-10-22 (dalgom_bami RLS/trigger checklist): every table had RLS on and no row came back to the anon key or
-- to another account, but RLS was the only wall: Supabase's default privileges had granted anon and authenticated ALL
-- (incl. TRUNCATE) on the service-only tables of 008/009/014 and their id sequences, and keep doing so for every new
-- table, sequence and function in public. Only the Worker (service role) touches those tables; a browser or a user token
-- reaches public.profiles and public.handle_status() only (gate/account.ts).
-- Nothing is deleted or rewritten: grants, default privileges and one RLS switch only. Guarded with to_regclass so the
-- same file runs on the auth project, the data project and a self-hosted copy. Rollback: migrations/supabase/rollback/029-acard-supabase-hardening.down.sql

-- 1. Service-only tables and sequences: the service role keeps its rights, anon and authenticated lose all of theirs.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['admin_audit', 'ai_features', 'ai_limits', 'ai_models', 'ai_usage', 'beta_access', 'beta_codes', 'beta_events',
    'beta_feedback', 'beta_waitlist', 'tester_groups', 'tester_pending', 'user_roles', 'subscriptions', 'publications', 'publication_reports',
    'billing_events'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t); END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['admin_audit_id_seq', 'ai_usage_id_seq', 'beta_feedback_id_seq', 'beta_waitlist_id_seq', 'publication_reports_id_seq'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM anon, authenticated', t); END IF;
  END LOOP;
END $$;

-- 2. New tables and sequences that this role (postgres, the migration runner) creates in public no longer start out
-- granted to anon / authenticated; a migration that wants a client to reach one grants it explicitly. Functions still get
-- PUBLIC EXECUTE from Postgres itself, so each new SECURITY DEFINER function revokes it (scripts/qa/supabase-policy-check.ts).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- 3. public.profiles (dashboard-made, written down here). Only on the account project, the one that holds auth users
--    and the 008 tables; the data project gets nothing from this part. A signed-in user reads and writes only the own
--    row (policies), and may write only the columns the app sends: id once at insert, never created_at / updated_at.
-- security: profiles_touch only stamps updated_at on the same row (no other table, no business rule), the kind of small
--    DB-only job a trigger is for; it already runs in production and is created only where it is missing.
-- security: handle_status(h) is SECURITY DEFINER because the caller may only see the own profile row; it returns one word
--    (invalid / reserved / taken / ok), never a row, and only signed-in users may call it (gate/account.ts sends the
--    user's own token). Not open to anon.
DO $acct$
BEGIN
  IF to_regclass('public.profiles') IS NULL AND to_regclass('public.beta_access') IS NULL THEN
    RETURN;
  END IF;
  IF to_regprocedure('public.is_reserved_handle(text)') IS NULL THEN
    EXECUTE $f$
      CREATE FUNCTION public.is_reserved_handle(h text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $q$
        select lower(h) = any (array[
          'www', 'app', 'api', 'admin', 'mail', 'hello', 'notes', 'blog', 'docs', 'help', 'support', 'status',
          'auth', 'login', 'signup', 'logout', 'account', 'accounts', 'settings', 'onboarding', 'billing', 'pay',
          'cloud', 'cdn', 'static', 'assets', 'media', 'files', 'img', 'images', 'dev', 'staging', 'test', 'beta',
          'smtp', 'imap', 'pop', 'mx', 'ns', 'ns1', 'ns2', 'dns', 'ftp', 'webmail', 'email', 'postmaster', 'abuse',
          'security', 'root', 'system', 'acard', 'team', 'about', 'privacy', 'terms', 'legal', 'news', 'press',
          'jobs', 'careers', 'store', 'shop', 'git', 'github', 'download', 'downloads', 'feedback', 'community',
          'forum', 'official', 'null', 'undefined', 'me', 'my', 'you', 'user', 'users', 'public', 'private', 'new'
        ]);
      $q$$f$;
  END IF;
  EXECUTE $f$
    CREATE TABLE IF NOT EXISTS public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      display_name text NOT NULL CONSTRAINT profiles_display_name_check CHECK (char_length(btrim(display_name)) >= 1 AND char_length(btrim(display_name)) <= 40),
      avatar_url text CONSTRAINT profiles_avatar_url_check CHECK (avatar_url IS NULL OR (avatar_url ~ '^https://' AND char_length(avatar_url) <= 1000)),
      handle text NOT NULL CONSTRAINT profiles_handle_format CHECK (handle ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' AND handle !~ '--')
        CONSTRAINT profiles_handle_not_reserved CHECK (NOT public.is_reserved_handle(handle)),
      use_case text CONSTRAINT profiles_use_case_check CHECK (use_case = ANY (ARRAY['notes', 'blog', 'team', 'ai_log'])),
      onboarded_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      lang text CONSTRAINT profiles_lang_check CHECK (lang IS NULL OR lang IN ('en', 'ko', 'zh')),
      home_layout jsonb
    )$f$;
  CREATE UNIQUE INDEX IF NOT EXISTS profiles_handle_lower_key ON public.profiles (lower(handle));
  ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_select_own') THEN
    CREATE POLICY profiles_select_own ON public.profiles FOR SELECT TO authenticated USING ((SELECT auth.uid()) = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_insert_own') THEN
    CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_update_own') THEN
    CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = id) WITH CHECK ((SELECT auth.uid()) = id);
  END IF;
  REVOKE ALL ON TABLE public.profiles FROM anon, authenticated;
  GRANT SELECT ON TABLE public.profiles TO authenticated;
  GRANT INSERT (id, display_name, avatar_url, handle, use_case, onboarded_at, lang, home_layout) ON TABLE public.profiles TO authenticated;
  GRANT UPDATE (display_name, avatar_url, handle, use_case, onboarded_at, lang, home_layout) ON TABLE public.profiles TO authenticated;

  IF to_regprocedure('public.profiles_touch()') IS NULL THEN
    EXECUTE $f$
      CREATE FUNCTION public.profiles_touch() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $q$
      begin
        new.updated_at := now();
        return new;
      end;
      $q$$f$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'profiles_touch') THEN
    EXECUTE 'CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.profiles_touch()';
  END IF;

  IF to_regprocedure('public.handle_status(text)') IS NULL THEN
    EXECUTE $f$
      CREATE FUNCTION public.handle_status(h text) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $q$
      declare
        v text := lower(btrim(coalesce(h, '')));
      begin
        if v !~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' or v ~ '--' then
          return 'invalid';
        end if;
        if public.is_reserved_handle(v) then
          return 'reserved';
        end if;
        if exists (select 1 from public.profiles p where lower(p.handle) = v and p.id is distinct from auth.uid()) then
          return 'taken';
        end if;
        return 'ok';
      end;
      $q$$f$;
  END IF;
  REVOKE ALL ON FUNCTION public.handle_status(text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.handle_status(text) TO authenticated, service_role;
END $acct$;

-- 4. acard.pages_ord_backup_006 (006, CREATE TABLE AS) was the one table with RLS off. Not exposed through the API
--    (acard is not in PostgREST's schemas), kept for its rows; RLS on with no policy leaves it to the owner.
DO $$
BEGIN
  IF to_regclass('acard.pages_ord_backup_006') IS NOT NULL THEN ALTER TABLE acard.pages_ord_backup_006 ENABLE ROW LEVEL SECURITY; END IF;
END $$;
