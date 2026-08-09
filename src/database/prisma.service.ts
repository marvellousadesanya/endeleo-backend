// Single Prisma client for the app, wired to a pg connection pool.
//
// Prisma 7 has no Rust engine: it talks to Postgres through a driver adapter, so the
// pool is ours to configure and the connection string comes from validated config
// rather than being read out of the environment by Prisma itself.
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: config.getOrThrow<string>("DATABASE_URL"),
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      }),
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log("Database connected");
  }

  // Without this the pool keeps the process alive after Nest shuts down.
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
