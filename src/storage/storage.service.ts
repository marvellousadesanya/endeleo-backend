// Local-disk file storage — the replacement for Supabase Storage.
//
// TWO THINGS TO KNOW BEFORE THIS GOES ANYWHERE NEAR PRODUCTION:
//
//  1. Most hosts give containers an ephemeral filesystem. Every deploy or restart
//     starts clean, so anything written here is lost unless STORAGE_ROOT points at a
//     mounted persistent volume.
//  2. With more than one API instance behind a load balancer, a file written by one is
//     invisible to the others.
//
// The interface below is deliberately narrow — put/read/remove plus a signed token — so
// swapping in S3 or R2 later means reimplementing this one class and nothing else.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface StoredFile {
  path: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly root: string;
  private readonly urlSecret: string;

  constructor(private readonly config: ConfigService) {
    this.root = resolve(this.config.get<string>("STORAGE_ROOT") ?? "./storage");
    // Falls back to the refresh secret so local development works without extra setup,
    // but a dedicated STORAGE_URL_SECRET is what should be set in any real deployment.
    this.urlSecret =
      this.config.get<string>("STORAGE_URL_SECRET") ??
      this.config.get<string>("JWT_REFRESH_SECRET") ??
      "";
  }

  /**
   * Resolves a stored path to a real one, refusing anything that escapes the root.
   * A path like "../../etc/passwd" is the whole reason this method exists.
   */
  private absolute(storedPath: string): string {
    const clean = normalize(storedPath).replace(/^(\.\.(\/|\\|$))+/, "");
    const abs = resolve(this.root, clean);
    if (abs !== this.root && !abs.startsWith(this.root + sep)) {
      throw new BadRequestException("Invalid file path");
    }
    return abs;
  }

  /**
   * Writes bytes under `scope`, returning the relative path to persist on the row.
   * The stored name is a UUID: the original is kept in the database, so a caller
   * cannot influence the filesystem layout by naming a file "../../x".
   */
  async put(scope: string, fileName: string, mimeType: string, data: Buffer): Promise<StoredFile> {
    const safeScope = scope.replace(/[^a-zA-Z0-9/_-]/g, "");
    const ext = fileName.includes(".") ? `.${fileName.split(".").pop()!.slice(0, 10)}` : "";
    const relative = join(safeScope, `${randomUUID()}${ext}`);
    const abs = this.absolute(relative);

    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, data);

    return { path: relative, fileName, mimeType, sizeBytes: data.byteLength };
  }

  async openStream(storedPath: string) {
    const abs = this.absolute(storedPath);
    try {
      await stat(abs);
    } catch {
      throw new NotFoundException("File not found");
    }
    return createReadStream(abs);
  }

  async exists(storedPath: string): Promise<boolean> {
    try {
      await stat(this.absolute(storedPath));
      return true;
    } catch {
      return false;
    }
  }

  async remove(storedPath: string): Promise<void> {
    try {
      await rm(this.absolute(storedPath), { force: true });
    } catch (err) {
      // A missing file is the desired end state anyway; log and carry on.
      this.logger.warn(`Could not remove ${storedPath}: ${String(err)}`);
    }
  }

  // ---- Signed access -------------------------------------------------------
  // Supabase handed out signed URLs pointing straight at its storage host. Here the
  // token is presented back to this API, which checks it and streams the bytes.

  /** Mints a token authorising one document for one user, for `ttlSeconds`. */
  signToken(documentId: string, userId: string, ttlSeconds = 600): string {
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const payload = `${documentId}.${userId}.${expiresAt}`;
    return `${expiresAt}.${this.hmac(payload)}`;
  }

  /** Constant-time verification — a fast reject leaks whether a prefix was right. */
  verifyToken(token: string, documentId: string, userId: string): boolean {
    const [expiresRaw, signature] = token.split(".");
    const expiresAt = Number(expiresRaw);
    if (!signature || !Number.isFinite(expiresAt)) return false;
    if (expiresAt < Math.floor(Date.now() / 1000)) return false;

    const expected = this.hmac(`${documentId}.${userId}.${expiresAt}`);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private hmac(payload: string): string {
    return createHmac("sha256", this.urlSecret).update(payload).digest("hex");
  }
}
