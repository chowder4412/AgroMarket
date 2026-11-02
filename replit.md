# AgroMarket Nigeria

AgroMarket Nigeria connects consumers and business buyers with verified local farmers and suppliers, starting with Lagos-area produce and foodstuff.

## Run & Operate

- Copy `.env.example` to `.env`, replace every placeholder, then export its values in each terminal with `set -a; . ./.env; set +a`.
- Run the API with `PORT=3001 pnpm --filter @workspace/api-server run dev`.
- Run the web app with `PORT=5173 BASE_PATH=/ API_PROXY_TARGET=http://127.0.0.1:3001 pnpm --filter @workspace/agromarket-nigeria run dev`.
- For a separately hosted API, set `VITE_API_BASE_URL` to its origin only (for example `https://api.example.com`); generated API paths already include `/api`. Include the exact frontend origin in `CORS_ORIGINS`. The frontend sends a Clerk bearer token only in this split-origin mode; same-origin deployments continue to use session cookies.
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run generate` — create a migration after schema changes; review and commit the SQL before deployment.
- `pnpm --filter @workspace/db run migrate` — apply committed migrations to a provisioned database.
- `pnpm --filter @workspace/db run push` — development-only schema synchronization. The checked-in `0000` migration is a fresh-database baseline; do not apply it to an existing database without first reconciling its schema and migration history.
- `node --experimental-strip-types --test artifacts/api-server/src/lib/paystack-security.test.mjs` — run payment security and dispute state-machine tests (Node.js 24+).
- Required services: PostgreSQL (`DATABASE_URL`) and Clerk Auth (`CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `VITE_CLERK_PUBLISHABLE_KEY`).
- Optional Paystack: configure `PAYSTACK_SECRET_KEY`, a public `PAYSTACK_CALLBACK_URL`, and the `/api/payments/paystack/webhook` endpoint in the Paystack dashboard. Use test credentials before launch.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19, Vite, Tailwind CSS v4, Wouter, TanStack Query, generated Orval hooks
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Authentication: Clerk; application roles are stored and enforced server-side

## Where things live

- `artifacts/agromarket-nigeria/` — storefront, cart, checkout, seller and admin UI
- `artifacts/api-server/src/routes/` — marketplace API routes
- `lib/api-spec/openapi.yaml` — API source of truth
- `lib/db/src/schema/` — normalized marketplace schema
- `lib/api-client-react/src/generated/` — generated React Query hooks
- `lib/api-zod/src/generated/` — generated request/response validators

## Architecture decisions

- Keep the workspace's PostgreSQL + Drizzle setup; do not introduce a parallel Prisma schema.
- Persist app roles in PostgreSQL and enforce them in API middleware; users cannot self-assign admin.
- Store NGN prices as whole naira integers. Checkout splits a multi-seller cart into seller-specific orders and updates stock atomically.
- Checkout is explicitly sandbox-only and creates a simulated paid order without charging money.

## Product

- Public product catalogue with category, location, search, price sorting, verified-farm spotlights, unit prices, minimum quantities, and wholesale tiers.
- Clerk sign-in with consumer, farmer, supplier, and business-buyer role onboarding; admin is a controlled role.
- Persistent carts, stock-checked sandbox checkout, buyer order history, seller listing/dashboard/fulfilment tools, bulk quotation requests, and seller verification review.
- Seed listings are demo data for Lagos and Ogun. Replace them with real seller inventory before a pilot.

## User preferences

- The intended launch market is Nigeria, with Lagos or Abuja as initial pilot regions.
- Use Nigerian naira and show clear product units such as bags and kilograms.

## Gotchas

- Regenerate API hooks and validators after every OpenAPI change.
- Do not expose live payment processing until a provider is selected and webhook handling is verified. Paystack and Flutterwave are not available as Replit integrations in this workspace.
- New seller listings remain pending until an admin approves the seller verification case.
- No admin account is provisioned by default; assign admin access only through a trusted process.
- This first build does not yet upload seller verification documents or implement dispute management and payment-webhook processing.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
