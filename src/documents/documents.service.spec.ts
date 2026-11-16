import { describe, it, expect, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { DocumentsService, kycLabel } from "./documents.service";

// An investor's own documents. Prisma and storage are stubbed; these pin down that only
// the caller's rows and files are ever read, and how downloads are named.

function makeService(kycDocuments: unknown = {}) {
  const prisma: any = {
    profile: {
      findUnique: vi.fn(async () => ({ kycDocuments, kycSubmittedAt: new Date("2026-10-01") })),
    },
    dataRoomSignature: {
      findMany: vi.fn(async () => [
        {
          signedAt: new Date("2026-10-05"),
          signedName: "Ada Obi",
          document: {
            id: "d1",
            title: "Subscription agreement",
            category: "legal",
            fileName: "agreement.pdf",
            bond: { title: "Lagos Bond", isinRef: "ENDLAG" },
          },
        },
      ]),
    },
  };
  const storage: any = { getDownloadUrl: vi.fn(async () => "https://signed.example/x") };
  return { service: new DocumentsService(prisma, storage), prisma, storage };
}

describe("listing my documents", () => {
  it("reads only the caller's profile and signatures", async () => {
    const { service, prisma } = makeService();
    await service.mine("u1");
    expect(prisma.profile.findUnique.mock.calls[0][0].where).toEqual({ userId: "u1" });
    expect(prisma.dataRoomSignature.findMany.mock.calls[0][0].where).toEqual({ userId: "u1" });
  });

  it("lists KYC files by name and drops anything outside the user's own prefix", async () => {
    const { service } = makeService({
      id_document: "u1/aaa.pdf",
      proof_of_address: "u1/bbb.jpg",
      planted: "u2/ccc.pdf",
      broken: 42,
    });
    const { kyc } = await service.mine("u1");
    expect(kyc.map((k) => [k.key, k.fileName])).toEqual([
      ["id_document", "Government-issued ID.pdf"],
      ["proof_of_address", "Proof of address.jpg"],
    ]);
  });

  it("returns signed agreements with the bond they belong to", async () => {
    const { service } = makeService();
    const { agreements } = await service.mine("u1");
    expect(agreements[0]).toMatchObject({
      documentId: "d1",
      title: "Subscription agreement",
      bondTitle: "Lagos Bond",
      signedName: "Ada Obi",
    });
  });

  it("copes with a user who has no profile yet", async () => {
    const { service, prisma } = makeService();
    prisma.profile.findUnique.mockResolvedValueOnce(null);
    expect((await service.mine("u1")).kyc).toEqual([]);
  });
});

describe("downloading a KYC file", () => {
  it("signs a link for the caller's own file, named after the document", async () => {
    const { service, storage } = makeService({ proof_of_address: "u1/bbb.pdf" });
    expect(await service.kycDownload("u1", "proof_of_address")).toEqual({
      url: "https://signed.example/x",
    });
    expect(storage.getDownloadUrl).toHaveBeenCalledWith("u1/bbb.pdf", {
      fileName: "Proof of address.pdf",
      mimeType: "application/pdf",
    });
  });

  it("refuses a key that points outside the caller's prefix", async () => {
    const { service, storage } = makeService({ id_document: "u2/stolen.pdf" });
    await expect(service.kycDownload("u1", "id_document")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(storage.getDownloadUrl).not.toHaveBeenCalled();
  });

  it("refuses a key the user never uploaded", async () => {
    const { service } = makeService({});
    await expect(service.kycDownload("u1", "id_document")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("labels", () => {
  it("names unknown keys readably", () => {
    expect(kycLabel("tax_clearance")).toBe("Tax clearance");
    expect(kycLabel("directors_id")).toBe("Directors' ID");
  });
});
