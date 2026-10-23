-- #116: the theme a shared or published page opens in, set by the page owner in the share dialog.
-- NULL = the viewer's system setting (unchanged behaviour); 'light' or 'dark' fixes it. The Worker validates the value.
-- Additive and idempotent; no policy, grant, function or trigger changes (share_pages keeps its 001/003 RLS and policy).
-- Down: ALTER TABLE acard.share_pages DROP COLUMN theme;
SET search_path = acard;
ALTER TABLE share_pages ADD COLUMN IF NOT EXISTS theme TEXT;
