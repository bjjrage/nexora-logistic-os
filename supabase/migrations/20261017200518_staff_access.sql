SET search_path TO nexora, pg_catalog;
ALTER TABLE users ADD COLUMN enabled SMALLINT NOT NULL DEFAULT 1 CHECK(enabled IN(0,1));
INSERT INTO schema_migrations(version,applied_at) VALUES(14,now());
