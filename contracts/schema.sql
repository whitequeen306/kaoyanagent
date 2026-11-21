-- Qoder Sites restricted DDL only: CREATE TABLE, ALTER TABLE ADD COLUMN, CREATE INDEX.
-- All application data lives in the app schema. DML/seed data is not allowed here.

CREATE TABLE app.papers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year integer NOT NULL,
  subject text NOT NULL,
  paper_variant text,
  source_url text,
  page_from integer,
  page_to integer,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id uuid,
  seq_label text NOT NULL,
  section text NOT NULL,
  qtype text NOT NULL,
  stem_latex text NOT NULL,
  sub_items_json jsonb,
  options_json jsonb,
  answer_latex text,
  answer_source text NOT NULL,
  solution_latex text,
  score_x2 integer NOT NULL,
  difficulty text NOT NULL,
  difficulty_obs jsonb,
  difficulty_source text,
  est_minutes integer,
  has_figure boolean NOT NULL DEFAULT false,
  figure_asset_id text,
  source text NOT NULL,
  generator_meta_json jsonb,
  rubric_json jsonb,
  rubric_source text,
  rubric_version integer NOT NULL DEFAULT 1,
  content_hash text NOT NULL,
  status text NOT NULL,
  embedding_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.knowledge_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  level integer NOT NULL,
  syllabus_ref text,
  description text,
  aliases_json jsonb NOT NULL,
  order_idx integer NOT NULL DEFAULT 0
);

CREATE TABLE app.knowledge_edges (
  src_id uuid NOT NULL,
  dst_id uuid NOT NULL,
  rel text NOT NULL,
  weight integer NOT NULL DEFAULT 100,
  PRIMARY KEY (src_id, dst_id, rel)
);

CREATE TABLE app.knowledge_closure (
  ancestor uuid NOT NULL,
  descendant uuid NOT NULL,
  depth integer NOT NULL,
  PRIMARY KEY (ancestor, descendant)
);

CREATE TABLE app.question_knowledge (
  question_id uuid NOT NULL,
  node_id uuid NOT NULL,
  role text NOT NULL,
  weight integer NOT NULL DEFAULT 100,
  PRIMARY KEY (question_id, node_id)
);

CREATE TABLE app.paper_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  mode text NOT NULL,
  source_mode text NOT NULL,
  config_json jsonb NOT NULL,
  items_json jsonb NOT NULL,
  total_score_x2 integer NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz
);

CREATE TABLE app.attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  paper_instance_id uuid NOT NULL,
  question_id uuid NOT NULL,
  answer_raw text,
  answer_normalized_json jsonb,
  recognized_latex text,
  confirmed_latex text,
  score_x2 integer NOT NULL,
  max_score_x2 integer NOT NULL,
  score_rate_bp integer NOT NULL,
  rubric_json jsonb,
  rubric_version integer NOT NULL,
  error_tags_json jsonb,
  duration_sec integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.wrong_book (
  device_id text NOT NULL,
  question_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  attempt_history_json jsonb,
  first_wrong_at timestamptz NOT NULL,
  mastery integer NOT NULL DEFAULT 0,
  next_review_at timestamptz NOT NULL,
  review_count integer NOT NULL DEFAULT 0,
  last_result text,
  PRIMARY KEY (device_id, question_id)
);

CREATE TABLE app.variant_links (
  src_question_id uuid NOT NULL,
  variant_question_id uuid NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (src_question_id, variant_question_id)
);

CREATE TABLE app.question_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL,
  device_id text NOT NULL,
  reason text NOT NULL,
  detail text,
  status text NOT NULL DEFAULT 'open',
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE app.llm_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  model text NOT NULL,
  prompt_hash text NOT NULL,
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL DEFAULT 0,
  ok boolean NOT NULL,
  reject_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL,
  progress integer NOT NULL DEFAULT 0,
  result_json jsonb,
  error text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.metric_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_key text NOT NULL,
  payload_json jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.device_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE app.daily_questions (
  device_id text NOT NULL,
  daily_date date NOT NULL,
  question_id uuid NOT NULL,
  question_snapshot jsonb NOT NULL,
  reason_json jsonb NOT NULL,
  paper_instance_id uuid,
  ai_messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, daily_date)
);

CREATE INDEX questions_paper_idx ON app.questions (paper_id);
CREATE INDEX questions_pool_idx ON app.questions (status, source, qtype, difficulty);
CREATE INDEX question_knowledge_node_idx ON app.question_knowledge (node_id);
CREATE INDEX knowledge_nodes_parent_idx ON app.knowledge_nodes (parent_id);
CREATE INDEX knowledge_closure_ancestor_idx ON app.knowledge_closure (ancestor);
CREATE INDEX paper_instances_device_idx ON app.paper_instances (device_id, created_at);
CREATE INDEX attempts_device_created_idx ON app.attempts (device_id, created_at);
CREATE INDEX attempts_question_idx ON app.attempts (question_id, created_at);
CREATE INDEX wrong_book_review_idx ON app.wrong_book (device_id, next_review_at);
CREATE INDEX reports_status_idx ON app.question_reports (status, created_at);
CREATE INDEX llm_calls_created_idx ON app.llm_calls (created_at);
CREATE INDEX llm_calls_kind_created_idx ON app.llm_calls (kind, created_at);
CREATE INDEX generation_jobs_device_idx ON app.generation_jobs (device_id, status);
CREATE INDEX metric_snapshots_key_idx ON app.metric_snapshots (metric_key, expires_at);
CREATE INDEX device_sessions_device_idx ON app.device_sessions (device_id, expires_at);
