// Admin-only time travel. Also gated by BOND_ENGINE_ALLOW_SIMULATION in the service —
// a permission check alone is not enough for a tool that fast-forwards payments.
import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { Roles, RolesGuard } from "@/auth/roles.guard";
import { SimulationService } from "./engine/simulation.service";
import { AdvanceEngineDto, SimulateDto } from "./dto/bonds.dto";

@Controller("simulation")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin")
export class SimulationController {
  constructor(private readonly simulation: SimulationService) {}

  @Get("status")
  status() {
    return { enabled: this.simulation.isEnabled };
  }

  @Post("advance")
  advance(@Body() dto: AdvanceEngineDto) {
    return this.simulation.runEngineAt(dto.asOf);
  }

  @Post("lifecycle")
  lifecycle(@Body() dto: SimulateDto) {
    return this.simulation.simulateLifecycle(dto.bondId, dto.maxSteps);
  }
}
