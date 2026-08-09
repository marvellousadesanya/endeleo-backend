// Liveness plus a real database round-trip, so a deploy that cannot reach Postgres
// fails its health check instead of serving errors.
import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { sql } from "kysely";
import { DB, type Db } from "@/database/database.module";

@Controller("health")
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async check() {
    try {
      await sql`select 1`.execute(this.db);
    } catch {
      throw new ServiceUnavailableException({ status: "error", database: "unreachable" });
    }
    return { status: "ok", database: "ok", uptime: Math.round(process.uptime()) };
  }
}
