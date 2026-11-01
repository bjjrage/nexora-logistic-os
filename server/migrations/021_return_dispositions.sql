CREATE TABLE return_dispositions (
 return_id TEXT PRIMARY KEY, org_id TEXT NOT NULL,
 disposition TEXT NOT NULL CHECK(disposition IN ('RESTOCKED','SENT_TO_SENDER')),
 actor_id TEXT NOT NULL, command_id TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(return_id,org_id),
 FOREIGN KEY(return_id,org_id) REFERENCES returns(id,org_id),
 FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
);
CREATE INDEX return_dispositions_org_disposition ON return_dispositions(org_id,disposition);
CREATE TRIGGER return_dispositions_no_update BEFORE UPDATE ON return_dispositions
BEGIN SELECT RAISE(ABORT,'RETURN_DISPOSITION_APPEND_ONLY'); END;
CREATE TRIGGER return_dispositions_no_delete BEFORE DELETE ON return_dispositions
BEGIN SELECT RAISE(ABORT,'RETURN_DISPOSITION_APPEND_ONLY'); END;
