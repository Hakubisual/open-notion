-- acard-home-setup: the signed-in user's home widgets, e.g. {"widgets":["board","progress","blog","notes"]}.
-- NULL means the default home (existing users get a dismissible preset card). Reuses the profiles RLS policies.
-- Down: ALTER TABLE public.profiles DROP COLUMN IF EXISTS home_layout;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS home_layout jsonb;
