# Manga Downloader API

The API is served by the Next.js app at `http://localhost:3000/api/v1` when you run the website with `pnpm run server`.

## Overview

The API exposes the current backend as Next.js route handlers. The main workflow is asynchronous for download operations:

1. Submit a request to start a job.
2. Receive a `jobId` immediately.
3. Poll the job status endpoint until the job finishes.

## Endpoints

### `POST /api/v1/download`

Start a download job and let the server auto-detect the source.

Request body:

```json
{
  "manga": "Spy x Family",
  "start_chapter": 1,
  "start_page": 1,
  "max_pages": 50,
  "workers": 5,
  "cbz": true,
  "md_lang": "en",
  "outDir": "optional-output-folder"
}
```

Behavior:

- If `manga` looks like a MangaDex URL or UUID, the server uses the MangaDex flow.
- If `manga` contains `weebcentral`, the server uses the WeebCentral flow.
- Otherwise the server uses the generic image-host gathering flow.

Response:

```json
{
  "jobId": "kq0xgk-8f3a1b"
}
```

Status code: `202 Accepted`

### `POST /api/v1/gather`

Probe the configured image hosts and return matching image URLs without downloading them.

Request body:

```json
{
  "manga": "Spy x Family",
  "start_chapter": 1,
  "start_page": 1,
  "max_pages": 50
}
```

Response:

```json
{
  "urls": [["https://example.com/.../0001-001.png", "chapter_0001"]]
}
```

### `POST /api/v1/cbz`

Create a CBZ archive from an existing folder.

Request body:

```json
{
  "folder": "Spy x Family"
}
```

Response:

```json
{
  "cbz": "/absolute/path/to/Spy x Family/Spy x Family.cbz"
}
```

### `GET /api/v1/tracked`

Return tracked manga records stored by the backend.

Response:

```json
{
  "tracked": []
}
```

### `POST /api/v1/tracked`

Store a tracked manga record manually.

Request body:

```json
{
  "manga_name": "Spy x Family",
  "latest_chapter_local": 12,
  "latest_chapter_from_mangadex": 12
}
```

Response:

```json
{
  "ok": true
}
```

### `GET /api/v1/status`

Return the current in-memory job list and a simple status flag.

Response:

```json
{
  "status": "ok",
  "jobs": []
}
```

### `POST /api/v1/stop`

Set the global stop flag used by the backend helpers.

Response:

```json
{
  "stopped": true
}
```

### `GET /api/v1/jobs/:id`

Fetch the current status and result for a background job.

Response examples:

```json
{
  "id": "kq0xgk-8f3a1b",
  "status": "running",
  "payload": {
    "manga": "Spy x Family"
  },
  "result": null,
  "error": null
}
```

or:

```json
{
  "id": "kq0xgk-8f3a1b",
  "status": "finished",
  "payload": {
    "manga": "Spy x Family"
  },
  "result": {
    "downloaded": 120,
    "folder": "Spy x Family"
  },
  "error": null
}
```

## Common workflow

1. Start the server:

```bash
pnpm run server
```

2. Kick off a download job:

```bash
curl -X POST http://localhost:3000/api/v1/download \
  -H 'Content-Type: application/json' \
  -d '{"manga":"Spy x Family","cbz":true}'
```

3. Poll the returned job ID:

```bash
curl http://localhost:3000/api/v1/jobs/kq0xgk-8f3a1b
```

## Notes

- The job store is currently in-memory, so jobs are lost when the server restarts.
- CBZ creation uses the backend helper currently wired into the app.
- The WeebCentral worker is still a placeholder in the current implementation.
- The tracked manga store is currently JSON-based, not SQLite.
