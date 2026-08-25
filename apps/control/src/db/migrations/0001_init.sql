-- yoroi-control initial schema. Hand-written to match src/db/schema.ts
-- (see that file's comments for which tables are design.md-verbatim vs. MVP
-- additions). Applied by src/db/migrate.ts, tracked in applied_migration.

CREATE TABLE IF NOT EXISTS repository (
  repo_id                text PRIMARY KEY,
  installation_id        bigint NOT NULL,
  name                    text NOT NULL,
  mode                    text NOT NULL,
  status                  text NOT NULL,
  target_branch           text NOT NULL DEFAULT 'main',
  policy_version          text NOT NULL DEFAULT '',
  ruleset_consistent      boolean NOT NULL DEFAULT true,
  installation_ok         boolean NOT NULL DEFAULT true,
  last_webhook_at         timestamptz,
  last_reconcile_at       timestamptz,
  open_prs                integer NOT NULL DEFAULT 0,
  gate_pass_rate_pct      integer NOT NULL DEFAULT 0,
  ci_success_rate_pct     integer NOT NULL DEFAULT 0,
  p50_lead_time_minutes   integer NOT NULL DEFAULT 0,
  flaky_rate_pct          integer NOT NULL DEFAULT 0,
  rebuild_rate_pct        integer NOT NULL DEFAULT 0,
  batch_split_rate_pct    integer NOT NULL DEFAULT 0,
  auto_revert_rate_pct    integer NOT NULL DEFAULT 0,
  metrics                 jsonb NOT NULL,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pull_request_revision (
  repo_id                 text NOT NULL,
  pr_number                integer NOT NULL,
  title                     text NOT NULL DEFAULT '',
  head_sha                  text NOT NULL,
  base_sha                   text NOT NULL,
  is_draft                    boolean NOT NULL DEFAULT false,
  author_stable_id             text NOT NULL,
  state                         text NOT NULL,
  state_version                 integer NOT NULL DEFAULT 0,
  next_action                   text NOT NULL DEFAULT '',
  revoked_scopes                text[],
  revoked_scopes_reason          text,
  updated_at                     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repo_id, pr_number)
);
CREATE INDEX IF NOT EXISTS idx_pr_revision_author ON pull_request_revision (author_stable_id);

CREATE TABLE IF NOT EXISTS approval (
  id             bigserial PRIMARY KEY,
  repo_id        text NOT NULL,
  pr_number      integer NOT NULL,
  scope_id       text NOT NULL,
  actor_stable_id text NOT NULL,
  role            text NOT NULL,
  maintained       boolean NOT NULL DEFAULT true,
  approved_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at         timestamptz,
  revoke_reason       text
);
CREATE INDEX IF NOT EXISTS idx_approval_pr ON approval (repo_id, pr_number);

CREATE TABLE IF NOT EXISTS pr_scope_requirement (
  id             bigserial PRIMARY KEY,
  repo_id        text NOT NULL,
  pr_number      integer NOT NULL,
  scope_id       text NOT NULL,
  required_role  text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scope_requirement_pr ON pr_scope_requirement (repo_id, pr_number);

CREATE TABLE IF NOT EXISTS queue_entry (
  id                      bigserial PRIMARY KEY,
  repo_id                 text NOT NULL,
  pr_number               integer NOT NULL,
  lane                    text NOT NULL DEFAULT 'default',
  risk                    text NOT NULL DEFAULT 'medium',
  priority                integer NOT NULL DEFAULT 0,
  enqueued_at             timestamptz NOT NULL DEFAULT now(),
  candidate_sha           text NOT NULL DEFAULT '—',
  running_checks          text[],
  rebuild_count           integer NOT NULL DEFAULT 0,
  rebuild_notice_cause_pr integer,
  eta_from                timestamptz,
  eta_to                  timestamptz,
  eta_confidence          text,
  state                   text NOT NULL DEFAULT 'waiting'
);
CREATE INDEX IF NOT EXISTS idx_queue_order ON queue_entry (priority, enqueued_at);

CREATE TABLE IF NOT EXISTS pr_decision_snapshot (
  repo_id           text NOT NULL,
  pr_number         integer NOT NULL,
  conclusion        jsonb NOT NULL,
  gates             jsonb NOT NULL,
  checks            jsonb NOT NULL,
  reason_graph      jsonb NOT NULL,
  all_gates_passed  boolean NOT NULL DEFAULT false,
  has_ci_failure    boolean NOT NULL DEFAULT false,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repo_id, pr_number)
);

CREATE TABLE IF NOT EXISTS pr_reviewer_assignment (
  id                       bigserial PRIMARY KEY,
  repo_id                  text NOT NULL,
  pr_number                integer NOT NULL,
  scope_id                 text NOT NULL,
  actor_stable_id          text NOT NULL,
  reason                   text NOT NULL DEFAULT '',
  sensitive                boolean NOT NULL DEFAULT false,
  estimated_review_minutes integer NOT NULL DEFAULT 0,
  waiting_since            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reviewer_assignment_actor ON pr_reviewer_assignment (actor_stable_id);

CREATE TABLE IF NOT EXISTS blocked_entry (
  id             bigserial PRIMARY KEY,
  repo_id        text NOT NULL,
  pr_number      integer NOT NULL,
  responsibility text NOT NULL,
  reason         text NOT NULL,
  next_actor     text NOT NULL,
  eta_from       timestamptz,
  eta_to         timestamptz,
  eta_confidence text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_blocked_responsibility ON blocked_entry (responsibility);

CREATE TABLE IF NOT EXISTS feedback_case (
  id              bigserial PRIMARY KEY,
  repo_id         text NOT NULL,
  pr_number       integer,
  category        text NOT NULL,
  actor_stable_id text NOT NULL,
  description     text NOT NULL DEFAULT '',
  disposition     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);

CREATE TABLE IF NOT EXISTS decision_event (
  seq             bigserial PRIMARY KEY,
  repo_id         text NOT NULL,
  pr_number       integer,
  actor_stable_id text,
  operation       text NOT NULL,
  from_state      text,
  to_state        text,
  reason_code     text NOT NULL DEFAULT '',
  result          text NOT NULL DEFAULT '',
  evidence        jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decision_event_occurred ON decision_event (occurred_at);

CREATE TABLE IF NOT EXISTS fleet_health_snapshot (
  installation_id bigint NOT NULL,
  component       text NOT NULL,
  status          text NOT NULL CHECK (status IN ('green','amber','red')),
  metric          jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason          text,
  observed_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, component)
);
