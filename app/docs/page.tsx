"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MdBook } from "react-icons/md";
import { ArrowLeft, Copy, Check } from "lucide-react";
import { toast } from "sonner";

// --- Types ---
interface Endpoint {
  method: "GET" | "POST";
  path: string;
  description: string;
  auth: boolean;
  body?: string;
  response?: string;
  notes?: string;
}

const endpoints: Endpoint[] = [
  {
    method: "POST",
    path: "/api/v1/download",
    description:
      "Enqueues a Trigger.dev scrape task that resolves every chapter's page image URLs from the source (MangaDex / WeebCentral / scan mirrors) and saves them into the manga / chapters / pages tables. Does NOT download image bytes — that happens client-side after the scrape completes.",
    auth: true,
    body: `{
  "url": "https://mangadex.org/title/<id>/<slug>",
  "source": "mangadex"
}`,
    response: `{ "runId": "run_abc123..." }`,
    notes:
      "source is optional — if omitted, it's inferred from the URL. Valid values: mangadex | weebcentral | manual.",
  },
  {
    method: "GET",
    path: "/api/v1/jobs/:runId",
    description:
      "Polls a Trigger.dev run's status + progress. Used during the scrape stage to show live progress (downloading chapters / resolving pages). Returns mangaId when the scrape completes — the client then fetches URLs and builds the .cbz in-browser.",
    auth: true,
    response: `{
  "id": "run_abc123...",
  "status": "pending|running|completed|failed",
  "progress": 0,
  "mangaName": "Onii-chan wa Oshimai",
  "mangaId": "469b30be-...",
  "chapterCount": 12,
  "stage": "resolving-chapters",
  "statusMessage": "Resolved 3/12 chapters...",
  "downloadUrl": null,
  "filename": null,
  "error": null
}`,
    notes:
      "downloadUrl and filename are always null now (kept for backwards compat). The client-side .cbz builder replaces the old server-side build-cbz flow.",
  },
  {
    method: "GET",
    path: "/api/v1/download/urls?mangaId=:mangaId",
    description:
      "Returns the saved page image URLs for a manga — the data the browser needs to download images and build a .cbz client-side. Requires a download_history row for the requesting user (ownership check).",
    auth: true,
    response: `{
  "mangaId": "469b30be-...",
  "mangaName": "Onii-chan wa Oshimai",
  "chapterCount": 12,
  "totalPages": 240,
  "chapters": [
    {
      "label": "0001",
      "folder": "chapter_0001",
      "imageUrls": [
        "https://uploads.mangadex.org/data/.../001.png",
        "https://uploads.mangadex.org/data/.../002.png"
      ]
    }
  ]
}`,
    notes:
      "The browser fetches each image (direct from CDN for CORS-friendly hosts like uploads.mangadex.org, or through /api/v1/proxy/image for hosts that block CORS), zips them with fflate, and triggers a .cbz download.",
  },
  {
    method: "GET",
    path: "/api/v1/proxy/image?url=:imageUrl",
    description:
      "Authenticated image proxy — exists solely to work around CORS. Browser fetch can't set User-Agent / Referer (forbidden headers), and scan-mirror CDNs (official.lowee.us, scans.lastation.us, etc.) 403/404 bare requests + don't send Access-Control-Allow-Origin. This route fetches upstream with proper headers and streams the body back with CORS headers + a 1-hour browser cache.",
    auth: true,
    response: "Binary image data (image/png, image/webp, etc.)",
    notes:
      "Only used as a fallback — the client tries direct fetch first and only routes through the proxy when a host is known to block CORS (tracked per-host in the browser).",
  },
  {
    method: "GET",
    path: "/api/v1/status",
    description: "Health check endpoint. Returns server status and uptime.",
    auth: false,
    response: `{ "status": "ok", "uptime": 12345 }`,
  },
  {
    method: "GET",
    path: "/api/v1/heartbeat",
    description: "Lightweight heartbeat for monitoring / liveness probes.",
    auth: false,
    response: `{ "ok": true }`,
  },
];

const methodConfig: Record<"GET" | "POST", string> = {
  GET: "text-green-600 bg-green-50 border-green-200",
  POST: "text-blue-600 bg-blue-50 border-blue-200",
};

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success(`${label} copied to clipboard`);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 h-7 w-7"
        onClick={copy}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </Button>
      <pre className="overflow-x-auto rounded-md border bg-muted/50 p-3 pr-10 text-xs">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <MdBook className="h-6 w-6 text-primary" />
            <span className="font-bold text-lg">MDL</span>
            <Badge variant="outline" className="ml-2 text-xs">
              API Docs
            </Badge>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to home
            </Link>
          </Button>
        </div>
      </nav>

      <div className="container mx-auto py-8 space-y-8 max-w-4xl">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">API Documentation</h1>
          <p className="text-muted-foreground mt-2">
            All endpoints are relative to the API base URL. Authentication uses
            NextAuth sessions (cookie-based) — all authenticated endpoints
            require a valid session cookie.
          </p>
        </div>

        {/* Auth info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Authentication</CardTitle>
            <CardDescription>
              How authenticated endpoints verify your identity.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              All endpoints marked with{" "}
              <Badge variant="outline" className="text-xs">
                Auth required
              </Badge>{" "}
              require a valid NextAuth session cookie. Sessions are established
              by signing in via the{" "}
              <Link href="/login" className="text-primary hover:underline">
                login page
              </Link>{" "}
              (email/password or GitHub OAuth).
            </p>
            <p>
              Unauthenticated requests receive a{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                401 Unauthorized
              </code>{" "}
              response. Requests for resources the user doesn&apos;t own receive
              a{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                403 Forbidden
              </code>
              .
            </p>
          </CardContent>
        </Card>

        {/* Endpoints */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Endpoints</h2>

          {endpoints.map((ep) => (
            <Card key={`${ep.method}-${ep.path}`}>
              <CardHeader>
                <div className="flex items-center gap-3 flex-wrap">
                  <Badge
                    variant="outline"
                    className={`text-xs font-mono ${methodConfig[ep.method]}`}
                  >
                    {ep.method}
                  </Badge>
                  <code className="text-sm font-medium">{ep.path}</code>
                  {ep.auth ? (
                    <Badge variant="outline" className="text-xs">
                      Auth required
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-xs text-muted-foreground"
                    >
                      Public
                    </Badge>
                  )}
                </div>
                <CardDescription className="mt-2">
                  {ep.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {ep.body && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      Request body
                    </p>
                    <CodeBlock code={ep.body} label="Request body" />
                  </div>
                )}
                {ep.response && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      Response
                    </p>
                    <CodeBlock code={ep.response} label="Response" />
                  </div>
                )}
                {ep.notes && (
                  <p className="text-xs text-muted-foreground border-l-2 border-primary/30 pl-3">
                    {ep.notes}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Architecture overview */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Download flow</CardTitle>
            <CardDescription>
              How a manga download works end-to-end.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">1. Scrape</span> —
              POST /api/v1/download enqueues a Trigger.dev task that scrapes the
              source (MangaDex API / WeebCentral HTML / scan mirrors) and saves
              every chapter&apos;s page image URLs to Postgres. No image bytes
              are fetched server-side.
            </p>
            <p>
              <span className="font-medium text-foreground">2. Poll</span> — The
              client polls GET /api/v1/jobs/:runId every 2.5s for live progress.
              When status becomes completed, the response includes mangaId.
            </p>
            <p>
              <span className="font-medium text-foreground">3. Fetch URLs</span>{" "}
              — The client calls GET /api/v1/download/urls?mangaId=... to get
              the saved page URLs.
            </p>
            <p>
              <span className="font-medium text-foreground">
                4. Download + zip
              </span>{" "}
              — The browser downloads each image (direct from CDN for
              CORS-friendly hosts, or through /api/v1/proxy/image for hosts that
              block CORS), zips them with fflate (store-only), and triggers a
              .cbz download via a Blob URL. The server never assembles or stores
              the archive.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
