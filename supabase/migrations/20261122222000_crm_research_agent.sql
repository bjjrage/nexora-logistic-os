SET LOCAL search_path TO nexora, pg_catalog;
CREATE TABLE crm_research_sources (
  org_id TEXT NOT NULL,
  prospect_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  source_ref TEXT NOT NULL,
  authorization_basis TEXT NOT NULL,
  csv_sha256 TEXT NOT NULL,
  captured_by TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  PRIMARY KEY(org_id,prospect_id,batch_id),
  FOREIGN KEY(org_id,prospect_id) REFERENCES crm_prospects(org_id,id),
  FOREIGN KEY(captured_by,org_id) REFERENCES users(id,org_id)
);
CREATE INDEX crm_research_sources_batch ON crm_research_sources(org_id,batch_id);

CREATE TABLE crm_agent_runs (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('PENDING','READY','FAILED')),
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  result_json TEXT,
  PRIMARY KEY(org_id,id),
  FOREIGN KEY(org_id,thread_id) REFERENCES crm_outreach_threads(org_id,id),
  FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
);
CREATE INDEX crm_agent_runs_budget ON crm_agent_runs(org_id,started_at);
CREATE INDEX crm_agent_runs_thread ON crm_agent_runs(org_id,thread_id,started_at DESC,id);

REVOKE ALL ON crm_research_sources,crm_agent_runs FROM PUBLIC,anon,authenticated,service_role,nexora_tracking_worker,nexora_runtime;
ALTER TABLE crm_research_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_agent_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_organization ON crm_research_sources TO nexora_runtime
 USING (org_id=current_setting('nexora.crm_org_id',true)) WITH CHECK (org_id=current_setting('nexora.crm_org_id',true));
CREATE POLICY crm_organization ON crm_agent_runs TO nexora_runtime
 USING (org_id=current_setting('nexora.crm_org_id',true)) WITH CHECK (org_id=current_setting('nexora.crm_org_id',true));
GRANT SELECT,INSERT ON crm_research_sources TO nexora_runtime;
GRANT SELECT,INSERT,UPDATE ON crm_agent_runs TO nexora_runtime;
