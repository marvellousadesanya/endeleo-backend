// Liveness plus a real database round-trip, so a deploy that cannot reach Postgres
// fails its health check instead of serving errors.
import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: "error", database: "unreachable" });
    }
    return { status: "ok", database: "ok", uptime: Math.round(process.uptime()) };
  }
}
