# HomeHub

A household CRM for couples and families: shared finances, savings, shopping, and chores. Host your own instance and manage your home together from a computer, phone, or an AI assistant with MCP support.

**One instance, one household.** All accounts provisioned by the administrator join the same household and share its data. HomeHub is a self-hosted application without public registration.

## Features

- **Dashboard and monthly planning:** income, recurring expenses, one-off purchases, and planned versus actual amounts.
- **Accounts and transactions:** balances, transfers, categories, and budget limits.
- **Selected totals:** select table rows to add up their amounts, including completed purchases.
- **Savings:** funds, accounts within funds, planned deposits, and transaction history. Planned amounts count toward the balance only after confirmation. Removing an account from a fund remains visible in its history.
- **Shared budgeting:** household members, account owners, expense allocation, and scenarios.
- **Shopping and chores:** shared lists, recurring tasks, and completion history.
- **MCP:** AI assistants can access the same data with separate read and write permissions.
- Light and dark themes, Russian and Ukrainian interfaces, and a mobile-friendly layout.

The project starts with an empty database. The first login creates a household, a member, and standard categories. No financial records, personal settings, or Git history from the original instance are included. Agency CRM modules, advertising accounts, and Google/Meta integrations are excluded.

## Quick start

You need **Node.js 24 LTS** and **pnpm 11.3.0**. On Windows, use `pnpm.cmd` instead of `pnpm` if PowerShell blocks script execution.

```sh
git clone <your-repository-url> homehub
cd homehub
npm install -g pnpm@11.3.0
pnpm install --frozen-lockfile
pnpm auth:setup
pnpm build
pnpm db:migrate:local
pnpm dev
```

Open **http://localhost:5173**. The API runs on port 8787 and Vite proxies requests to it, so use port 5173 to sign in.

`auth:setup` asks for each member's email and display name. Submit an empty email to finish. It generates a random password for each account and displays it once; save it in a password manager. The first member to sign in becomes the household owner, so sign in with your own account first.

The script creates two files excluded from Git:

| File                      | Purpose                                   |
| ------------------------- | ----------------------------------------- |
| `apps/api/.dev.vars`      | Local configuration and password hashes   |
| `secrets/auth-users.json` | Account list to upload as a Worker secret |

Running the script again does not overwrite existing configuration. There are no demo accounts, public registration, or default passwords. Email is used as a login identifier; the application does not send email or verify mailbox ownership.

The local SQLite database lives in `apps/api/.wrangler/`. It is separate from your cloud database.

## Deploying to Cloudflare

HomeHub uses **Workers + Static Assets + D1**. You need your own Cloudflare account. Check the current limits and pricing of your plan; password verification consumes CPU resources.

1. Authenticate the CLI and create a new database:

   ```sh
   pnpm --filter @homehub/api exec wrangler login
   pnpm --filter @homehub/api exec wrangler d1 create homehub
   ```

2. In `apps/api/wrangler.jsonc`, replace the all-zero `database_id` with the new database ID. Adjust `name`, `database_name`, and `WORKSPACE_NAME` as needed. Set `WEB_ORIGIN` to your application's exact HTTPS origin, without a path. Configure a custom domain in Cloudflare if you use one. The address must point to your own instance.

3. Upload the accounts as a secret. In a POSIX shell:

   ```sh
   pnpm --filter @homehub/api exec wrangler secret put AUTH_USERS < secrets/auth-users.json
   ```

   In PowerShell:

   ```powershell
   Get-Content -Raw -Encoding UTF8 secrets/auth-users.json | pnpm.cmd --filter @homehub/api exec wrangler secret put AUTH_USERS
   ```

   Keep secrets out of `wrangler.jsonc`, README files, issues, and CI logs.

4. Run the checks, apply the initial migration to **your new database**, and deploy:

   ```sh
   pnpm release:check
   pnpm db:migrate:remote
   pnpm release:deploy
   ```

5. Open the application and sign in with the owner's account. `/api/health` reports database connectivity.

The repository contains one initial migration, `0000_init.sql`, with the schema and integrity constraints but no user data. It is intended for a new database, not for installation over another project.

### Environment variables

| Variable            | Purpose                                                       |
| ------------------- | ------------------------------------------------------------- |
| `ENVIRONMENT`       | `development` locally, `production` on the server             |
| `WEB_ORIGIN`        | Exact frontend origin; HTTPS is required in production        |
| `AUTH_USERS`        | Secret: a JSON array of `{email, name, passwordHash}` objects |
| `SESSION_TTL_DAYS`  | Session lifetime; defaults to 30 days                         |
| `WORKSPACE_NAME`    | Name of the shared household                                  |
| `COINGECKO_API_KEY` | Optional key for fetching asset prices                        |

Exchange rates come from NBP and asset prices from CoinGecko. These requests support financial features and do not connect advertising accounts. If a provider is unavailable, the application uses previously stored data when available. The Worker's scheduler also removes expired sessions and processes configured fund rules.

## MCP and AI assistants

Open **Settings → AI access** in the application's Russian or Ukrainian interface. Create a personal token with the permissions you need. The secret is displayed when created; store it like a password.

- MCP endpoint: `https://homehub.example.com/api/mcp` (replace the origin with your own).
- Transport: Streamable HTTP.
- Personal token authentication: `Authorization: Bearer <token>`.
- Permission areas: `finance`, `planner`, `savings`, and `household`, each with separate `read` and `write` scopes.
- Compatible clients can use OAuth with PKCE and a consent page. Discovery endpoints are `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/api/mcp`.

Start with read permissions. Example requests: "Show this month's expenses," "How much is left to reach the fund's goal?", or "Which household chores are unfinished?" Write permissions allow an assistant to create and modify real records. Tokens can be revoked in settings; changes made through MCP are recorded in the access audit log.

## Managing access and data

Passwords are hashed with individual salts using PBKDF2-SHA256 and 100,000 iterations. The setup script generates long random passwords, and login attempts are limited by email and IP address. Sessions are stored on the server; production cookies use `Secure`, `HttpOnly`, and `SameSite=Lax`. Browser mutations are protected by CSRF checks. Store MCP secrets separately from source code.

To change passwords, securely back up your configuration, remove the local configuration files, run `pnpm auth:setup` again, and update the `AUTH_USERS` secret. Changing a password **does not revoke existing sessions or MCP tokens**. To sign out all members and revoke tokens, run this command against the intended database:

```sh
pnpm --filter @homehub/api exec wrangler d1 execute DB --remote --command="DELETE FROM sessions; DELETE FROM api_tokens; DELETE FROM oauth_codes; DELETE FROM oauth_requests;"
```

To disable a member, remove their email from `AUTH_USERS`, update the secret, and revoke their access. Keep their financial history intact. Each member manages their own MCP tokens; the deployment administrator manages login accounts through `AUTH_USERS`.

Back up D1 before updating. For example, export the database into the ignored `secrets/` directory and store the backup securely:

```sh
pnpm --filter @homehub/api exec wrangler d1 export DB --remote --output=../../secrets/backup.sql
```

Backups contain your data. Do not upload them to Git or public issues. Losing the local `.wrangler` files removes your local database; it does not reset the cloud database.

## Development

| Command                             | Purpose                                                                |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `pnpm dev`                          | Run shared types, API, and frontend in development mode                |
| `pnpm build`                        | Build the frontend and dry-run the Worker build without deploying      |
| `pnpm typecheck`                    | Check TypeScript types                                                 |
| `pnpm lint`                         | Run ESLint                                                             |
| `pnpm format` / `pnpm format:check` | Format files / check formatting                                        |
| `pnpm test`                         | Test shared schemas, frontend, and API using the local Workers runtime |
| `pnpm test:e2e`                     | Check login and main pages in a browser; see below                     |
| `pnpm db:check`                     | Check ORM schema and migration compatibility                           |
| `pnpm privacy:check`                | Scan Git files for common secrets and personal addresses               |
| `pnpm release:check`                | Run checks before a release                                            |

The browser smoke test runs against your local instance. Start `pnpm dev`, install Chromium with `pnpm --filter @homehub/web exec playwright install chromium`, and set `E2E_EMAIL` and `E2E_PASSWORD` in the process environment. Then run `pnpm test:e2e`. Use dedicated test accounts and your own server.

```text
apps/web/             React + Vite + Tailwind frontend and tests
apps/api/src/         Hono, household services, authentication, MCP
apps/api/migrations/  Initial SQL migration
packages/shared/      DTOs, Zod schemas, financial calculations
scripts/              Account setup, formatting, publication checks
```

CI configurations for GitHub Actions and GitLab validate the code without accessing your cloud database or deploying automatically. For schema changes, use `pnpm db:generate` and review the SQL manually: financial integrity constraints and triggers must also be preserved.

## Publishing your fork

`.gitignore` excludes local databases, secrets, exports, builds, and logs. Before pushing, run `pnpm privacy:check` and review `git diff --cached`. The automated scanner cannot detect every kind of personal data. Keep real names, addresses, payments, client information, and screenshots of your household out of examples and tests.

HomeHub is distributed under the [MIT License](LICENSE). You can clone, modify, and host your own instance. Suggestions and fixes are welcome; use fictional data when reporting bugs.
