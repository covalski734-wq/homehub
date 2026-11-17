import { z } from 'zod';
export interface Bindings {
  DB: D1Database;
  ASSETS?: Fetcher;
  ENVIRONMENT?: string;
  WEB_ORIGIN?: string;
  AUTH_USERS?: string;
  SESSION_TTL_DAYS?: string;
  WORKSPACE_NAME?: string;
  COINGECKO_API_KEY?: string;
}
const userSchema = z.object({
  email: z.email().transform((v) => v.toLowerCase()),
  name: z.string().min(1),
  passwordHash: z.string().regex(/^pbkdf2:100000:[a-f0-9]{32}:[a-f0-9]{64}$/),
});
const envSchema = z
  .object({
    ENVIRONMENT: z.enum(['development', 'production', 'test']).default('production'),
    WEB_ORIGIN: z.url().transform((v) => new URL(v).origin),
    AUTH_USERS: z
      .string()
      .transform((v, ctx) => {
        try {
          return JSON.parse(v);
        } catch {
          ctx.addIssue({ code: 'custom', message: 'AUTH_USERS must be JSON' });
          return z.NEVER;
        }
      })
      .pipe(z.array(userSchema).min(1)),
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    WORKSPACE_NAME: z.string().min(1).default('Наш дом'),
  })
  .superRefine((e, c) => {
    if (e.ENVIRONMENT === 'production' && !e.WEB_ORIGIN.startsWith('https://'))
      c.addIssue({ code: 'custom', message: 'HTTPS required' });
    if (new Set(e.AUTH_USERS.map((u) => u.email)).size !== e.AUTH_USERS.length)
      c.addIssue({ code: 'custom', message: 'Duplicate accounts' });
  });
export class ConfigError extends Error {}
export class AppConfig {
  readonly isProduction: boolean;
  readonly webOrigin: string;
  readonly users: z.output<typeof userSchema>[];
  readonly allowedEmails: ReadonlySet<string>;
  readonly sessionTtlMs: number;
  readonly workspaceName: string;
  private constructor(e: z.output<typeof envSchema>) {
    this.isProduction = e.ENVIRONMENT === 'production';
    this.webOrigin = e.WEB_ORIGIN;
    this.users = e.AUTH_USERS;
    this.allowedEmails = new Set(e.AUTH_USERS.map((u) => u.email));
    this.sessionTtlMs = e.SESSION_TTL_DAYS * 86400000;
    this.workspaceName = e.WORKSPACE_NAME;
  }
  static fromBindings(b: Bindings) {
    const r = envSchema.safeParse(b);
    if (!r.success)
      throw new ConfigError(
        'Invalid configuration: ' +
          r.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; '),
      );
    return new AppConfig(r.data);
  }
  isEmailAllowed(email: string) {
    return this.allowedEmails.has(email.trim().toLowerCase());
  }
}
const cache = new WeakMap<Bindings, AppConfig>();
export function getConfig(b: Bindings) {
  let c = cache.get(b);
  if (!c) {
    c = AppConfig.fromBindings(b);
    cache.set(b, c);
  }
  return c;
}
