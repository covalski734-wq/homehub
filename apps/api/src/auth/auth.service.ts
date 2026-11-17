import type { MeDto } from '@homehub/shared';
import type { AppConfig } from '../config';
import { isUniqueViolation } from '../lib/http-error';
import { randomToken, sha256Hex } from '../lib/crypto';
import type { AuthRepository } from './auth.repository';
import type { LoginIdentity } from './auth.repository';
export type VerifiedIdentity = LoginIdentity & { emailVerified: boolean };

export type LoginRejectionReason = 'email_not_verified' | 'not_allowed' | 'identity_mismatch';

export class LoginRejectedError extends Error {
  constructor(readonly reason: LoginRejectionReason) {
    super(`Login rejected: ${reason}`);
  }
}

/** Pure allowlist decision, kept separate so it is easy to test exhaustively. */
export function checkIdentityAllowed(
  identity: VerifiedIdentity,
  config: AppConfig,
): LoginRejectionReason | null {
  if (!identity.email || !identity.emailVerified) return 'email_not_verified';
  if (!config.isEmailAllowed(identity.email)) return 'not_allowed';
  return null;
}

export interface ValidSession {
  id: string;
  userId: string;
  email: string;
  workspaceId: string | null;
  csrfToken: string;
  expiresAt: Date;
  /** True when the expiry was extended and the cookie must be re-issued. */
  renewed: boolean;
}

export interface SessionMeta {
  userAgent: string | null;
  ipAddress: string | null;
}

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly config: AppConfig,
  ) {}

  async completePasswordLogin(
    identity: VerifiedIdentity,
    meta: SessionMeta,
    previousToken: string | null,
  ): Promise<{ token: string; expiresAt: Date; workspaceId: string | null }> {
    const rejection = checkIdentityAllowed(identity, this.config);
    if (rejection) throw new LoginRejectedError(rejection);

    // The configured subject is the stable identity. An email that is already bound to a
    // different configured account (e.g. a recycled address) must not take over the user.
    const existingSub = await this.repository.findUserSubByEmail(identity.email);
    if (existingSub && existingSub !== identity.sub)
      throw new LoginRejectedError('identity_mismatch');

    const now = new Date();
    const token = randomToken();
    const expiresAt = new Date(now.getTime() + this.config.sessionTtlMs);
    const tokenHash = await sha256Hex(token);
    try {
      await this.repository.completeLogin({
        identity,
        workspaceName: this.config.workspaceName,
        session: {
          id: crypto.randomUUID(),
          tokenHash,
          csrfToken: randomToken(),
          expiresAt,
          userAgent: meta.userAgent?.slice(0, 500) ?? null,
          ipAddress: meta.ipAddress,
        },
        previousTokenHash: previousToken ? await sha256Hex(previousToken) : null,
        now,
      });
    } catch (error) {
      // Lost a race against another configured account claiming the same email.
      if (isUniqueViolation(error, 'users.email'))
        throw new LoginRejectedError('identity_mismatch');
      throw error;
    }
    // The household the login joined: the caller makes sure it has a member for this login.
    const session = await this.repository.findSessionByTokenHash(tokenHash);
    return { token, expiresAt, workspaceId: session?.workspaceId ?? null };
  }

  /** Returns null for unknown or expired tokens. Sliding expiration: extends sessions past half-life. */
  async validateSession(token: string): Promise<ValidSession | null> {
    const session = await this.repository.findSessionByTokenHash(await sha256Hex(token));
    if (!session) return null;

    const now = Date.now();
    if (session.expiresAt.getTime() <= now) {
      await this.repository.deleteSession(session.id);
      return null;
    }

    const renewed = session.expiresAt.getTime() - now < this.config.sessionTtlMs / 2;
    const expiresAt = renewed ? new Date(now + this.config.sessionTtlMs) : session.expiresAt;
    if (renewed) await this.repository.renewSession(session.id, expiresAt, new Date(now));

    return {
      id: session.id,
      userId: session.userId,
      email: session.email,
      workspaceId: session.workspaceId,
      csrfToken: session.csrfToken,
      expiresAt,
      renewed,
    };
  }

  revokeSession(sessionId: string): Promise<void> {
    return this.repository.deleteSession(sessionId);
  }

  async getMe(sessionId: string): Promise<MeDto> {
    const profile = await this.repository.getProfile(sessionId);
    if (!profile) throw new Error('Session or workspace not found');
    return {
      user: profile.user,
      workspace: profile.workspace,
      role: profile.role,
      csrfToken: profile.csrfToken,
      sessionExpiresAt: profile.expiresAt.toISOString(),
    };
  }
}
