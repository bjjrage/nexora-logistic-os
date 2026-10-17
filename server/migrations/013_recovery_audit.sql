ALTER TABLE password_recovery ADD COLUMN issuer_id TEXT REFERENCES users(id);
