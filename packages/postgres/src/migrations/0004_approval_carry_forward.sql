-- design.md §6.5/§7.2: carry-forward display data (AT-04A/04F). See
-- src/schema.ts's approvalCarryForward comment for why this MVP form
-- references approval.id directly rather than a full ReviewIdentity.

CREATE TABLE IF NOT EXISTS approval_carry_forward (
  id                     bigserial PRIMARY KEY,
  original_approval_id   integer NOT NULL,
  repo_id                text NOT NULL,
  pr_number              integer NOT NULL,
  scope_id               text NOT NULL,
  old_base_sha           text NOT NULL,
  old_head_sha           text NOT NULL,
  new_base_sha           text NOT NULL,
  new_head_sha           text NOT NULL,
  context_proof_digest   text NOT NULL,
  proof_algorithm        text NOT NULL,
  carried_forward_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_carry_forward_pr ON approval_carry_forward (repo_id, pr_number);
