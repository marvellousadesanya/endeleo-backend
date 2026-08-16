// TOTP (RFC 6238) — six digits, 30-second steps, HMAC-SHA1.
//
// Hand-rolled rather than pulled from a library: it is about forty lines, and the two
// details that actually matter for security — constant-time comparison and replay
// rejection — are easier to get right when they are visible.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const DIGITS = 6;
const STEP_SECONDS = 30;
/** Accept the neighbouring steps so a slightly wrong device clock still works. */
const DEFAULT_WINDOW = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateSecret(bytes = 20): string {
  const buf = randomBytes(bytes);
  let bits = "";
  for (const byte of buf) bits += byte.toString(2).padStart(8, "0");

  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = "";
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Invalid base32 character in secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function currentStep(atMs = Date.now()): number {
  return Math.floor(atMs / 1000 / STEP_SECONDS);
}

/** The standard dynamic-truncation construction from RFC 4226. */
export function codeForStep(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigInt64BE(BigInt(step));

  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export interface VerifyResult {
  valid: boolean;
  /** The step the code belonged to — persist it to stop the same code being replayed. */
  step?: number;
}

/**
 * Checks a submitted code against the accepted window.
 *
 * `lastUsedStep` rejects replay: a code stays mathematically valid for its whole 30
 * second step, so without this an attacker who shoulder-surfs one code can reuse it.
 */
export function verifyCode(
  secret: string,
  submitted: string,
  options: { window?: number; lastUsedStep?: number | null; atMs?: number } = {},
): VerifyResult {
  const code = submitted.replace(/\D/g, "");
  if (code.length !== DIGITS) return { valid: false };

  const window = options.window ?? DEFAULT_WINDOW;
  const now = currentStep(options.atMs);

  for (let offset = -window; offset <= window; offset++) {
    const step = now + offset;
    if (options.lastUsedStep != null && step <= options.lastUsedStep) continue;

    const expected = codeForStep(secret, step);
    const a = Buffer.from(expected);
    const b = Buffer.from(code);
    if (a.length === b.length && timingSafeEqual(a, b)) return { valid: true, step };
  }
  return { valid: false };
}

/** The otpauth:// URI an authenticator app scans. */
export function otpauthUri(args: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${args.issuer}:${args.account}`);
  const params = new URLSearchParams({
    secret: args.secret,
    issuer: args.issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
