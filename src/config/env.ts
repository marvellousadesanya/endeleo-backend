// Environment contract. Validated once at boot: a missing or weak secret should stop
// the process starting, not surface as a runtime failure on the first login attempt.
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().url(),

  // 32 chars is the floor for a signing secret worth having.
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),

  // Where the browser is sent back to after a social sign-in.
  FRONTEND_URL: z.string().url().default("http://localhost:8080"),
  // This API's own public base URL — must match the redirect URI registered with Google.
  PUBLIC_API_URL: z.string().url().default("http://localhost:4000"),

  // Optional: social sign-in stays switched off until both are provided, so the app
  // boots fine without Google credentials.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Engine test controls. Both must stay unset in production.
  BOND_ENGINE_ALLOW_SIMULATION: z.enum(["true", "false"]).optional(),
  BOND_ENGINE_MOCK_DISBURSE: z.enum(["ok", "fail", "throw"]).optional(),

  // Cloudflare R2 (S3-compatible). The only file storage driver — see storage.service.ts
  // for why a local-disk fallback used to exist here and doesn't anymore. All five are
  // required in every environment, local development included.
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  // The bucket's public base URL (its r2.dev address, or a custom domain bound to it —
  // switch to that before this carries real production traffic; r2.dev is rate-limited).
  R2_PUBLIC_URL: z.string().url(),

  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),

  // Wallet top-ups. Test-mode secret keys look like sk_test_...; live ones sk_live_...
  // Same key both initializes a charge and verifies Paystack's webhook signature — there
  // is no separate webhook secret. Optional so the app boots without it; the deposit
  // endpoints throw a clear 503 if a real request reaches them unconfigured.
  PAYSTACK_SECRET_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  // Distinct secrets, so a leaked access token can never be replayed as a refresh token.
  if (parsed.data.JWT_ACCESS_SECRET === parsed.data.JWT_REFRESH_SECRET) {
    throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ");
  }

  return parsed.data;
}
