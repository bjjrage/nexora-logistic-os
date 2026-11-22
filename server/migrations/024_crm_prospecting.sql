CREATE TABLE crm_prospects (
  org_id TEXT NOT NULL REFERENCES organizations(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  sector TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  campaign TEXT NOT NULL DEFAULT '',
  facebook TEXT NOT NULL DEFAULT '',
  instagram TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  search_text TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'IDENTIFIED' CHECK (stage IN ('IDENTIFIED','VALIDATED','CONTACTED','CONVERSING','QUALIFIED','PROPOSAL','PILOT','ACTIVATED','DISCARDED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (owner_id, org_id) REFERENCES users(id, org_id)
);

CREATE TABLE crm_identifiers (
  org_id TEXT NOT NULL,
  prospect_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('facebook','instagram','website','phone','email','business')),
  value TEXT NOT NULL,
  PRIMARY KEY (org_id, kind, value),
  FOREIGN KEY (org_id, prospect_id) REFERENCES crm_prospects(org_id, id)
);

CREATE TABLE crm_contacts (
  org_id TEXT NOT NULL,
  prospect_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  job_title TEXT NOT NULL DEFAULT '',
  phone TEXT,
  email TEXT,
  facebook TEXT NOT NULL DEFAULT '',
  instagram TEXT NOT NULL DEFAULT '',
  preferred_channel TEXT NOT NULL CHECK (preferred_channel IN ('','PHONE','EMAIL','FACEBOOK','INSTAGRAM')),
  no_contact INTEGER NOT NULL DEFAULT 0 CHECK (no_contact IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (org_id, prospect_id, id),
  UNIQUE (org_id, prospect_id, phone),
  UNIQUE (org_id, prospect_id, email),
  FOREIGN KEY (org_id, prospect_id) REFERENCES crm_prospects(org_id, id)
);

CREATE TABLE crm_transitions (
  org_id TEXT NOT NULL,
  prospect_id TEXT NOT NULL,
  id TEXT NOT NULL,
  from_stage TEXT CHECK (from_stage IN ('IDENTIFIED','VALIDATED','CONTACTED','CONVERSING','QUALIFIED','PROPOSAL','PILOT','ACTIVATED','DISCARDED')),
  to_stage TEXT NOT NULL CHECK (to_stage IN ('IDENTIFIED','VALIDATED','CONTACTED','CONVERSING','QUALIFIED','PROPOSAL','PILOT','ACTIVATED','DISCARDED')),
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  PRIMARY KEY (org_id, prospect_id, id),
  FOREIGN KEY (org_id, prospect_id) REFERENCES crm_prospects(org_id, id),
  FOREIGN KEY (actor_id, org_id) REFERENCES users(id, org_id)
);

CREATE TABLE crm_tasks (
  org_id TEXT NOT NULL,
  prospect_id TEXT NOT NULL,
  id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  due_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (org_id, prospect_id, id),
  FOREIGN KEY (org_id, prospect_id) REFERENCES crm_prospects(org_id, id),
  FOREIGN KEY (owner_id, org_id) REFERENCES users(id, org_id)
);

CREATE TABLE crm_activities (
  org_id TEXT NOT NULL,
  prospect_id TEXT NOT NULL,
  id TEXT NOT NULL,
  contact_id TEXT,
  task_id TEXT,
  actor_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('CALL','MEETING','MESSAGE','NOTE','TASK_CREATED','TASK_COMPLETED')),
  detail TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  PRIMARY KEY (org_id, prospect_id, id),
  FOREIGN KEY (org_id, prospect_id) REFERENCES crm_prospects(org_id, id),
  FOREIGN KEY (org_id, prospect_id, contact_id) REFERENCES crm_contacts(org_id, prospect_id, id),
  FOREIGN KEY (org_id, prospect_id, task_id) REFERENCES crm_tasks(org_id, prospect_id, id),
  FOREIGN KEY (actor_id, org_id) REFERENCES users(id, org_id)
);

CREATE INDEX crm_prospects_recency ON crm_prospects(org_id, updated_at DESC, id);
CREATE INDEX crm_prospects_stage ON crm_prospects(org_id, stage, updated_at DESC, id);
CREATE INDEX crm_prospects_owner ON crm_prospects(org_id, owner_id, updated_at DESC, id);
CREATE INDEX crm_prospects_campaign ON crm_prospects(org_id, campaign, updated_at DESC, id);
CREATE INDEX crm_prospects_source ON crm_prospects(org_id, source, updated_at DESC, id);
CREATE INDEX crm_identifiers_prospect ON crm_identifiers(org_id, prospect_id);
CREATE INDEX crm_transitions_timeline ON crm_transitions(org_id, prospect_id, occurred_at DESC, id);
CREATE INDEX crm_activities_timeline ON crm_activities(org_id, prospect_id, occurred_at DESC, id);
CREATE INDEX crm_tasks_pending ON crm_tasks(org_id, due_at, prospect_id, id) WHERE completed_at IS NULL;
CREATE UNIQUE INDEX crm_tasks_org_id ON crm_tasks(org_id, id);
CREATE INDEX crm_tasks_owner_pending ON crm_tasks(org_id, owner_id, due_at, prospect_id, id) WHERE completed_at IS NULL;

CREATE TRIGGER crm_transitions_prevent_update BEFORE UPDATE ON crm_transitions
BEGIN
  SELECT RAISE(ABORT, 'El historial del CRM es inmutable.');
END;

CREATE TRIGGER crm_transitions_prevent_delete BEFORE DELETE ON crm_transitions
BEGIN
  SELECT RAISE(ABORT, 'El historial del CRM es inmutable.');
END;

CREATE TRIGGER crm_activities_prevent_update BEFORE UPDATE ON crm_activities
BEGIN
  SELECT RAISE(ABORT, 'El historial del CRM es inmutable.');
END;

CREATE TRIGGER crm_activities_prevent_delete BEFORE DELETE ON crm_activities
BEGIN
  SELECT RAISE(ABORT, 'El historial del CRM es inmutable.');
END;
