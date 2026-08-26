-- Event-sourced engine tables. DDL taken directly from design.md
-- §6.3 (inbox/outbox), §6.4 (branch coordinator), §6.6 (candidate/CI
-- evidence), §6.7 (policy bundle/config drift/flaky test), §14.1/§14.3
-- (notification anchor/coalescing).

-- FR-002, FR-004: idempotency keyとしてdelivery_idを一意化
CREATE TABLE IF NOT EXISTS webhook_inbox (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  installation_id   bigint NOT NULL,
  repository_id     bigint,
  delivery_id       text NOT NULL,
  event_type        text NOT NULL,
  payload_digest    text NOT NULL,
  payload_encrypted text,             -- base64(iv||AES-256-GCM ciphertext); src/encryption.ts
  received_at       timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz,      -- payload_encryptedの短いTTL
  UNIQUE (installation_id, delivery_id)
);
CREATE INDEX IF NOT EXISTS idx_webhook_inbox_repo ON webhook_inbox (repository_id, received_at);

-- FR-003: 応答前にcommitするtransactional outbox。managed Queueがない前提 (DP-16)
CREATE TABLE IF NOT EXISTS work_outbox (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id    text NOT NULL UNIQUE,        -- 副作用の一意鍵 (FR-007)
  installation_id bigint NOT NULL,
  repository_id   bigint,
  kind            text NOT NULL,               -- 'evaluate_policy' | 'update_check_run' | 'notify' ...
  payload         jsonb NOT NULL,
  state           text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','done','dead')),
  priority        smallint NOT NULL DEFAULT 0,
  attempt         integer NOT NULL DEFAULT 0,
  max_attempt     integer NOT NULL DEFAULT 8,
  available_at    timestamptz NOT NULL DEFAULT now(),
  lease_owner     text,
  lease_until     timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outbox_claim ON work_outbox (state, available_at)
  WHERE state IN ('pending','leased');

-- repository_id + target_branch単位で一つだけの直列化権
CREATE TABLE IF NOT EXISTS branch_coordinator (
  installation_id     bigint NOT NULL,
  repository_id       bigint NOT NULL,
  target_branch       text NOT NULL,
  holder_operation_id text,
  lease_until         timestamptz,
  fencing_token       bigint NOT NULL DEFAULT 0,  -- 取得の都度単調増加
  expected_base_sha   text,
  state_version       bigint NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, repository_id, target_branch)
);

CREATE TABLE IF NOT EXISTS merge_candidate (
  candidate_sha        text PRIMARY KEY,
  installation_id      bigint NOT NULL,
  repository_id        bigint NOT NULL,
  pull_request_number  integer NOT NULL,
  base_sha             text NOT NULL,
  ordered_heads        text[] NOT NULL,
  policy_digest        text NOT NULL,
  built_at             timestamptz NOT NULL DEFAULT now(),
  invalidated_at       timestamptz,
  invalidation_reason  text
);

CREATE TABLE IF NOT EXISTS expected_check_plan (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_sha   text NOT NULL REFERENCES merge_candidate(candidate_sha),
  job_name        text NOT NULL,
  reason          text NOT NULL,       -- 選択理由 (FR-041)
  required        boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS check_evidence (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_sha     text NOT NULL REFERENCES merge_candidate(candidate_sha),
  job_name          text NOT NULL,
  workflow_sha      text NOT NULL,
  runner_class      text,
  trusted_runner    boolean NOT NULL DEFAULT true,
  input_digest      text,
  artifact_digest   text,
  conclusion        text NOT NULL,     -- success|failure|cancelled|timed_out
  observed_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_sha, job_name)
);

CREATE TABLE IF NOT EXISTS policy_bundle (
  digest          text PRIMARY KEY,
  installation_id bigint,
  repository_id   bigint,
  version         text NOT NULL,
  raw_yaml        text NOT NULL,
  signer          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 14.1節: PRごとに1つのmutable summary。 last_reason_hashが同じなら更新をスキップ (NFR-021)
CREATE TABLE IF NOT EXISTS notification_anchor (
  installation_id      bigint NOT NULL,
  repository_id        bigint NOT NULL,
  pull_request_number  integer NOT NULL,
  summary_comment_id   bigint,
  check_run_id         bigint,
  last_reason_hash     text,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, repository_id, pull_request_number)
);

-- 14.3節: 同一root_cause_fingerprintをcoalesce_keyとしてまとめる
CREATE TABLE IF NOT EXISTS notification (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  decision_id     text NOT NULL,
  audience        text NOT NULL,       -- pull_request_number等
  reason_code     text NOT NULL,
  coalesce_key    text NOT NULL,
  category        text NOT NULL,       -- blocker | action_required | informational (FR-101)
  dispatched_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notification_coalesce ON notification (coalesce_key, dispatched_at);

CREATE TABLE IF NOT EXISTS config_snapshot (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resource_id    text NOT NULL,
  desired_digest text,
  actual_digest  text,
  drifted        boolean NOT NULL DEFAULT false,
  observed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS flaky_test (
  test_fingerprint  text PRIMARY KEY,
  repository_id     bigint NOT NULL,
  owner_team        text,
  failure_count     integer NOT NULL DEFAULT 0,
  reproduction_rate integer,
  quarantine_until  timestamptz,
  status            text NOT NULL DEFAULT 'observed'
);
