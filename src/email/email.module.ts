import { Global, Module } from "@nestjs/common";
import { EmailService } from "./email.service";

/** Global: EmailService has no state worth scoping, and half the app ends up needing it. */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
