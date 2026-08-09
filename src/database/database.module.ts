// Single Kysely instance shared across the app, wired to a pg connection pool.
import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Kysely, PostgresDialect, type LogEvent } from "kysely";
import { Pool, types } from "pg";
import type { Database } from "./schema";

export const DB = Symbol("KYSELY_DB");
export type Db = Kysely<Database>;

// int8/bigint arrives as a string by default because it can exceed Number.MAX_SAFE_INTEGER.
// Money in this system is stored in minor units as bigint, so keeping the string and
// converting deliberately (to BigInt, never to Number) is the safe behaviour — do NOT
// register a parser that turns these into JS numbers.
types.setTypeParser(types.builtins.INT8, (value) => value);

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Db => {
        const isDev = config.get<string>("NODE_ENV") !== "production";
        const pool = new Pool({
          connectionString: config.get<string>("DATABASE_URL"),
          max: 10,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
        });

        return new Kysely<Database>({
          dialect: new PostgresDialect({ pool }),
          log: (event: LogEvent) => {
            if (event.level === "error") {
              console.error("[db] query failed", event.error);
            } else if (isDev) {
              console.debug(`[db] ${Math.round(event.queryDurationMillis)}ms`, event.query.sql);
            }
          },
        });
      },
    },
  ],
  exports: [DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db) {}

  // Kysely owns the pool; destroying it drains in-flight queries and lets the process
  // exit instead of hanging on an open connection.
  async onApplicationShutdown() {
    await this.db.destroy();
  }
}
