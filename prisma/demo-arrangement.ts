// Seeds three submissions that exercise the arrangement screen end to end: one that
// should clear every test, one that fails on coverage, and one with no projection at
// all. Local-only, like dev-user.ts — it writes rows straight into the database.
//
//   npm run demo:arrangement
//
// Then sign in as an admin and GET /api/admin/submissions/<id>/arrangement for each
// id it prints. The expected verdicts are printed alongside, so a wrong answer is
// visible without having to work out the DSCR by hand.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
if (process.env.NODE_ENV === "production") {
  throw new Error("demo-arrangement is a local-only tool — refusing to run with NODE_ENV=production");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const NGN = (naira: number) => BigInt(Math.round(naira)) * 100n;

const CASES = [
  {
    title: "DEMO · Strong deal — should come back GO",
    expect: "go · bullet repayment · tightest spread",
    capitalNaira: 500_000_000,
    couponBps: 1000,
    tenorMonths: 60,
    self: {
      revenueModel: "government_payment" as const,
      offtakeAgreementInPlace: true,
      priorDfiFunding: true,
      ongoingLitigation: false,
      priorDefault: false,
    },
    // ₦50M/yr debt service against ₦140M net → 2.8x, and still 1.6x under 40% stress.
    cashflows: [
      { year: 2027, revenue: 150_000_000, opex: 10_000_000 },
      { year: 2028, revenue: 160_000_000, opex: 12_000_000 },
      { year: 2029, revenue: 165_000_000, opex: 12_000_000 },
    ],
  },
  {
    title: "DEMO · Cannot service debt — should come back NO-GO",
    expect: "no_go · coverage veto fires despite a clean government-backed sponsor",
    capitalNaira: 500_000_000,
    couponBps: 1000,
    tenorMonths: 60,
    // Deliberately the M1 handoff contract's own worked example: ₦17M of net annual
    // cashflow against a ₦500M raise. It fails the 1.25x floor by roughly 4x.
    self: {
      revenueModel: "government_payment" as const,
      offtakeAgreementInPlace: true,
      priorDfiFunding: false,
      ongoingLitigation: false,
      priorDefault: false,
    },
    cashflows: [{ year: 2027, revenue: 45_000_000, opex: 28_000_000 }],
  },
  {
    title: "DEMO · No cashflow projection — should refuse to score it",
    expect: "not go · flags the missing projection · structuring marked provisional",
    capitalNaira: 200_000_000,
    couponBps: 1200,
    tenorMonths: 48,
    self: {
      revenueModel: null,
      offtakeAgreementInPlace: null,
      priorDfiFunding: null,
      ongoingLitigation: null,
      priorDefault: null,
    },
    cashflows: [],
  },
];

async function main() {
  // Clear previous runs so re-running does not pile up duplicates.
  const cleared = await prisma.projectSubmission.deleteMany({
    where: { projectTitle: { startsWith: "DEMO · " } },
  });

  console.log(`\ncleared ${cleared.count} submission(s) from a previous run\n`);

  for (const c of CASES) {
    const created = await prisma.projectSubmission.create({
      data: {
        projectTitle: c.title,
        summary: `${c.title}. Seeded by demo-arrangement.ts to exercise the M2/M3/M5 screen.`,
        sector: "solar",
        locationState: "Lagos State",
        capitalRequiredMinor: NGN(c.capitalNaira),
        expectedReturnBps: c.couponBps,
        tenorMonths: c.tenorMonths,
        useOfProceedsDetail: "EPC, grid connection, DSRA, issue costs",
        ...c.self,
        cashflows: {
          create: c.cashflows.map((cf) => ({
            year: cf.year,
            revenueMinor: NGN(cf.revenue),
            opexMinor: NGN(cf.opex),
          })),
        },
      },
    });
    console.log(`${c.title}`);
    console.log(`  id:     ${created.id}`);
    console.log(`  expect: ${c.expect}`);
    console.log(`  try:    GET /api/admin/submissions/${created.id}/arrangement\n`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
