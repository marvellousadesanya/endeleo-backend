// Kysely's view of the database.
//
// Hand-written for now; once more tables land, `npm run db:types` regenerates this
// from the live database so the types follow the migrations rather than drifting from
// them. Generated<T> marks columns the database fills in, so inserts don't require them.
import type { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface UsersTable {
  id: Generated<string>;
  email: string;
  full_name: string | null;
  status: Generated<"active" | "suspended" | "closed">;
  kyc_tier: Generated<number>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface UserCredentialsTable {
  user_id: string;
  password_hash: string;
  updated_at: Generated<Timestamp>;
}

export interface UserIdentitiesTable {
  id: Generated<string>;
  user_id: string;
  provider: string;
  subject: string;
  created_at: Generated<Timestamp>;
}

export interface UserRolesTable {
  user_id: string;
  role: "admin" | "editor" | "issuer" | "investor";
}

export interface RefreshTokensTable {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  replaced_by: string | null;
  user_agent: string | null;
  created_at: Generated<Timestamp>;
}

export interface Database {
  users: UsersTable;
  user_credentials: UserCredentialsTable;
  user_identities: UserIdentitiesTable;
  user_roles: UserRolesTable;
  refresh_tokens: RefreshTokensTable;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
