# TypeScript monorepo, static web app, and a thin API for credentials only

Forge is a TypeScript pnpm monorepo with three packages: `packages/core` (the domain model, dialects, and SQL parse/generate), `apps/web` (React + Vite, deployed to Vercel as a static bundle), and `apps/api` (a thin HTTP service on Render that owns authentication and the database connection string). `@forge/core` has no React and no platform dependencies, so the same package runs in the browser and on the API. The canvas, the SQL parser, and the DDL generator all run client-side; the API is never in the interactive path.

## Consequences

**`@forge/core` must stay platform-free.** It may not import React, `fetch`, or DOM globals. This is what lets the same code run in both places, and it is a load-bearing constraint rather than a stylistic one: adding a `window` reference to the parser to reach for a browser-only library would force a server-side rewrite of the generator. Enforce it through `packages/core`'s own `tsconfig`, not by convention.

**A backend exists because credentials must not ship in the browser bundle, not because the core needs a server.** SQL parsing and DDL generation are pure computation. Running them server-side would add a network round-trip to every modelling interaction and expose the user to Render's free-tier spin-down (15 minutes idle, roughly a minute to wake). Keeping the core client-side means the API is called only on login and on save, so cold starts are paid once per session instead of once per interaction.

**Next.js was rejected specifically because the API lives on Render.** The two facts are mutually dependent. With an API on Render, a Vite static bundle is the only front-end choice that does not duplicate or contradict it: Next would either supply its own API routes and make Render redundant, or sit beside a second backend in charge of auth, doubling the surface. If the backend ever moves into Next's API routes, delete `apps/api` and switch the front end in one change.

**Render Postgres is excluded.** Free Render Postgres instances expire 30 days after creation, measured from creation rather than from inactivity, and the data is then inaccessible. `apps/api` targets Neon instead, which scales to zero without becoming inaccessible. Supabase was the alternative and was rejected because free projects pause after 7 days of inactivity, which would strand a personal project between visits.

**Multi-user is explicitly out of MVP scope.** The backend is justified today by credential protection, which is a present requirement. User accounts, ownership, and shared projects belong to the longer-term roadmap and must not pull auth work into the first vertical slice.