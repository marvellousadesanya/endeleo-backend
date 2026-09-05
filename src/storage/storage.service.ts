// File storage — the replacement for Supabase Storage.
//
// One driver: R2Storage (Cloudflare R2, S3-compatible). Uploads go object-store side;
// downloads are presigned URLs the browser fetches straight from R2, so file bytes never
// touch this API.
//
// A local-disk driver used to sit behind this same contract for development — files on
// disk, downloads streamed back through a signed link this API minted and verified
// itself. It's gone: every environment, local included, now talks to a real R2 bucket
// (see .env.example for the R2_* variables), so there is exactly one code path for file
// storage instead of two that could drift apart.
export interface StoredFile {
  /** Relative key to persist on the row — the argument every other method takes back. */
  path: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface DownloadUrlOptions {
  /** Sent as the download filename; the stored key is an opaque UUID. */
  fileName: string;
  mimeType: string;
  /** Link lifetime. Short by design — the URL is a bearer capability once minted. */
  ttlSeconds?: number;
}

export abstract class StorageService {
  /** Writes bytes under `scope` (e.g. "data-room"), returning the key to store on the row. */
  abstract put(
    scope: string,
    fileName: string,
    mimeType: string,
    data: Buffer,
  ): Promise<StoredFile>;

  abstract remove(path: string): Promise<void>;

  abstract exists(path: string): Promise<boolean>;

  /**
   * A URL the browser can load directly — an `<iframe src>`, an anchor, the Office
   * viewer. It carries its own authorisation in the query string, so it needs no
   * session header. The caller is responsible for the access check *before* asking
   * for one.
   */
  abstract getDownloadUrl(path: string, options: DownloadUrlOptions): Promise<string>;

  /**
   * A stable, unsigned URL for a genuinely public asset — a bond cover image, not a
   * gated document. Unlike getDownloadUrl it does not expire, so the browser and any
   * CDN in front can cache it. Only call this for files the caller has decided are
   * public.
   */
  abstract getPublicUrl(path: string): string;
}
