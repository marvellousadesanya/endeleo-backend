// An investor's own paperwork, gathered in one place: the KYC documents they uploaded and
// the data-room documents they signed. Allocation certificates are not stored anywhere —
// the frontend renders them from the holdings register — so they are not served here.
//
// Nothing in this service reads another user's rows: every query is keyed on the caller.
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";
import { StorageService } from "@/storage/storage.service";

/** Names for the document keys the KYC form uses (see ProfilesService). */
const KYC_LABELS: Record<string, string> = {
  id_document: "Government-issued ID",
  proof_of_address: "Proof of address",
  certificate_of_incorporation: "Certificate of incorporation",
  directors_id: "Directors' ID",
};

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  heic: "image/heic",
};

/** "proof_of_address" → "Proof of address", for any key the table above doesn't know. */
export function kycLabel(key: string): string {
  if (KYC_LABELS[key]) return KYC_LABELS[key];
  const words = key.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Stored keys are `<userId>/<uuid>.<ext>`, so the original filename is gone. The download
 * is named after what the document is instead: "Proof of address.pdf".
 */
function downloadName(key: string, path: string): { fileName: string; mimeType: string } {
  const ext = path.includes(".") ? path.split(".").pop()!.toLowerCase() : "";
  return {
    fileName: ext ? `${kycLabel(key)}.${ext}` : kycLabel(key),
    mimeType: MIME_BY_EXT[ext] ?? "application/octet-stream",
  };
}

/** profile.kyc_documents is free-form JSON; keep only string paths under the user's prefix. */
function ownKycPaths(raw: unknown, userId: string): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1].startsWith(`${userId}/`),
    ),
  );
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async mine(userId: string) {
    const [profile, signatures] = await Promise.all([
      this.prisma.profile.findUnique({
        where: { userId },
        select: { kycDocuments: true, kycSubmittedAt: true },
      }),
      this.prisma.dataRoomSignature.findMany({
        where: { userId },
        orderBy: { signedAt: "desc" },
        select: {
          signedAt: true,
          signedName: true,
          document: {
            select: {
              id: true,
              title: true,
              category: true,
              fileName: true,
              bond: { select: { title: true, isinRef: true } },
            },
          },
        },
      }),
    ]);

    const kycPaths = ownKycPaths(profile?.kycDocuments, userId);
    return {
      kyc: Object.entries(kycPaths).map(([key, path]) => ({
        key,
        label: kycLabel(key),
        fileName: downloadName(key, path).fileName,
        submittedAt: profile?.kycSubmittedAt ?? null,
      })),
      agreements: signatures.map((s) => ({
        documentId: s.document.id,
        title: s.document.title,
        category: s.document.category,
        fileName: s.document.fileName,
        bondTitle: s.document.bond?.title ?? null,
        bondIsinRef: s.document.bond?.isinRef ?? null,
        signedName: s.signedName,
        signedAt: s.signedAt,
      })),
    };
  }

  /**
   * A short-lived link to one of the caller's own KYC files. The key is looked up in
   * their own profile, so there is no path a caller can supply to reach someone else's.
   */
  async kycDownload(userId: string, key: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: { kycDocuments: true },
    });
    const path = ownKycPaths(profile?.kycDocuments, userId)[key];
    if (!path) throw new NotFoundException("Document not found");

    const url = await this.storage.getDownloadUrl(path, downloadName(key, path));
    return { url };
  }
}
