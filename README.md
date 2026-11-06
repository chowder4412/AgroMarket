# Agrikulture

Agrikulture connects consumers and business buyers with verified local farmers and suppliers, starting with Lagos-area produce and foodstuff.

## Requirements

- Node.js 24
- pnpm 12
- PostgreSQL; Supabase is supported

Use the Supabase Session Pooler connection string on port `5432`. The payment expiry worker uses session-level advisory locks, which are not supported by the transaction pooler on port `6543`.

## Local Development

1. Add your local credentials to the ignored `.env` file. Use `.env.example` as the key list; keep Paystack secret keys server-side and use test keys during development.
2. Install dependencies with `pnpm install`.
3. Run `pnpm dev` from the repository root. The frontend is at `http://localhost:5173` and the API is at `http://localhost:3001`.

The root development command loads `.env` before starting both services. Do not commit `.env`.

## Build And Tests

- `pnpm run typecheck` checks the workspace.
- `pnpm run build` typechecks and builds the applications and API.
- `pnpm --filter @workspace/api-server run test` runs API unit tests.
- `node --experimental-strip-types --test artifacts/api-server/src/lib/paystack-security.test.mjs` runs the API unit tests directly (Node.js 24+).

## Database

- `pnpm --filter @workspace/db run generate` creates a migration after schema changes. Review and commit the generated SQL.
- `pnpm --filter @workspace/db run migrate` applies committed migrations to the database. The checked-in baseline is intended for a fresh database; back up and reconcile an existing database before applying it.
- `pnpm --filter @workspace/db run push` is for development-only schema synchronization.

## Production Configuration

Deploy the frontend static build and the API Node.js service, routing `/api` to the API. Configure `DATABASE_URL`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, and `CORS_ORIGINS` in the hosting provider's secret manager. Set `CORS_ORIGINS` to the exact frontend origin when frontend and API are on separate origins.

For checkout, configure the matching Paystack public and secret keys, then register `/api/payments/paystack/webhook` in the Paystack dashboard. Use test credentials until checkout and webhook verification have been tested end to end.

## Project Structure

- `artifacts/agromarket-nigeria/` — storefront, cart, checkout, seller and admin UI
- `artifacts/api-server/src/routes/` — marketplace API routes
- `lib/api-spec/openapi.yaml` — API source of truth
- `lib/db/src/schema/` — database schema
- `lib/api-client-react/src/generated/` — generated React Query hooks
- `lib/api-zod/src/generated/` — generated request/response validators

Regenerate API hooks and validators after changing the OpenAPI specification. Seller listings remain pending until an admin approves the seller verification case; no admin account is provisioned by default.