-- Identity, owned by Endeleo.
--
-- The web app currently hangs its whole bond registry off Supabase's auth.users table:
-- every money table has `user_id UUID REFERENCES auth.users(id)`. That makes the auth
-- vendor a hard dependency of the registry.
--
-- Here the domain key is our own users.id. Credentials are a separate table, so adding
-- an external identity provider later means inserting a row in user_identities — not
-- rewriting foreign keys across the bond tables.

CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       CITEXT NOT NULL UNIQUE,
  full_name   TEXT,
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'suspended', 'closed')),
  -- KYC tier drives what an investor is allowed to subscribe to.
  kyc_tier    SMALLINT NOT NULL DEFAULT 0 CHECK (kyc_tier BETWEEN 0 AND 3),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Password credentials. Separate from `users` so that:
--   * a user can exist with no password (invited, or SSO-only)
--   * swapping to an external IdP does not touch the users table
CREATE TABLE user_credentials (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash  TEXT NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reserved for external identity providers (Google, Auth0, a bank's SSO).
-- Empty today; its existence is what keeps the door open.
CREATE TABLE user_identities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,
  subject       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);
CREATE INDEX user_identities_user_idx ON user_identities(user_id);

CREATE TABLE user_roles (
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role     TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'issuer', 'investor')),
  PRIMARY KEY (user_id, role)
);

-- Refresh tokens are stored hashed and rotated on every use. `replaced_by` chains a
-- token to its successor, so if a stolen token is replayed after rotation we can see
-- the whole family and revoke it.
CREATE TABLE refresh_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  replaced_by  UUID REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens(user_id) WHERE revoked_at IS NULL;
CREATE INDEX refresh_tokens_expiry_idx ON refresh_tokens(expires_at) WHERE revoked_at IS NULL;
