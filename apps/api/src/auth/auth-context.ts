import type { Scope } from '../lib/service-context';

/** Identity attached to every authenticated request by the session middleware. */
export interface AuthContext {
  sessionId: string;
  userId: string;
  email: string;
  workspaceId: string;
  csrfToken: string;
  /** What the caller may do. Every member of a household holds all scopes. */
  scopes: ReadonlySet<Scope>;
  /** Set only by trusted server-side demo workspace routing. */
  demoMode?: boolean;
}
