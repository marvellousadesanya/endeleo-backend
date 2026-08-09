import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AuthUser } from "./jwt.strategy";

/** Injects the authenticated user: `me(@CurrentUser() user: AuthUser)`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<{ user: AuthUser }>().user,
);
