SET search_path TO nexora, pg_catalog;

CREATE TABLE return_dispositions (
 return_id TEXT PRIMARY KEY, org_id TEXT NOT NULL,
 disposition TEXT NOT NULL CHECK(disposition IN ('RESTOCKED','SENT_TO_SENDER')),
 actor_id TEXT NOT NULL, command_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL,
 UNIQUE(return_id,org_id),
 FOREIGN KEY(return_id,org_id) REFERENCES returns(id,org_id),
 FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
);
CREATE INDEX return_dispositions_org_disposition ON return_dispositions(org_id,disposition);
CREATE FUNCTION reject_return_dispositions_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 RAISE EXCEPTION 'RETURN_DISPOSITION_APPEND_ONLY' USING ERRCODE='55000';
END;
$$;
CREATE TRIGGER return_dispositions_append_only
 BEFORE UPDATE OR DELETE ON return_dispositions
 FOR EACH ROW EXECUTE FUNCTION reject_return_dispositions_mutation();
CREATE TRIGGER return_dispositions_no_truncate
 BEFORE TRUNCATE ON return_dispositions
 FOR EACH STATEMENT EXECUTE FUNCTION reject_return_dispositions_mutation();
ALTER TABLE return_dispositions ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_select ON return_dispositions FOR SELECT TO nexora_runtime USING (true);
CREATE POLICY runtime_insert ON return_dispositions FOR INSERT TO nexora_runtime WITH CHECK (true);
REVOKE ALL ON return_dispositions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON return_dispositions TO nexora_runtime;
INSERT INTO schema_migrations(version,applied_at) VALUES(21,now());
