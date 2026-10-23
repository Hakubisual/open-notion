-- Rollback of 032-acard-db-button-savers.sql. Drops only the saver records: with the table gone, the Worker build that
-- reads it fails on a button press, so deploy the previous build (git revert of the #106/#107 commit) before running this.
-- Run by hand in one transaction only if 032 broke something.
DROP POLICY IF EXISTS acard_app_all ON acard.db_button_savers;
DROP TABLE IF EXISTS acard.db_button_savers;
