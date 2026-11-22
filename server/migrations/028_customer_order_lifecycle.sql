ALTER TABLE customer_order_requests ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0);
ALTER TABLE customer_order_requests ADD COLUMN cancelled_at TEXT CHECK(cancelled_at IS NULL OR status='PENDING');

CREATE TABLE customer_order_request_changes (
  org_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('EDIT','CANCEL')),
  state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','ACKNOWLEDGED','REJECTED')),
  reason TEXT NOT NULL,
  proposed_json TEXT,
  requested_at TEXT NOT NULL,
  reviewed_at TEXT,
  review_reason TEXT,
  PRIMARY KEY(org_id,request_id,id),
  FOREIGN KEY(org_id,request_id) REFERENCES customer_order_requests(org_id,id),
  CHECK((kind='EDIT')=(proposed_json IS NOT NULL))
);
CREATE UNIQUE INDEX minios_one_open_change ON customer_order_request_changes(org_id,request_id) WHERE state='PENDING';
CREATE INDEX minios_changes_queue ON customer_order_request_changes(org_id,state,requested_at);

CREATE TABLE customer_order_request_events (
  org_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('SUBMITTED','EDITED','CANCELLED','ACCEPTED','REJECTED','CHANGE_REQUESTED','CHANGE_REVIEWED')),
  version INTEGER NOT NULL CHECK(version > 0),
  body_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  PRIMARY KEY(org_id,command_id),
  FOREIGN KEY(org_id,request_id) REFERENCES customer_order_requests(org_id,id)
);
CREATE INDEX minios_events_request ON customer_order_request_events(org_id,request_id,version DESC);
CREATE TRIGGER minios_events_no_update BEFORE UPDATE ON customer_order_request_events BEGIN SELECT RAISE(ABORT,'Mini OS history is immutable'); END;
CREATE TRIGGER minios_events_no_delete BEFORE DELETE ON customer_order_request_events BEGIN SELECT RAISE(ABORT,'Mini OS history is immutable'); END;
