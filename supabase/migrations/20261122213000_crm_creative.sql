SET LOCAL search_path TO nexora, pg_catalog;
-- CRM-03 preproduction briefs and storyboards; no paid generation.
CREATE TABLE crm_creative_briefs (
 org_id TEXT NOT NULL, id TEXT NOT NULL,
 campaign TEXT NOT NULL DEFAULT '', objective TEXT NOT NULL DEFAULT '',
 audience TEXT NOT NULL DEFAULT '', idea TEXT NOT NULL,
 duration_seconds INTEGER NOT NULL CHECK(duration_seconds BETWEEN 15 AND 30),
 aspect_ratio TEXT NOT NULL CHECK(aspect_ratio IN ('9:16','1:1','16:9')),
 style TEXT NOT NULL DEFAULT 'ORIGINAL_3D_CARTOON',
 state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','PLANNED','APPROVED')),
 plan_json TEXT NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 author_id TEXT NOT NULL, reviewed_by TEXT, reviewed_at TEXT,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 PRIMARY KEY(org_id,id),
 FOREIGN KEY(author_id,org_id) REFERENCES users(id,org_id),
 FOREIGN KEY(reviewed_by,org_id) REFERENCES users(id,org_id)
);
CREATE INDEX crm_creative_recency ON crm_creative_briefs(org_id,updated_at DESC,id);
CREATE INDEX crm_creative_campaign ON crm_creative_briefs(org_id,campaign,created_at DESC,id);

REVOKE ALL ON crm_creative_briefs FROM PUBLIC,anon,authenticated,service_role,nexora_tracking_worker,nexora_runtime;
ALTER TABLE crm_creative_briefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_organization ON crm_creative_briefs TO nexora_runtime
 USING (org_id=current_setting('nexora.crm_org_id',true))
 WITH CHECK (org_id=current_setting('nexora.crm_org_id',true));
GRANT SELECT,INSERT,UPDATE ON crm_creative_briefs TO nexora_runtime;
