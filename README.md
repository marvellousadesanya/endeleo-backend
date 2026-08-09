# Endeleo Backend

NestJS API for the Bond Engine. Plain PostgreSQL — no Supabase.

## Getting started

```bash
npm install
cp .env.example .env      # then set real secrets
npm run db:up             # Postgres on localhost:5434
npm run migrate
npm run dev               # http://localhost:4000/api
```

## Layout

| Path | Purpose |
| --- | --- |
| `src/config` | Environment contract, validated at boot |
| `prisma` | Schema and migrations |
| `src/database` | Prisma client, wired to a pg driver adapter |
| `src/auth` | Registration, login, rotating refresh tokens, guards |
| `src/users` | Endeleo's own identity model |
| `src/health` | Liveness + database round-trip |

## Decisions

**Prisma.** Ordinary reads and writes go through Prisma. Prisma 7 has no Rust engine,
so the connection is a `pg` pool we own via a driver adapter, and the URL lives in
`prisma.config.ts` rather than the schema.

**One migration system.** Prisma Migrate owns `prisma/migrations`, which are plain `.sql`
files. Database-level guarantees Prisma cannot model — triggers, constraints, and the
atomic money procedures — are hand-written into those same files. Never introduce a
second migration tool: schema drift is how the previous setup became unrebuildable.

**Raw SQL where it matters.** The bond engine's money operations stay as Postgres
procedures and are called with `$queryRaw`. A trigger fires for every writer; application
code only protects the paths that go through it.

**Endeleo owns identity.** The domain key is `users.id`, ours. Passwords live in a
separate `user_credentials` table and `user_identities` is reserved for external
providers — so adding or swapping an identity provider never touches the bond registry's
foreign keys.

**Money is `BigInt`.** Prisma maps Postgres `bigint` to JavaScript `BigInt`, which holds
kobo values safely. Note `JSON.stringify` throws on `BigInt` — convert at the API edge.

## Auth flow

`POST /api/auth/register` · `POST /api/auth/login` → access token (15m) + refresh token (30d).
`POST /api/auth/refresh` rotates the refresh token; replaying a rotated one is treated as
theft and revokes every session for that user. `GET /api/auth/me` needs a Bearer token.
