# UI/UX Auditor

A TypeScript monorepo starter for the UI/UX Auditor MVP described in the project PRD/TRD. This is **Stage 1 foundation work**, not a functioning audit product yet.

## Architecture

- `apps/web`: Next.js frontend shell.
- `apps/api`: NestJS API with a versioned health endpoint.
- PostgreSQL: relational records plus JSONB evidence snapshots (not yet wired into the API).
- Redis + BullMQ: asynchronous audit jobs (services can be started locally; queue integration comes later).
- Playwright: website capture (not implemented yet).

## Prerequisites

- Node.js 20 or newer
- npm 10 or newer recommended
- Docker Engine + Docker Compose plugin (for local PostgreSQL and Redis)

## Setup

1. Copy `.env.example` to `.env` and review the values. The included database password is for local development only.
2. Install dependencies from the repository root:

   ```bash
   npm install
   ```

3. Start local infrastructure:

   ```bash
   docker compose up -d
   ```

4. Start the API in one terminal:

   ```bash
   npm run dev:api
   ```

5. Start the frontend in another terminal:

   ```bash
   npm run dev:web
   ```

6. Verify the API health endpoint:

   ```bash
   curl http://localhost:4000/api/v1/health
   ```

   Expected response includes `"status":"ok"`.

7. Open `http://localhost:3000` for the frontend shell.

## Current implementation status

- [x] Monorepo foundation (npm workspaces)
- [x] Next.js landing/dashboard placeholder
- [x] NestJS modular API scaffold
- [x] API prefix `/api/v1`
- [x] Health endpoint and unit test
- [x] Local PostgreSQL + Redis Compose services
- [ ] Auth and session/JWT lifecycle
- [ ] Database schema and migrations
- [ ] Audit CRUD and ownership checks
- [ ] BullMQ job orchestration
- [ ] Sandboxed Playwright capture and SSRF protections
- [ ] Deterministic accessibility/visual checks
- [ ] AI analysis and evidence grounding
- [ ] Aggregation and report generation

## Security status — important

This starter is for local development. It is **not safe to expose publicly**. Authentication, authorization, rate limiting, SSRF/DNS-rebinding protection, browser isolation, and production secrets management are not implemented yet. Do not enable arbitrary URL capture until the security controls in `SECURITY.md` are implemented and tested.

## Project constraints

Follow the uploaded project specifications: deterministic checks for standards-defined thresholds; AI only for qualitative judgment; evidence-grounded findings; confidence tiers; rule-anchored severity; partial reports when AI analysis fails but deterministic checks succeed. MVP scope is a single URL, one page, one viewport.
