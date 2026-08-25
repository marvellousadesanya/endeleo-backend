// Seeds a book of open bonds so the investor dashboard has something to show.
//
// Idempotent: bonds are keyed by isinRef, so re-running updates in place rather than
// duplicating. Safe to run against a dev database as often as you like.
//
// Amounts are kobo (minor units), never floats — see the note in schema.prisma.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Currency, type CouponFrequency } from "@prisma/client";

// Prisma 7 has no Rust engine, so the adapter is required here just as it is in
// PrismaService — see src/database/prisma.service.ts.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** Naira → kobo, as BigInt. Keeps the seed readable in the unit humans think in. */
const naira = (n: number) => BigInt(Math.round(n * 100));

const days = (n: number) => new Date(Date.now() + n * 86_400_000);

type Seed = {
  isinRef: string;
  projectSlug: string;
  title: string;
  spvReference: string;
  sizeNaira: number;
  minimumNaira: number;
  /** Share of the raise already committed, 0–1. */
  filled: number;
  tenorMonths: number;
  couponRateBps: number;
  couponFrequency?: CouponFrequency;
  closesInDays: number;
};

// Project slugs match src/lib/projects.ts in the frontend, which supplies the imagery,
// sector tag and location for each card. A bond with no slug renders without any of that.
const BONDS: Seed[] = [
  { isinRef: "ENDSPVLAGSOL", projectSlug: "lagos-solar", title: "Lagos Solar Distribution Bond",
    spvReference: "SPV-LAG-SOLAR-01", sizeNaira: 2_500_000_000, minimumNaira: 250_000,
    filled: 0.62, tenorMonths: 36, couponRateBps: 1450, closesInDays: 21 },

  { isinRef: "ENDSPVABJHLT", projectSlug: "abuja-healthcare", title: "Abuja Specialist Hospital Bond",
    spvReference: "SPV-ABJ-HEALTH-01", sizeNaira: 4_200_000_000, minimumNaira: 500_000,
    filled: 0.38, tenorMonths: 48, couponRateBps: 1325, closesInDays: 34 },

  { isinRef: "ENDSPVPHWAT", projectSlug: "ph-water", title: "Port Harcourt Water Treatment Bond",
    spvReference: "SPV-PH-WATER-01", sizeNaira: 1_900_000_000, minimumNaira: 200_000,
    filled: 0.47, tenorMonths: 30, couponRateBps: 1550, closesInDays: 12 },

  { isinRef: "ENDSPVIBAEDU", projectSlug: "ibadan-edu", title: "Ibadan Campus Expansion Bond",
    spvReference: "SPV-IBA-EDU-01", sizeNaira: 1_200_000_000, minimumNaira: 150_000,
    filled: 0.71, tenorMonths: 24, couponRateBps: 1275, closesInDays: 8 },

  { isinRef: "ENDSPVNGHWY", projectSlug: "ng-highway", title: "Trans-Nigeria Highway Tranche II",
    spvReference: "SPV-NG-HWY-02", sizeNaira: 6_400_000_000, minimumNaira: 1_000_000,
    filled: 0.29, tenorMonths: 60, couponRateBps: 1180, couponFrequency: "semiannual", closesInDays: 45 },

  { isinRef: "ENDSPVKADAGR", projectSlug: "kaduna-agri", title: "Kaduna Agri-Processing Bond",
    spvReference: "SPV-KAD-AGRI-01", sizeNaira: 3_100_000_000, minimumNaira: 300_000,
    filled: 0.54, tenorMonths: 36, couponRateBps: 1620, closesInDays: 27 },

  { isinRef: "ENDSPVLAGHOU", projectSlug: "lagos-housing", title: "Lekki Affordable Housing Bond",
    spvReference: "SPV-LAG-HOUSE-01", sizeNaira: 5_200_000_000, minimumNaira: 500_000,
    filled: 0.44, tenorMonths: 48, couponRateBps: 1390, closesInDays: 39 },

  { isinRef: "ENDSPVOBUTUR", projectSlug: "obudu-tourism", title: "Obudu Mountain Resort Bond",
    spvReference: "SPV-OBU-TOUR-01", sizeNaira: 2_700_000_000, minimumNaira: 250_000,
    filled: 0.51, tenorMonths: 42, couponRateBps: 1710, closesInDays: 18 },

  { isinRef: "ENDSPVLAGWST", projectSlug: "lagos-waste", title: "Lagos Waste-to-Energy Bond",
    spvReference: "SPV-LAG-WASTE-01", sizeNaira: 3_800_000_000, minimumNaira: 300_000,
    filled: 0.33, tenorMonths: 54, couponRateBps: 1480, closesInDays: 30 },

  { isinRef: "ENDSPVABJSPT", projectSlug: "abuja-sports", title: "Abuja Sports Complex Bond",
    spvReference: "SPV-ABJ-SPORT-01", sizeNaira: 2_200_000_000, minimumNaira: 200_000,
    filled: 0.58, tenorMonths: 36, couponRateBps: 1520, closesInDays: 15 },
];

async function main() {
  // The issuer is a real Endeleo user; prefer the dedicated test issuer if present.
  const issuer =
    (await prisma.user.findFirst({ where: { email: "issuer@test.local" } })) ??
    (await prisma.user.findFirst({ orderBy: { createdAt: "asc" } }));

  if (!issuer) {
    throw new Error("No users exist — register one before seeding bonds.");
  }

  for (const b of BONDS) {
    const totalSizeMinor = naira(b.sizeNaira);
    const data = {
      title: b.title,
      spvReference: b.spvReference,
      projectSlug: b.projectSlug,
      issuerId: issuer.id,
      currency: "NGN" as Currency,
      totalSizeMinor,
      minimumInvestmentMinor: naira(b.minimumNaira),
      raisedMinor: BigInt(Math.round(Number(totalSizeMinor) * b.filled)),
      tenorMonths: b.tenorMonths,
      couponRateBps: b.couponRateBps,
      couponFrequency: (b.couponFrequency ?? "quarterly") as CouponFrequency,
      subscriptionOpenAt: days(-7),
      subscriptionCloseAt: days(b.closesInDays),
      status: "open" as const,
    };

    await prisma.bond.upsert({
      where: { isinRef: b.isinRef },
      create: { isinRef: b.isinRef, ...data },
      update: data,
    });
  }

  const open = await prisma.bond.count({ where: { status: "open" } });
  console.log(`Seeded ${BONDS.length} bonds for issuer ${issuer.email} — ${open} now open.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
