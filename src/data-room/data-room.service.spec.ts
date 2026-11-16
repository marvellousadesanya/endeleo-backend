import { describe, it, expect, vi } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { DataRoomService } from "./data-room.service";

// Who can open what in the data room. The case that motivated these: a sponsor is not a
// KYC'd investor, so before issuers were recognised they were refused their own bond's
// documents. Prisma and storage are stubbed — only the access decisions are under test.

const SPONSOR = { id: "sponsor-1", email: "s@x.ng", roles: ["investor"], kycTier: 0 };
const OTHER_SPONSOR = { id: "sponsor-2", email: "o@x.ng", roles: ["investor"], kycTier: 0 };
const INVESTOR = { id: "inv-1", email: "i@x.ng", roles: ["investor"], kycTier: 0 };
const ADMIN = { id: "adm-1", email: "a@x.ng", roles: ["admin"], kycTier: 0 };

type Doc = { id: string; bondId: string | null; isPublished: boolean; requiresSignature: boolean };
const doc = (over: Partial<Doc> = {}): Doc => ({
  id: "d1",
  bondId: "b1",
  isPublished: true,
  requiresSignature: false,
  ...over,
});

function makeService(opts: { doc?: Doc; verified?: string[]; signedBy?: string[] } = {}) {
  const d = opts.doc ?? doc();
  const prisma: any = {
    bond: { findUnique: vi.fn(async () => ({ issuerId: SPONSOR.id })) },
    profile: {
      findUnique: vi.fn(async ({ where }: any) => ({
        kycStatus: (opts.verified ?? []).includes(where.userId) ? "verified" : "pending",
      })),
    },
    dataRoomDocument: {
      findUnique: vi.fn(async () => ({
        ...d,
        mimeType: "application/pdf",
        fileName: "f.pdf",
        filePath: "data-room/f.pdf",
      })),
      findMany: vi.fn(async () => []),
    },
    dataRoomSignature: {
      findUnique: vi.fn(async ({ where }: any) =>
        (opts.signedBy ?? []).includes(where.documentId_userId.userId) ? { id: "sig" } : null,
      ),
    },
  };
  const storage: any = { getDownloadUrl: vi.fn(async () => "https://r2.example/f.pdf?sig=1") };
  return { service: new DataRoomService(prisma, storage), prisma, storage };
}

const opens = async (svc: DataRoomService, user: any) =>
  (await svc.createDownloadToken(user, "d1")).url;
const refused = (svc: DataRoomService, user: any) =>
  expect(svc.createDownloadToken(user, "d1")).rejects.toBeInstanceOf(ForbiddenException);

describe("a sponsor opening their own bond's documents", () => {
  it("is let in without investor KYC", async () => {
    const { service } = makeService();
    expect(await opens(service, SPONSOR)).toContain("r2.example");
  });

  it("can open a document that isn't published yet", async () => {
    const { service } = makeService({ doc: doc({ isPublished: false }) });
    expect(await opens(service, SPONSOR)).toBeTruthy();
  });

  it("is not stopped by the signature wall on their own paperwork", async () => {
    const { service } = makeService({ doc: doc({ requiresSignature: true }) });
    expect(await opens(service, SPONSOR)).toBeTruthy();
  });

  it("still needs KYC for a general document that belongs to no bond", async () => {
    const { service } = makeService({ doc: doc({ bondId: null }) });
    await refused(service, SPONSOR);
  });
});

describe("anyone who didn't issue the bond", () => {
  it("is refused as an unverified sponsor of a different bond", async () => {
    const { service } = makeService();
    await refused(service, OTHER_SPONSOR);
  });

  it("opens a published document as a verified investor", async () => {
    const { service } = makeService({ verified: [INVESTOR.id] });
    expect(await opens(service, INVESTOR)).toBeTruthy();
  });

  it("is refused an unpublished document even when verified", async () => {
    const { service } = makeService({ doc: doc({ isPublished: false }), verified: [INVESTOR.id] });
    await refused(service, INVESTOR);
  });

  it("must sign first when the document asks for it", async () => {
    const unsigned = makeService({
      doc: doc({ requiresSignature: true }),
      verified: [INVESTOR.id],
    });
    await refused(unsigned.service, INVESTOR);

    const signed = makeService({
      doc: doc({ requiresSignature: true }),
      verified: [INVESTOR.id],
      signedBy: [INVESTOR.id],
    });
    expect(await opens(signed.service, INVESTOR)).toBeTruthy();
  });

  it("is let into everything as an admin", async () => {
    const { service } = makeService({ doc: doc({ isPublished: false, requiresSignature: true }) });
    expect(await opens(service, ADMIN)).toBeTruthy();
  });
});

describe("listing a bond's documents", () => {
  const whereFor = async (user: any) => {
    const { service, prisma } = makeService();
    const res = await service.list(user, "b1");
    return { where: prisma.dataRoomDocument.findMany.mock.calls[0][0].where, access: res.access };
  };

  it("shows the bond's sponsor unpublished documents too", async () => {
    const { where, access } = await whereFor(SPONSOR);
    expect(where).toEqual({ bondId: "b1" });
    expect(access.isIssuer).toBe(true);
  });

  it("shows everyone else published documents only", async () => {
    const { where, access } = await whereFor(OTHER_SPONSOR);
    expect(where).toEqual({ bondId: "b1", isPublished: true });
    expect(access.isIssuer).toBe(false);
  });
});
