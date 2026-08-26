-- design.md §6.7 / AT-19: hash-chain columns backing tamper detection on
-- decision_event. Nullable at the column level for existing rows written
-- before this migration; every new row is expected to populate both via
-- packages/postgres's appendDecisionEvent (src/decision-log.ts), never a
-- raw INSERT.

ALTER TABLE decision_event ADD COLUMN IF NOT EXISTS prev_hash text;
ALTER TABLE decision_event ADD COLUMN IF NOT EXISTS row_hash text;
