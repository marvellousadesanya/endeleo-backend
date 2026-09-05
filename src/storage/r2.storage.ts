// Cloudflare R2 storage driver (S3-compatible API).
//
// Why R2 over S3: egress is free. A document platform serves the same prospectuses and
// data-room files over and over, so download bandwidth — not storage — is the cost that
// scales, and R2 does not bill for it.
//
// Uploads go through this API (multer buffers the file, we PutObject it). Downloads do
// not: getDownloadUrl mints a presigned GET that the browser fetches straight from R2,
// so document bytes never pass through the API.
import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  StorageService,
  type DownloadUrlOptions,
  type StoredFile,
} from "./storage.service";

@Injectable()
export class R2Storage extends StorageService {
  private readonly logger = new Logger(R2Storage.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  private readonly publicBaseUrl: string | undefined;

  constructor(private readonly config: ConfigService) {
    super();
    const accountId = config.getOrThrow<string>("R2_ACCOUNT_ID");
    this.bucket = config.getOrThrow<string>("R2_BUCKET");
    this.publicBaseUrl = config.get<string>("R2_PUBLIC_URL")?.replace(/\/+$/, "");
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.getOrThrow<string>("R2_ACCESS_KEY_ID"),
        secretAccessKey: config.getOrThrow<string>("R2_SECRET_ACCESS_KEY"),
      },
    });
  }

  /**
   * The key mirrors the local driver: `scope/uuid.ext`. The original filename lives on
   * the database row, so a caller cannot shape the object layout by naming a file
   * "../../x" — the key is a UUID regardless.
   */
  async put(scope: string, fileName: string, mimeType: string, data: Buffer): Promise<StoredFile> {
    const safeScope = scope.replace(/[^a-zA-Z0-9/_-]/g, "");
    const ext = fileName.includes(".") ? `.${fileName.split(".").pop()!.slice(0, 10)}` : "";
    const key = `${safeScope}/${randomUUID()}${ext}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: mimeType,
      }),
    );

    return { path: key, fileName, mimeType, sizeBytes: data.byteLength };
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      // A missing object is the desired end state anyway; log and carry on.
      this.logger.warn(`Could not remove ${key}: ${String(err)}`);
    }
  }

  /**
   * A presigned GET. `ResponseContentDisposition`/`-Type` are folded into the signature,
   * so R2 serves the object with the right filename and MIME even though the stored key
   * carries neither.
   */
  getDownloadUrl(key: string, options: DownloadUrlOptions): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentType: options.mimeType,
      ResponseContentDisposition: `inline; filename="${encodeURIComponent(options.fileName)}"`,
    });
    return getSignedUrl(this.client, command, { expiresIn: options.ttlSeconds ?? 600 });
  }

  /**
   * Requires R2_PUBLIC_URL — the bucket's public r2.dev address or a custom domain
   * bound to it. A presigned URL is the wrong tool for a cover image: it expires, so
   * it defeats browser and CDN caching.
   */
  getPublicUrl(key: string): string {
    if (!this.publicBaseUrl) {
      throw new Error(
        "R2_PUBLIC_URL is not set — enable public access on the bucket and set it to serve public assets",
      );
    }
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    return `${this.publicBaseUrl}/${encoded}`;
  }
}
