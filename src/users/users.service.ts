// Users are the domain's identity. Everything downstream (holdings, subscriptions,
// audit entries) will reference users.id — never an auth provider's id.
import { Inject, Injectable } from "@nestjs/common";
import { DB, type Db } from "@/database/database.module";

export interface UserWithRoles {
  id: string;
  email: string;
  full_name: string | null;
  status: "active" | "suspended" | "closed";
  kyc_tier: number;
  roles: string[];
}

@Injectable()
export class UsersService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findById(id: string): Promise<UserWithRoles | undefined> {
    const user = await this.db
      .selectFrom("users")
      .select(["id", "email", "full_name", "status", "kyc_tier"])
      .where("id", "=", id)
      .executeTakeFirst();
    if (!user) return undefined;
    return { ...user, roles: await this.rolesFor(user.id) };
  }

  async findByEmail(email: string) {
    return this.db
      .selectFrom("users")
      .select(["id", "email", "full_name", "status", "kyc_tier"])
      .where("email", "=", email)
      .executeTakeFirst();
  }

  async rolesFor(userId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom("user_roles")
      .select("role")
      .where("user_id", "=", userId)
      .execute();
    return rows.map((r) => r.role);
  }

  /**
   * Create a user and their password in one transaction — a user row with no
   * credentials would be an account nobody can ever sign in to.
   */
  async createWithPassword(input: {
    email: string;
    passwordHash: string;
    fullName?: string;
  }): Promise<UserWithRoles> {
    return this.db.transaction().execute(async (trx) => {
      const user = await trx
        .insertInto("users")
        .values({ email: input.email, full_name: input.fullName ?? null })
        .returning(["id", "email", "full_name", "status", "kyc_tier"])
        .executeTakeFirstOrThrow();

      await trx
        .insertInto("user_credentials")
        .values({ user_id: user.id, password_hash: input.passwordHash })
        .execute();

      await trx
        .insertInto("user_roles")
        .values({ user_id: user.id, role: "investor" })
        .execute();

      return { ...user, roles: ["investor"] };
    });
  }

  async passwordHashFor(userId: string): Promise<string | undefined> {
    const row = await this.db
      .selectFrom("user_credentials")
      .select("password_hash")
      .where("user_id", "=", userId)
      .executeTakeFirst();
    return row?.password_hash;
  }
}
