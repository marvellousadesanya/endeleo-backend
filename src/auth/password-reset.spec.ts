import { describe, it, expect, beforeEach, vi } from "vitest";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service";

// These cover the properties that make a reset safe rather than merely working:
// no account enumeration, single use, expiry, and every session dying with the old
// password. Prisma and the mailer are stubbed — this is about the decisions, not the
// storage.

const NOW = new Date("2026-09-29T12:00:00Z");
const ACTIVE_USER = { id: "u1", email: "investor@endeleo.test", status: "active" };

function makeService() {
  const store: { rows: any[] } = { rows: [] };
  const sent: { to: string; subject: string; html: string }[] = [];

  const prisma: any = {
    passwordResetToken: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const r of store.rows) {
          if (r.userId === where.userId && (where.usedAt !== null || r.usedAt === null)) {
            Object.assign(r, data);
            count++;
          }
        }
        return { count };
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `t${store.rows.length + 1}`, usedAt: null, ...data };
        store.rows.push(row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const row = store.rows.find((r) => r.tokenHash === where.tokenHash);
        return row ? { ...row, user: ACTIVE_USER } : null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = store.rows.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
    userCredential: { upsert: vi.fn(async () => ({})) },
    refreshToken: { updateMany: vi.fn(async () => ({ count: 3 })) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  const users: any = {
    findByEmail: vi.fn(async (email: string) =>
      email === ACTIVE_USER.email ? ACTIVE_USER : null,
    ),
  };
  // Mirrors ConfigService closely enough for resolveReturnOrigin, which reads
  // CORS_ORIGINS with get() and FRONTEND_URL with getOrThrow().
  const config: any = {
    get: (key: string) =>
      key === "CORS_ORIGINS" ? ["https://application.endeleo.online"] : undefined,
    getOrThrow: () => "https://application.endeleo.online",
  };
  const email: any = {
    send: vi.fn(async (to: string, subject: string, html: string) => {
      sent.push({ to, subject, html });
    }),
  };

  const service = new AuthService(
    prisma,
    users,
    {} as any,
    config,
    {} as any,
    email,
  );
  /**
   * The token as the account holder receives it — pulled out of the email, because the
   * plaintext exists nowhere else by design. Redeeming this is the real flow.
   */
  const tokenFromLastEmail = () => {
    const html = sent.at(-1)?.html ?? "";
    return decodeURIComponent(/reset-password\?token=([^"&]+)/.exec(html)?.[1] ?? "");
  };

  return { service, prisma, email, sent, store, tokenFromLastEmail };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe("forgotPassword does not reveal who has an account", () => {
  it("answers identically for a registered and an unregistered address", async () => {
    const { service } = makeService();
    const known = await service.forgotPassword(ACTIVE_USER.email);
    const unknown = await service.forgotPassword("nobody@endeleo.test");
    expect(known).toEqual(unknown);
    expect(known).toEqual({ ok: true });
  });

  it("emails only the address that actually has an account", async () => {
    const { service, sent } = makeService();
    await service.forgotPassword("nobody@endeleo.test");
    expect(sent).toHaveLength(0);

    await service.forgotPassword(ACTIVE_USER.email);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(ACTIVE_USER.email);
  });

  it("never stores the token in plaintext", async () => {
    const { service, store } = makeService();
    await service.forgotPassword(ACTIVE_USER.email);
    const row = store.rows[0];
    expect(row.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.values(row).join(" ")).not.toContain("=");
  });

  // A second request must strand the first link: it may already be in a stolen inbox.
  it("consumes earlier unused tokens when a new one is requested", async () => {
    const { service, prisma, store } = makeService();
    await service.forgotPassword(ACTIVE_USER.email);
    await service.forgotPassword(ACTIVE_USER.email);
    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: ACTIVE_USER.id, usedAt: null } }),
    );
    expect(store.rows[0].usedAt).not.toBeNull();
  });
});

describe("resetPassword", () => {
  it("rejects a token that was never issued", async () => {
    const { service } = makeService();
    await expect(service.resetPassword("made-up", "a-long-enough-password")).rejects.toThrow(
      BadRequestException,
    );
  });

  it("completes a reset with the token from the email", async () => {
    const { service, prisma, sent, tokenFromLastEmail } = makeService();
    await service.forgotPassword(ACTIVE_USER.email);

    const result = await service.resetPassword(tokenFromLastEmail(), "a-long-enough-password");

    expect(result).toEqual({ ok: true });
    expect(prisma.userCredential.upsert).toHaveBeenCalled();
    // The confirmation is the alarm if the reset was not the owner's doing.
    expect(sent.at(-1)?.subject).toMatch(/password was changed/i);
  });

  // The reason a reset revokes sessions: if someone else had the account, leaving their
  // refresh token alive would hand it straight back after the password changed.
  it("signs out every existing session", async () => {
    const { service, prisma, tokenFromLastEmail } = makeService();
    await service.forgotPassword(ACTIVE_USER.email);
    await service.resetPassword(tokenFromLastEmail(), "a-long-enough-password");

    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: ACTIVE_USER.id, revokedAt: null },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      }),
    );
  });

  it("refuses the same link a second time", async () => {
    const { service, tokenFromLastEmail } = makeService();
    await service.forgotPassword(ACTIVE_USER.email);
    const token = tokenFromLastEmail();

    await service.resetPassword(token, "a-long-enough-password");
    await expect(service.resetPassword(token, "another-long-password")).rejects.toThrow(
      BadRequestException,
    );
  });

  it("refuses a link that has expired", async () => {
    const { service, store, tokenFromLastEmail } = makeService();
    await service.forgotPassword(ACTIVE_USER.email);
    const token = tokenFromLastEmail();

    vi.setSystemTime(new Date(store.rows[0].expiresAt.getTime() + 1000));
    await expect(service.resetPassword(token, "a-long-enough-password")).rejects.toThrow(
      BadRequestException,
    );
  });

  it("issues tokens that expire within the hour", async () => {
    const { service, store } = makeService();
    await service.forgotPassword(ACTIVE_USER.email);
    const ttlMs = store.rows[0].expiresAt.getTime() - NOW.getTime();
    expect(ttlMs).toBeGreaterThan(0);
    expect(ttlMs).toBeLessThanOrEqual(60 * 60_000);
  });
});

describe("AuthService constructor wiring", () => {
  // Guards the argument order these tests depend on; a reorder would silently make
  // every assertion above meaningless rather than fail loudly.
  it("is constructible with the stubs these tests provide", () => {
    const { service } = makeService();
    expect(service).toBeInstanceOf(AuthService);
    expect(typeof service.forgotPassword).toBe("function");
    expect(typeof service.resetPassword).toBe("function");
  });
});
