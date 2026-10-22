-- acard-storage-cost 4: the ETag of each media original, written at upload (or on its first full read), so a repeat
-- view answers 304 from this row without reading R2. Additive and idempotent.
-- Down: ALTER TABLE acard.media DROP COLUMN etag;
SET search_path = acard;
ALTER TABLE media ADD COLUMN IF NOT EXISTS etag TEXT;
