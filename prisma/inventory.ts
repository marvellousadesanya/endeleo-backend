// Read-only census of whatever database DATABASE_URL points at.
//
//   npm run inventory
//
// Safe to run against production: it issues no writes, no deletes and no migrations.
// It exists so that "clean up production" starts with looking rather than guessing —
// it prints what is there, marks the rows that look like test data, and says which of
// them the database would refuse to delete anyway.
//
// Nothing here deletes. Deciding what goes is a person's job; this only lays it out.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** Heuristics only — a human confirms before anything is removed. */
const TEST_TITLE = /^DEMO\b|\btest\b|\bdummy\b|\bsample\b|\(live run\)/i;
// Deliberately broad: a false "TEST?" costs a second to dismiss, a missed one could
// mean deleting a real account. `+<digits>@` catches the plus-addressed throwaways the
// payment and email smoke tests generate.
const TEST_EMAIL = /test|dummy|sample|smoke|@example\.|\.local$|\.test$|\+[^@]*\d{6,}@/i;

const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");
const naira = (v: bigint | null) =>
  v == null ? "—" : `NGN ${(Number(v) / 100).toLocaleString()}`;

function header(title: string) {
  console.log(`\n${"─".repeat(72)}\n${title}\n${"─".repeat(72)}`);
}

async function main() {
  // Which database is this? Printed without credentials so the output is pasteable.
  const host = connectionString.replace(/^.*@/, "").replace(/\/.*$/, "");
  console.log(`\nDatabase host: ${host}`);
  console.log(`Read-only inventory — nothing below is modified.`);

  header("ROW COUNTS");
  const counts = {
    users: await prisma.user.count(),
    bonds: await prisma.bond.count(),
    submissions: await prisma.projectSubmission.count(),
    applications: await prisma.investorApplication.count(),
    subscriptions: await prisma.subscription.count(),
    holdings: await prisma.holding.count(),
    walletTransactions: await prisma.walletTransaction.count(),
    auditEntries: await prisma.bondAuditEntry.count(),
    posts: await prisma.post.count(),
    dataRoomDocuments: await prisma.dataRoomDocument.count(),
  };
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k.padEnd(22)} ${String(v).padStart(6)}`);
  }

  header("PROJECT SUBMISSIONS");
  const submissions = await prisma.projectSubmission.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      projectTitle: true,
      submitterEmail: true,
      status: true,
      capitalRequiredMinor: true,
      createdAt: true,
      _count: { select: { cashflows: true } },
    },
  });
  if (submissions.length === 0) console.log("  (none)");
  for (const s of submissions) {
    const suspect =
      TEST_TITLE.test(s.projectTitle) || TEST_EMAIL.test(s.submitterEmail ?? "");
    console.log(
      `  ${suspect ? "TEST?" : "     "} ${fmt(s.createdAt)}  ${s.status.padEnd(10)} ` +
        `${naira(s.capitalRequiredMinor).padEnd(20)} ${s.projectTitle}`,
    );
    console.log(`         ${s.id}  ${s.submitterEmail ?? "—"}  ${s._count.cashflows} cashflow yrs`);
  }

  header("BONDS");
  const bonds = await prisma.bond.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      _count: { select: { auditEntries: true, subscriptions: true, holdings: true } },
    },
  });
  if (bonds.length === 0) console.log("  (none)");
  for (const b of bonds) {
    // The audit log is append-only and bonds referenced by it are FK-RESTRICTed, so a
    // bond with history cannot be deleted even by a direct DELETE. Worth knowing before
    // anyone plans a cleanup around it.
    const locked = b._count.auditEntries > 0;
    console.log(
      `  ${locked ? "LOCKED" : "      "} ${fmt(b.createdAt)}  ${b.status.padEnd(12)} ${b.title}`,
    );
    console.log(
      `         ${b.id}  audit:${b._count.auditEntries} ` +
        `subs:${b._count.subscriptions} holdings:${b._count.holdings}`,
    );
  }

  header("USERS");
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      fullName: true,
      createdAt: true,
      roles: { select: { role: true } },
      _count: { select: { holdings: true, subscriptions: true } },
    },
  });
  for (const u of users) {
    const roles = u.roles.map((r) => r.role).join(",") || "—";
    const suspect = TEST_EMAIL.test(u.email);
    const active = u._count.holdings > 0 || u._count.subscriptions > 0;
    console.log(
      `  ${suspect ? "TEST?" : "     "}${active ? " ACTIVE" : "       "} ` +
        `${fmt(u.createdAt)}  ${roles.padEnd(16)} ${u.email}`,
    );
  }

  header("INVESTOR APPLICATIONS");
  const apps = await prisma.investorApplication.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, fullName: true, status: true, createdAt: true },
  });
  if (apps.length === 0) console.log("  (none)");
  for (const a of apps) {
    console.log(
      `  ${TEST_EMAIL.test(a.email) ? "TEST?" : "     "} ${fmt(a.createdAt)}  ` +
        `${a.status.padEnd(12)} ${a.email}  ${a.fullName ?? "—"}`,
    );
  }

  header("NOTES");
  console.log(
    [
      "  TEST?   matched a name/email heuristic — confirm before believing it.",
      "  LOCKED  has audit entries; the FK is RESTRICT, so a delete will fail.",
      "  ACTIVE  holds a position or a subscription — deleting loses real money records.",
      "",
      "  The audit log itself is append-only: an UPDATE or DELETE on bond_audit_entry",
      "  is refused by a database trigger, not by application code.",
    ].join("\n"),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
