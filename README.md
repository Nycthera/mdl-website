# MDL — Manga Download Library

MDL is a web app for pulling manga chapters from multiple sources (MangaDex, WeebCentral, and manual scan-mirror URLs) into a single dashboard, then packaging them into a `.cbz` file you download straight from your browser.

## How it works

1. **Scrape** — `POST /api/v1/download` enqueues a [Trigger.dev](https://trigger.dev) background task that resolves every chapter's page image URLs from the source and saves them to Postgres (via Supabase). No image bytes are fetched server-side.
2. **Poll** — the dashboard polls `GET /api/v1/jobs/:runId` for live progress while the scrape runs.
3. **Fetch URLs** — once the scrape completes, the client calls `GET /api/v1/download/urls?mangaId=...` to get the saved page URLs.
4. **Download + zip** — the browser downloads each image (directly from the CDN, or through `/api/v1/proxy/image` for hosts that block CORS), zips them client-side with `fflate`, and triggers a `.cbz` download via a Blob URL. The server never assembles or stores the archive — page images are proxied straight to the browser and never touch app storage.

This background-task approach means a large, multi-chapter download doesn't time out the way a single serverless request would.

Full endpoint reference (request/response shapes, auth requirements) is available at `/docs` once the app is running.

## Tech stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript
- **Styling:** Tailwind CSS 4, Radix UI / shadcn-style components
- **Auth:** NextAuth (credentials + GitHub OAuth)
- **Database / Auth backend:** Supabase (Postgres, `@supabase/ssr`)
- **Background jobs:** Trigger.dev
- **Error tracking:** Sentry
- **Analytics:** Vercel Analytics
- **Client-side archiving:** `fflate` (zip), `cheerio`/`axios` for scraping

## Project structure

```
app/
  api/v1/           # REST endpoints (download, jobs, proxy, status, heartbeat, auth)
  backend/          # Scraping + Supabase logic per source
    mangadex/
    weebcentral/
    manual/
    downloadLogicForManualAndWeebcentral/
    supabaseFunctions/
  src/trigger/       # Trigger.dev background task(s)
  dashboard/         # User dashboard (queue + history)
  docs/               # In-app API documentation page
  login/, register/, forgot-password/, reset-password/
lib/
  supabase/           # Supabase client/server/middleware helpers
  client/             # Client-side .cbz builder
  auth.ts, get-session.ts, animations.ts, utils.ts
components/           # Shared UI components
```

## Getting started

### Prerequisites

- Node.js and [pnpm](https://pnpm.io/) (`packageManager: pnpm@11.16.0`)
- A [Supabase](https://supabase.com/) project (Postgres + Auth)
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
```

### Run

```bash
pnpm dev                 # Next.js dev server only
pnpm start_fe_and_be      # Next.js dev server + Trigger.dev dev worker, together
```

The app runs at `http://localhost:3000`.

### Other scripts

| Script | Purpose |
|---|---|
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm lint` / `pnpm lint:fix` | ESLint |
| `pnpm format` | Prettier |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm doctor` | Run `react-doctor` |

## Notes

- Only NextAuth session data and manga/chapter metadata are persisted server-side — raw page images are never stored or proxied through app storage beyond the CORS-fallback image proxy.
- Source is inferred from the submitted URL if not explicitly specified when enqueuing a download.
