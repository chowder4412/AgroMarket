# AgroMarket Nigeria

AgroMarket Nigeria connects consumers and business buyers with verified local farmers and suppliers, starting with Lagos-area produce and foodstuff.

## Run & Operate

- `pnpm --filter @workspace/agromarket-nigeria run dev` — run the marketplace web app
- `pnpm --filter @workspace/api-server run dev` — run the shared API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — apply Drizzle schema changes to the development database
- Required environment: Replit PostgreSQL (`DATABASE_URL`) and Clerk Auth (provisioned through the Auth pane)

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
