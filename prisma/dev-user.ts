// Create — or reset the password of — a local test account.
//
// A bare invocation only touches the password. Roles and KYC are left exactly as they
// are unless you pass --roles / --kyc, so resetting a forgotten password never quietly
// demotes an account. A brand-new account starts as a verified investor.
//
// Never run against a real database: it writes a password hash straight to
// user_credentials.
//
//   npm run dev:user -- conntest+2077@example.com                     # password only
//   npm run dev:user -- conntest+2077@example.com --roles admin,investor
//   npm run dev:user -- someone@test.local --password 'twelve chars+' --kyc none
//
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type KycStatus, type Role } from "@prisma/client";
import { hash as argonHash } from "@node-rs/argon2";

// 12 chars is the floor the register endpoint enforces (auth.dto.ts) — keep dev
// accounts on the same rule so a password set here also works through the UI.
const MIN_PASSWORD = 12;
const DEFAULT_PASSWORD = "endeleo-dev-local";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
if (process.env.NODE_ENV === "production") {
  throw new Error("dev-user is a local-only tool — refusing to run with NODE_ENV=production");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** Bare-bones flag parsing: one positional email, plus --key value pairs. */
function parseArgs(argv: string[]) {
  const [email, ...rest] = argv;
  const opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (rest[i]?.startsWith("--")) opts[rest[i].slice(2)] = rest[i + 1] ?? "";
  }
  return {
    email: email?.toLowerCase().trim(),
    password: opts.password || DEFAULT_PASSWORD,
    // undefined => not supplied => leave the existing value untouched.
    roles:
      opts.roles === undefined
        ? undefined
        : (opts.roles.split(",").map((r) => r.trim()).filter(Boolean) as Role[]),
    kyc: opts.kyc === undefined ? undefined : (opts.kyc as KycStatus),
  };
}

async function main() {
  const { email, password, roles, kyc } = parseArgs(process.argv.slice(2));
  if (!email || !email.includes("@")) {
    throw new Error("Usage: npm run dev:user -- <email> [--password x] [--roles a,b] [--kyc none|verified]");
  }
  if (password.length < MIN_PASSWORD) {
    throw new Error(`Password must be at least ${MIN_PASSWORD} characters`);
  }

  const passwordHash = await argonHash(password);
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, roles: { select: { role: true } }, profile: { select: { kycStatus: true } } },
  });

  // New accounts get sensible dev defaults; existing ones keep what they have.
  const effectiveRoles = roles ?? (existing ? undefined : (["investor"] as Role[]));
  const effectiveKyc = kyc ?? (existing ? undefined : ("verified" as KycStatus));

  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      fullName: "Dev Tester",
      credential: { create: { passwordHash } },
      profile: { create: { kycStatus: effectiveKyc ?? "verified", currencyPref: "NGN" } },
    },
    update: {
      credential: { upsert: { create: { passwordHash }, update: { passwordHash } } },
      ...(effectiveKyc
        ? {
            profile: {
              upsert: {
                create: { kycStatus: effectiveKyc, currencyPref: "NGN" },
                update: { kycStatus: effectiveKyc },
              },
            },
          }
        : {}),
    },
    select: { id: true, email: true },
  });

  if (effectiveRoles) {
    // Composite-key table — reconcile wholesale so --roles replaces rather than appends.
    await prisma.userRoleAssignment.deleteMany({ where: { userId: user.id } });
    await prisma.userRoleAssignment.createMany({
      data: effectiveRoles.map((role) => ({ userId: user.id, role })),
    });
  }

  const finalRoles = await prisma.userRoleAssignment.findMany({
    where: { userId: user.id },
    select: { role: true },
  });
  const finalProfile = await prisma.profile.findUnique({
    where: { userId: user.id },
    select: { kycStatus: true },
  });

  console.log(`${user.email}${existing ? "" : "  (created)"}`);
  console.log(`  password: ${password}`);
  console.log(`  roles:    ${finalRoles.map((r) => r.role).join(", ") || "(none)"}`);
  console.log(`  kyc:      ${finalProfile?.kycStatus ?? "(no profile)"}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
