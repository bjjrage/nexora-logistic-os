-- GPS infrastructure prerequisite. Provision its password privately; never in a migration or repository.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='nexora_tracking_worker') THEN
  CREATE ROLE nexora_tracking_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 END IF;
END $$;
