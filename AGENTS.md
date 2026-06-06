<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Manga Downloader — HTTP API Routes (CLI → API)

The project's CLI behavior can be exposed as HTTP endpoints. Below are recommended routes, request bodies, and behaviors to replace CLI invocations with API calls.

### POST /api/v1/download
- Purpose: start a generic download job (auto-detects source: MangaDex, WeebCentral, or generic image hosts).
- Body (JSON):
  - `manga` (string, required): manga name or URL
  - `start_chapter` (int, default=1)
  - `start_page` (int, default=1)
  - `max_pages` (int, default=50)
  - `workers` (int, default=10)
  - `cbz` (bool, default=true)
  - `clean_output` (bool, default=false)
  - `md_lang` (string, default="en")
  - `dev` (bool, default=false)
- Behavior: detects source and invokes the matching flow (MangaDex / WeebCentral / generic gather→download).
- Response: `202 Accepted` with job id for async processing, or `200 OK` with summary when executed synchronously.

### POST /api/v1/download/mangadex
- Purpose: MangaDex-specific download using the MangaDex API.
- Body: `{ "url": "<mangadex title url>", "lang": "en", "use_saver": false, "create_cbz": true }`
- Behavior: mirrors `download_md_chapters()` semantics and records metadata in DB.

### POST /api/v1/download/weebcentral
- Purpose: extract image URLs via Playwright from a WeebCentral page and download them.
- Body: `{ "url": "<weebcentral url>", "start_page": 1, "max_pages": 50, "workers": 10, "cbz": true }`

### POST /api/v1/gather
- Purpose: probe configured hosts and return available page URLs (no download).
- Body: `{ "manga": "<slug>", "start_chapter": 1, "start_page": 1, "max_pages": 50, "workers": 10 }`
- Response: JSON array of `{ "url": "...", "folder": "chapter_xxx" }`.

### POST /api/v1/cbz
- Purpose: create CBZ for an existing manga folder.
- Body: `{ "folder": "<folder name>", "delete_subfolders": true }`
- Response: `{ "cbz_path": "..." }`.

### POST /api/v1/auto-update
- Purpose: run DB-driven auto-update across tracked manga (download only new chapters).
- Body: `{ "workers": 10, "start_page": 1, "max_pages": 50, "cbz": true }`
- Behavior: mirrors `_auto_update_from_db()`.

### GET /api/v1/tracked
- Purpose: list tracked manga entries and metadata (maps to `get_tracked_manga()`).

### POST /api/v1/tracked/record
- Purpose: manually record a download result.
- Body: `{ "manga_name": "...", "latest_chapter_local": 1.2, "latest_chapter_from_mangadex": 1.2 }` → calls `record_download()`.

### POST /api/v1/stop
- Purpose: set a global stop flag to gracefully interrupt running jobs (maps to SIGINT handling in CLI).

### GET /api/v1/status
- Purpose: return service status, config defaults, and current `clean`/`dev` modes.

Notes:
- Use async job processing (return `202` and provide job status endpoints) rather than blocking HTTP handlers during downloads.
- Propagate `clean_output`/`dev` flags into modules so logs and progress are appropriate for an HTTP server.
- Run heavy tasks (Playwright, MangaDex fetches) in background workers to avoid blocking the web server.

Implementation pointers: core logic is in `mdl/main.py` and `src/` (scrapers, downloader, cbz, database). I can scaffold a minimal FastAPI wrapper that exposes these routes and enqueues background jobs if you want.
