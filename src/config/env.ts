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

  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
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
