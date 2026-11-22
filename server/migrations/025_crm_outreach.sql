-- CRM-02: internal outreach preparation only; no outbound transport.
CREATE TABLE crm_outreach_threads (
  org_id TEXT NOT NULL, id TEXT NOT NULL, prospect_id TEXT NOT NULL,
  contact_id TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel IN ('EMAIL','WHATSAPP','FACEBOOK','INSTAGRAM')),
  state TEXT NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','CLOSED')),
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(org_id,id), UNIQUE(org_id,prospect_id,contact_id,channel),
  FOREIGN KEY(org_id,prospect_id) REFERENCES crm_prospects(org_id,id),
  FOREIGN KEY(org_id,prospect_id,contact_id) REFERENCES crm_contacts(org_id,prospect_id,id),
  FOREIGN KEY(created_by,org_id) REFERENCES users(id,org_id)
);
CREATE TABLE crm_outreach_messages (
  org_id TEXT NOT NULL, thread_id TEXT NOT NULL, id TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'OUTBOUND' CHECK(direction='OUTBOUND'),
  state TEXT NOT NULL CHECK(state IN ('DRAFT','PENDING_APPROVAL','APPROVED')),
  body TEXT NOT NULL CHECK(length(body)>0 AND length(body)<=3000),
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, reviewed_by TEXT, reviewed_at TEXT,
  PRIMARY KEY(org_id,id), FOREIGN KEY(org_id,thread_id) REFERENCES crm_outreach_threads(org_id,id),
  FOREIGN KEY(created_by,org_id) REFERENCES users(id,org_id),
  FOREIGN KEY(reviewed_by,org_id) REFERENCES users(id,org_id)
);
CREATE INDEX crm_outreach_threads_recent ON crm_outreach_threads(org_id,updated_at DESC,id);
CREATE INDEX crm_outreach_messages_thread ON crm_outreach_messages(org_id,thread_id,created_at DESC,id);
