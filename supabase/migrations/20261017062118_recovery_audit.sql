SET LOCAL search_path TO nexora,pg_catalog;
ALTER TABLE password_recovery ADD COLUMN issuer_id TEXT;
ALTER TABLE password_recovery ADD CONSTRAINT recovery_issuer_fk FOREIGN KEY(issuer_id,org_id) REFERENCES users(id,org_id);
INSERT INTO schema_migrations(version,applied_at) VALUES(13,now());
