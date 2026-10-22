-- Rollback of 029-acard-supabase-hardening.sql: puts the grants back exactly as the audit found them on 2026-10-22. It does not drop profiles,
-- handle_status, is_reserved_handle or profiles_touch: they existed before 029 and the app needs them.
-- Run by hand in one transaction only if 029 broke something.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['admin_audit', 'ai_features', 'ai_limits', 'ai_models', 'ai_usage', 'beta_access', 'beta_codes', 'beta_events',
    'beta_feedback', 'beta_waitlist', 'tester_groups', 'tester_pending', 'user_roles'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN EXECUTE format('GRANT ALL ON TABLE public.%I TO anon, authenticated', t); END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['admin_audit_id_seq', 'ai_usage_id_seq', 'beta_feedback_id_seq', 'beta_waitlist_id_seq'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN EXECUTE format('GRANT ALL ON SEQUENCE public.%I TO anon, authenticated', t); END IF;
  END LOOP;
  IF to_regclass('public.profiles') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.profiles FROM authenticated;
    GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
  END IF;
  IF to_regclass('acard.pages_ord_backup_006') IS NOT NULL THEN ALTER TABLE acard.pages_ord_backup_006 DISABLE ROW LEVEL SECURITY; END IF;
END $$;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
