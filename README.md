# MDL — Manga Download Library (dev)

MDL is a web app for pulling manga chapters from multiple sources (MangaDex, WeebCentral, and manual scan-mirror URLs) into a single dashboard, then packaging them into a `.cbz` file you download straight from your browser.

This is the **dev** branch — it tracks the `main` branch's core functionality plus in-progress work: a persisted job queue, dashboard sub-pages, and an automated test suite.

## How it works

1. **Scrape** — `POST /api/v1/download` enqueues a [Trigger.dev](https://trigger.dev) background task that resolves every chapter's page image URLs from the source and saves them to Postgres (via Supabase). No image bytes are fetched server-side.
2. **Poll** — the dashboard polls `GET /api/v1/jobs/:runId` for live progress while the scrape runs. `GET /api/v1/jobs` returns the user's full saved job queue/history (queued, running, completed, failed), refreshed against live Trigger.dev status, so the dashboard survives a closed/reopened tab.
3. **Fetch URLs** — once the scrape completes, the client calls `GET /api/v1/download/urls?mangaId=...` to get the saved page URLs.
4. **Download + zip** — the browser downloads each image (directly from the CDN, or through `/api/v1/proxy/image` for hosts that block CORS), zips them client-side with `fflate`, and triggers a `.cbz` download via a Blob URL. The server never assembles or stores the archive — page images are proxied straight to the browser and never touch app storage.

This background-task approach means a large, multi-chapter download doesn't time out the way a single serverless request would.

Full endpoint reference (request/response shapes, auth requirements) is available at `/docs` once the app is running.

## What's new vs. `main`

- **Persisted job queue** — download jobs are written to a `download_jobs` table (see `supabase/migrations/`) with row-level security scoped per user, so queue/history state survives page reloads instead of living only in Trigger.dev.
- **`GET /api/v1/jobs`** — new endpoint returning the current user's full job list.
- **`/api/v1/preferences`** — endpoint backing a new dashboard preferences page.
- **Dashboard sub-pages:**
  - `/dashboard/health` — backlog / freshness overview across tracked manga.
  - `/dashboard/behind` — titles that need a download pass, ordered by chapter gap.
  - `/dashboard/preferences` — account settings, password change, and app defaults (download/update-check behavior, dashboard density).
  - `/dashboard/sources` — a guide to supported source URLs and how they're classified.
- **`lib/dashboard.ts` / `lib/preferences.ts`** — supporting data/logic for the pages above.
- **Automated tests** — Vitest + Testing Library + jsdom covering backend utils, download logic, auth, preferences, and dashboard helpers.
- Minor dependency bumps (`@trigger.dev/sdk`, `@trigger.dev/build`, `trigger.dev`) and an added `@sentry/esbuild-plugin` dependency.

## Tech stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript
- **Styling:** Tailwind CSS 4, Radix UI / shadcn-style components
- **Auth:** NextAuth (credentials + GitHub OAuth)
- **Database / Auth backend:** Supabase (Postgres, `@supabase/ssr`, SQL migrations in `supabase/`)
- **Background jobs:** Trigger.dev
- **Error tracking:** Sentry
- **Analytics:** Vercel Analytics
- **Client-side archiving:** `fflate` (zip), `cheerio`/`axios` for scraping
- **Testing:** Vitest, Testing Library, jsdom

## Project structure

```
app/
  api/v1/           # REST endpoints (download, jobs, jobs/:id, preferences, proxy, status, heartbeat, auth, resolveManual, mangadex/cover)
  backend/          # Scraping + Supabase logic per source
    mangadex/
    weebcentral/
    manual/
    downloadLogicForManualAndWeebcentral/
    supabaseFunctions/
  src/trigger/       # Trigger.dev background task(s)
  dashboard/         # User dashboard
    _components/      # Shared dashboard shell
    health/, behind/, preferences/, sources/
  docs/               # In-app API documentation page
  login/, register/, forgot-password/, reset-password/
lib/
  supabase/           # Supabase client/server/middleware helpers
  client/             # Client-side .cbz builder
  dashboard.ts         # Dashboard data helpers
  preferences.ts       # User preferences helpers
  auth.ts, get-session.ts, animations.ts, utils.ts
components/           # Shared UI components
supabase/migrations/   # SQL schema migrations (download_jobs table, RLS policies)
tests/                 # Vitest test suite
```

## Getting started

### Prerequisites

- Node.js and [pnpm](https://pnpm.io/) (`packageManager: pnpm@11.16.0`)
- A [Supabase](https://supabase.com/) project (Postgres + Auth) — apply the migrations in `supabase/migrations/`
- A [Trigger.dev](https://trigger.dev/) project
- (Optional) A GitHub OAuth app, if you want GitHub sign-in
- (Optional) A Sentry project, for error tracking

### Install

```bash
pnpm install
```

### Environment variables

Create a `.env.local` with:

```bash
# NextAuth
AUTH_SECRET=
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000

# GitHub OAuth (optional, for GitHub login)
GITHUB_ID=
GITHUB_SECRET=

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Trigger.dev
TRIGGER_PROJECT_ID=

# Sentry (optional)
NEXT_PUBLIC_SENTRY_RELEASE=
SENTRY_RELEASE=
SENTRY_AUTH_TOKEN=
```

### Database setup

Apply the SQL migration(s) in `supabase/migrations/` to your Supabase project (via the Supabase CLI or SQL editor) before running the app — the job queue endpoints depend on the `download_jobs` table.

### Run

```bash
pnpm dev                 # Next.js dev server only
pnpm start_fe_and_be      # Next.js dev server + Trigger.dev dev worker, together
```

The app runs at `http://localhost:3000`.

### Testing

```bash
pnpm test        # run the Vitest suite once
pnpm test:run     # same as above
```

### Other scripts

| Script | Purpose |
|---|---|
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm lint` / `pnpm lint:fix` | ESLint |
| `pnpm format` | Prettier |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm doctor` | Run `react-doctor` |

## Notes

- Only NextAuth session data, job/manga/chapter metadata, and user preferences are persisted server-side — raw page images are never stored or proxied through app storage beyond the CORS-fallback image proxy.
- Source is inferred from the submitted URL if not explicitly specified when enqueuing a download.
- `download_jobs` rows are protected by row-level security so users can only read/write their own jobs.
