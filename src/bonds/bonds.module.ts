import { Module } from "@nestjs/common";
import { AdaptersModule } from "./adapters/adapters.module";
import { BondsController } from "./bonds.controller";
import { BondsService } from "./bonds.service";
import { MarketController } from "./market.controller";
import { MarketService } from "./market.service";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";
import { SimulationController } from "./simulation.controller";
import { SubscriptionsController } from "./subscriptions.controller";
import { SubscriptionsService } from "./subscriptions.service";
import { ActivationService } from "./engine/activation.service";
import { CouponRunnerService } from "./engine/coupon-runner.service";
import { RedemptionRunnerService } from "./engine/redemption-runner.service";
import { SimulationService } from "./engine/simulation.service";
import { EngineTick } from "./engine/engine.tick";

@Module({
  imports: [AdaptersModule],
  controllers: [
    BondsController,
    SubscriptionsController,
    MarketController,
    ReportsController,
    SimulationController,
  ],
  providers: [
    BondsService,
    SubscriptionsService,
    MarketService,
    ReportsService,
    ActivationService,
    CouponRunnerService,
    RedemptionRunnerService,
    SimulationService,
    EngineTick,
  ],
})
export class BondsModule {}
