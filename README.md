# Endeleo Backend

NestJS API for the Bond Engine. Plain PostgreSQL — no Supabase.

## Getting started

```bash
npm install
cp .env.example .env      # then set real secrets
npm run db:up             # Postgres on localhost:5433
npm run migrate
npm run dev               # http://localhost:4000/api
```

## Layout

| Path | Purpose |
| --- | --- |
| `src/config` | Environment contract, validated at boot |
| `src/database` | Kysely instance, schema types, SQL migration runner |
| `src/auth` | Registration, login, rotating refresh tokens, guards |
| `src/users` | Endeleo's own identity model |
| `src/health` | Liveness + database round-trip |

## Decisions

**Kysely, not an ORM.** The bond engine's guarantees live in Postgres — the state
machine trigger, and the atomic allocate/trade/cancel procedures. A query builder works
with that rather than trying to model it as entity classes. Types are generated from the
live database (`npm run db:types`) so they follow the migrations.

**Plain `.sql` migrations.** The existing ~2,100 lines of bond engine SQL can be copied
into `src/database/migrations` unchanged and will run in filename order. Each file runs
in a transaction and is recorded, so re-running is a no-op.

**Endeleo owns identity.** The domain key is `users.id`, ours. Passwords live in a
separate `user_credentials` table and `user_identities` is reserved for external
providers — so adding or swapping an identity provider never touches the bond registry's
foreign keys.

**Money stays as text from the driver.** `bigint` columns are not parsed into JavaScript
numbers, which cannot hold them safely. Convert to `BigInt` deliberately.

## Auth flow

`POST /api/auth/register` · `POST /api/auth/login` → access token (15m) + refresh token (30d).
`POST /api/auth/refresh` rotates the refresh token; replaying a rotated one is treated as
theft and revokes every session for that user. `GET /api/auth/me` needs a Bearer token.
