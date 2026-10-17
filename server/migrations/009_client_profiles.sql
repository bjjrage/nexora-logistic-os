CREATE TABLE client_profiles (
 org_id TEXT NOT NULL, client_id TEXT NOT NULL,
 legal_name TEXT NOT NULL DEFAULT '' CHECK(length(legal_name)<=500),
 tax_id TEXT NOT NULL DEFAULT '' CHECK(length(tax_id)<=80),
 contact_name TEXT NOT NULL DEFAULT '' CHECK(length(contact_name)<=200),
 phone TEXT NOT NULL DEFAULT '' CHECK(length(phone)<=80),
 email TEXT NOT NULL DEFAULT '' CHECK(length(email)<=254),
 address TEXT NOT NULL DEFAULT '' CHECK(length(address)<=500),
 city TEXT NOT NULL DEFAULT '' CHECK(length(city)<=160),
 notes TEXT NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(org_id,client_id),
 FOREIGN KEY(client_id,org_id) REFERENCES clients(id,org_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX client_profiles_tax_id_unique ON client_profiles(org_id,tax_id) WHERE tax_id<>'';
