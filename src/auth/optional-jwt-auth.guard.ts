// Like JwtAuthGuard, but never rejects the request for a missing or invalid token — it
// only ever attaches req.user when a valid one is present. For routes that must stay
// reachable anonymously but still want to know who's asking when they are signed in
// (POST /submissions: a sponsor can propose a project before having an account, but a
// signed-in sponsor's submission should still show up under "mine").
import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard("jwt") {
  handleRequest<TUser = unknown>(_err: unknown, user: unknown): TUser {
    // The default AuthGuard throws UnauthorizedException here when user is falsy —
    // that's the one line making a missing/invalid token fatal instead of anonymous.
    return (user ?? undefined) as TUser;
  }
}
