"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { MdBook } from "react-icons/md";
import {
  Download,
  RefreshCw,
  Search,
  MoreHorizontal,
  CheckCircle2,
  AlertCircle,
  Clock,
  Library,
  Activity,
  Archive,
  LogOut,
  Plus,
  Loader2,
  Settings,
  ArrowUpDown,
  Command,
  X,
} from "lucide-react";
import { CommandPalette } from "@/components/command-palette";

import {
  getMangaLibrary,
  getMangaStats,
  type Manga,
} from "@/app/backend/supabaseFunctions/getMangaInfo/getMangaInfo";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { defineTypeOfURL } from "@/app/backend/utils";
import { buildAndDownloadCbz } from "@/lib/client/build-cbz-in-browser";
import {
  formatDashboardDate,
  getMangaStatus,
  summarizeLibrary,
} from "@/lib/dashboard";
import { Skeleton } from "@/components/ui/skeleton";

// --- Types ---
type Source = "mangadex" | "manual" | "weebcentral";

interface Job {
  /** Trigger.dev run id — used as the polling key. */
  id: string;
  manga: string;
  chapters: string;
  status: "running" | "queued" | "done" | "failed";
  progress: number;
  source: Source;
  /** Short live-status line, e.g. current page / download speed */
  detail?: string;
  /** Estimated time remaining, e.g. "~1m left" */
  eta?: string;
}

interface JobApiResponse {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
  mangaName?: string | null;
  mangaId?: string | null;
  chapterCount?: number | null;
  downloadUrl?: string | null;
  filename?: string | null;
  error?: string | null;
  stage?: string | null;
  statusMessage?: string | null;
  source: Source;
  url: string;
}

interface JobListResponse {
  jobs: JobApiResponse[];
}

interface Stats {
  total: number;
  upToDate: number;
  behind: number;
}

const sourceConfig: Record<Source, { label: string; className: string }> = {
  mangadex: {
    label: "MangaDex",
    className: "text-orange-600 bg-orange-50 border-orange-200",
  },
  manual: {
    label: "Manual",
    className: "text-purple-600 bg-purple-50 border-purple-200",
  },
  weebcentral: {
    label: "WeebCentral",
    className: "text-sky-600 bg-sky-50 border-sky-200",
  },
};

const statusConfig = {
  "up-to-date": {
    label: "Up to date",
    icon: CheckCircle2,
    className: "text-green-600 bg-green-50 border-green-200",
  },
  behind: {
    label: "Behind",
    icon: AlertCircle,
    className: "text-amber-600 bg-amber-50 border-amber-200",
  },
  checking: {
    label: "Checking",
    icon: Clock,
    className: "text-muted-foreground bg-muted border-border",
  },
};

const jobStatusConfig = {
  running: "text-blue-600 bg-blue-50 border-blue-200",
  queued: "text-muted-foreground bg-muted border-border",
  done: "text-green-600 bg-green-50 border-green-200",
  failed: "text-destructive bg-destructive/10 border-destructive/20",
};

// API response shape from /api/v1/jobs/:runId
//
// Used for the scrape (download-manga) run only. When that completes, the
// dashboard hands off to buildAndDownloadCbz() which fetches the page URLs
// from /api/v1/download/urls and builds the .cbz entirely in the browser.
//
// `downloadUrl` and `filename` are kept in the shape for backwards
// compatibility but are always null now — the server no longer builds a
// .cbz or uploads anything to Supabase Storage.
interface JobStatusResponse {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
  mangaName?: string | null;
  mangaId?: string | null;
  chapterCount?: number | null;
  downloadUrl?: string | null;
  filename?: string | null;
  error?: string | null;
  stage?: string | null;
  statusMessage?: string | null;
}

// Map API status → local Job.status
function apiToLocalStatus(s: JobStatusResponse["status"]): Job["status"] {
  switch (s) {
    case "pending":
      return "queued";
    case "running":
      return "running";
    case "completed":
      return "done";
    case "failed":
      return "failed";
  }
}

function StatsCardSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-4 rounded-full" />
      </CardHeader>

      <CardContent>
        <Skeleton className="h-8 w-14" />
        <Skeleton className="mt-2 h-3 w-24" />
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const [search, setSearch] = useState("");
  const [manga, setManga] = useState<Manga[]>([]);
  const [stats, setStats] = useState<Stats>({
    total: 0,
    upToDate: 0,
    behind: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newMangaUrl, setNewMangaUrl] = useState("");
  const [isAddingDownload, setIsAddingDownload] = useState(false);
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const runningJobs = jobs.filter(
    (j) => j.status === "running" || j.status === "queued",
  ).length;
  const librarySummary = summarizeLibrary(manga);

  // --- New UI/UX state ---
  const [activeTab, setActiveTab] = useState("overview");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [insightView, setInsightView] = useState<"behind" | "recent">("behind");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [sort, setSort] = useState<{
    key: "name" | "checked" | "status";
    dir: "asc" | "desc";
  }>({ key: "name", dir: "asc" });

  function toggleSort(key: "name" | "checked" | "status") {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  }

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Track polling intervals so we can clean them up.
  const pollersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(
    new Map(),
  );

  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [library, mangaStats] = await Promise.all([
        getMangaLibrary(),
        getMangaStats(),
      ]);
      setManga(library);
      setStats(mangaStats);
    } catch (err) {
      console.error("fetch error:", err);
      Sentry.captureException(err, {
        tags: { phase: "library-load" },
      });
      setError(err instanceof Error ? err.message : "Failed to load library");
    } finally {
      setLoading(false);
    }
  }, []);

  /** Stop polling for a job. */
  const stopPolling = useCallback((jobId: string) => {
    const interval = pollersRef.current.get(jobId);
    if (interval) {
      clearInterval(interval);
      pollersRef.current.delete(jobId);
    }
  }, []);

  /** Poll a job until it completes or fails. */
  const pollJob = useCallback(
    (jobId: string) => {
      // Don't double-poll.
      if (pollersRef.current.has(jobId)) return;

      const interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/v1/jobs/${jobId}`);
          if (!res.ok) {
            // 404 / 401 — stop polling, mark failed.
            stopPolling(jobId);
            setJobs((prev) =>
              prev.map((j) =>
                j.id === jobId
                  ? { ...j, status: "failed", detail: "run not found" }
                  : j,
              ),
            );
            return;
          }

          const data: JobStatusResponse = await res.json();
          const localStatus = apiToLocalStatus(data.status);

          setJobs((prev) =>
            prev.map((j) =>
              j.id === jobId
                ? {
                    ...j,
                    status: localStatus,
                    progress: data.progress,
                    manga: data.mangaName ?? j.manga,
                    chapters: data.chapterCount
                      ? `${data.chapterCount} chapters`
                      : j.chapters,
                    detail:
                      localStatus === "running"
                        ? (data.statusMessage ?? `${data.progress}%`)
                        : localStatus === "failed"
                          ? (data.error ?? "failed")
                          : undefined,
                  }
                : j,
            ),
          );

          if (data.status === "completed") {
            stopPolling(jobId);

            if (data.mangaId) {
              // The scrape (download-manga) run finished — the page URLs
              // are now in the `pages` table. The actual image download +
              // zip happens entirely client-side now: no build-cbz task,
              // no Supabase Storage upload, no signed URL. The browser
              // fetches the URLs from /api/v1/download/urls, downloads
              // every image, zips them with fflate, and saves the .cbz.
              setJobs((prev) =>
                prev.map((j) =>
                  j.id === jobId
                    ? {
                        ...j,
                        status: "running",
                        progress: 0,
                        detail: "Downloading pages in browser...",
                      }
                    : j,
                ),
              );

              // The scrape finished — now the browser takes over to
              // build the .cbz. Drop a breadcrumb so any error during
              // the browser-side download (CORS, CDN 403, OOM during
              // zip) is traceable back to which manga triggered it.
              Sentry.addBreadcrumb({
                category: "download",
                message: `Starting client-side .cbz build for manga ${data.mangaId}`,
                level: "info",
                data: {
                  mangaId: data.mangaId,
                  mangaName: data.mangaName ?? null,
                  chapterCount: data.chapterCount ?? null,
                },
              });

              try {
                const result = await buildAndDownloadCbz(data.mangaId, (p) => {
                  setJobs((prev) =>
                    prev.map((j) =>
                      j.id === jobId
                        ? {
                            ...j,
                            progress: Math.round((p.done / p.total) * 100),
                            detail: p.statusMessage,
                          }
                        : j,
                    ),
                  );
                });

                setJobs((prev) =>
                  prev.map((j) =>
                    j.id === jobId
                      ? {
                          ...j,
                          status: "done",
                          progress: 100,
                          detail:
                            result.failedPages > 0
                              ? `Downloaded ${result.totalPages - result.failedPages}/${result.totalPages} pages`
                              : `Downloaded ${result.totalPages} pages`,
                        }
                      : j,
                  ),
                );

                if (result.failedPages > 0) {
                  toast.warning(
                    `Downloaded "${result.filename}" with ${result.failedPages} missing page(s)`,
                  );
                } else {
                  toast.success(`Downloaded "${result.filename}"`);
                }
              } catch (err) {
                // The browser-side .cbz build threw — capture with
                // context so the Sentry event includes the manga id,
                // not just the generic "HTTP 403" message.
                Sentry.captureException(err, {
                  tags: { phase: "client-cbz-build" },
                  extra: {
                    mangaId: data.mangaId,
                    mangaName: data.mangaName ?? null,
                  },
                });
                setJobs((prev) =>
                  prev.map((j) =>
                    j.id === jobId
                      ? {
                          ...j,
                          status: "failed",
                          detail:
                            err instanceof Error ? err.message : String(err),
                        }
                      : j,
                  ),
                );
                toast.error(
                  err instanceof Error
                    ? err.message
                    : "Failed to build archive in browser",
                );
              }
            }
          } else if (data.status === "failed") {
            stopPolling(jobId);
            toast.error(`Download failed: ${data.error ?? "unknown error"}`);
          }
        } catch {
          // Network blip — keep polling, the interval will retry.
        }
      }, 2500);

      pollersRef.current.set(jobId, interval);
    },
    [stopPolling],
  );

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/jobs");
      if (!res.ok) {
        throw new Error("Failed to load download jobs");
      }

      const data: JobListResponse = await res.json();
      setJobs(
        data.jobs.map((job) => ({
          id: job.id,
          manga: job.mangaName ?? "Preparing download...",
          chapters: job.chapterCount ? `${job.chapterCount} chapters` : "",
          status: apiToLocalStatus(job.status),
          progress: job.progress,
          source: job.source,
          detail:
            job.status === "running"
              ? (job.statusMessage ?? `${job.progress}%`)
              : job.status === "failed"
                ? (job.error ?? "failed")
                : undefined,
        })),
      );

      data.jobs.forEach((job) => {
        const localStatus = apiToLocalStatus(job.status);
        if (localStatus === "running" || localStatus === "queued") {
          pollJob(job.id);
        }
      });
    } catch (err) {
      console.error("fetch jobs error:", err);
      Sentry.captureException(err, {
        tags: { phase: "job-load" },
      });
    }
  }, [pollJob]);

  // Clean up all pollers on unmount.
  useEffect(() => {
    const pollers = pollersRef.current;
    return () => {
      pollers.forEach((interval) => clearInterval(interval));
      pollers.clear();
    };
  }, []);

  async function handleAddDownload(e: React.FormEvent) {
    e.preventDefault();
    const trimmedUrl = newMangaUrl.trim();
    const typeOfSource = defineTypeOfURL(trimmedUrl);

    if (!typeOfSource) {
      toast.error("Unsupported URL type");
      return;
    }

    setIsAddingDownload(true);
    // Temporary id until the API returns the real runId.
    const tempId = `temp-${crypto.randomUUID()}`;

    // Drop a breadcrumb at the start of every download attempt. If the
    // job later fails in the scraping stage (Trigger.dev), the Sentry
    // error event will include this breadcrumb — invaluable for
    // answering "what URL did the user try to download?" without
    // having to dig through Trigger.dev logs.
    Sentry.addBreadcrumb({
      category: "download",
      message: `Enqueued download for ${trimmedUrl}`,
      level: "info",
      data: { source: typeOfSource, url: trimmedUrl },
    });

    try {
      // Optimistically add a queued job.
      setJobs((prev) => [
        {
          id: tempId,
          manga: "Preparing download...",
          chapters: "",
          status: "queued",
          progress: 0,
          source: typeOfSource,
        },
        ...prev,
      ]);

      // Enqueue — the server starts the Trigger task and returns the
      // run id immediately. No more 5-minute waits.
      const res = await fetch("/api/v1/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: trimmedUrl,
          source: typeOfSource,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to start download");
      }

      const { runId } = await res.json();

      // Swap the temp id for the real run id and start polling.
      setJobs((prev) =>
        prev.map((j) =>
          j.id === tempId
            ? { ...j, id: runId, status: "running", detail: "starting..." }
            : j,
        ),
      );
      pollJob(runId);

      // Clear the input — the job is now tracked in the queue.
      setNewMangaUrl("");
      setAddDialogOpen(false);
      toast.success("Added to download queue");
    } catch (err) {
      console.error(err);
      toast.error(
        err instanceof Error ? err.message : "Failed to start download",
      );
      setJobs((prev) =>
        prev.map((j) =>
          j.id === tempId ? { ...j, status: "failed", detail: String(err) } : j,
        ),
      );
    } finally {
      setIsAddingDownload(false);
    }
  }

  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  // Mirror the server-side Sentry user tagging on the client.
  //
  // The server tags events via the NextAuth session callback in
  // lib/auth.ts, but client-side errors (thrown in this component,
  // in build-cbz-in-browser.ts, etc.) wouldn't be user-tagged without
  // this — the server and client Sentry scopes are independent.
  //
  // We clear the user on sign-out so events raised after a logout
  // (e.g. an error in the login page redirect) aren't mis-attributed.
  useEffect(() => {
    if (status === "authenticated" && session?.user) {
      Sentry.setUser({
        id: session.user.id,
        email: session.user.email ?? undefined,
        username: session.user.name ?? undefined,
      });
    } else if (status === "unauthenticated") {
      Sentry.setUser(null);
    }
  }, [status, session]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const filtered = manga.filter((m) =>
    m.manga_name.toLowerCase().includes(search.toLowerCase()),
  );

  const sortedFiltered = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sort.key === "name") {
      cmp = a.manga_name.localeCompare(b.manga_name);
    } else if (sort.key === "checked") {
      cmp = a.date_last_checked - b.date_last_checked;
    } else {
      cmp = getMangaStatus(a).localeCompare(getMangaStatus(b));
    }
    return sort.dir === "asc" ? cmp : -cmp;
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <MdBook className="h-6 w-6 text-primary" />
            <span className="font-bold text-lg">MDL</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="hidden text-muted-foreground sm:flex"
              onClick={() => setPaletteOpen(true)}
            >
              <Search className="mr-1.5 h-3.5 w-3.5" />
              Search
              <kbd className="ml-2 flex items-center gap-0.5 rounded border border-border px-1 text-[10px] normal-case opacity-70">
                <Command className="h-2.5 w-2.5" />K
              </kbd>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="sm:hidden"
              aria-label="Search"
              onClick={() => setPaletteOpen(true)}
            >
              <Search className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" asChild>
              <Link href="/dashboard/preferences" aria-label="Preferences">
                <Settings className="h-4 w-4" />
              </Link>
            </Button>

            {/* destroy a session */}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              onClick={async () => {
                await signOut({ callbackUrl: "/login" });
              }}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </nav>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        manga={manga.map((m) => ({
          id: m.id,
          name: m.manga_name,
          subtitle: getMangaStatus(m) === "behind" ? "Behind" : "Up to date",
        }))}
        onSelectManga={() => {
          setActiveTab("library");
        }}
        onAddDownload={() => setAddDialogOpen(true)}
        onCheckAllUpdates={loadDashboardData}
      />

      <div className="container mx-auto space-y-6 px-4 py-8">
        {/* Page header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">Dashboard</h1>
            <p className="text-muted-foreground mt-1">
              Track your library, backlog, and download queue from one place.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={loadDashboardData}
              disabled={loading}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Check all for updates</span>
              <span className="sm:hidden">Refresh</span>
            </Button>

            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Add manga
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add to download queue</DialogTitle>
                  <DialogDescription>
                    Paste a MangaDex, manual, or WeebCentral link to queue a new
                    download.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleAddDownload} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="manga-url">Manga / chapter URL</Label>
                    <Input
                      id="manga-url"
                      type="url"
                      placeholder="https://mangadex.org/title/..."
                      value={newMangaUrl}
                      onChange={(e) => setNewMangaUrl(e.target.value)}
                      autoFocus
                      required
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>Supported sources:</span>
                    {Object.values(sourceConfig).map(({ label, className }) => (
                      <Badge
                        key={label}
                        variant="outline"
                        className={`text-xs ${className}`}
                      >
                        {label}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      disabled={isAddingDownload || !newMangaUrl.trim()}
                    >
                      {isAddingDownload ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-2 h-4 w-4" />
                      )}
                      Add to queue
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Compact stat strip — one card, four columns, instead of four
            separate cards. Same information, a fraction of the chrome. */}
        {loading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatsCardSkeleton />
            <StatsCardSkeleton />
            <StatsCardSkeleton />
            <StatsCardSkeleton />
          </div>
        ) : (
          <Card className="py-0">
            <CardContent className="grid grid-cols-2 divide-y divide-border sm:grid-cols-4 sm:divide-x sm:divide-y-0">
              {[
                {
                  label: "Total tracked",
                  value: stats.total,
                  icon: Library,
                  iconClass: "text-muted-foreground",
                },
                {
                  label: "Up to date",
                  value: stats.upToDate,
                  icon: CheckCircle2,
                  iconClass: "text-green-600",
                },
                {
                  label: "Behind",
                  value: stats.behind,
                  icon: AlertCircle,
                  iconClass: "text-amber-600",
                },
                {
                  label: "Active jobs",
                  value: runningJobs,
                  icon: Activity,
                  iconClass: "text-blue-600",
                },
              ].map(({ label, value, icon: Icon, iconClass }) => (
                <div key={label} className="flex flex-col gap-2 px-6 py-5">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Icon className={`h-4 w-4 shrink-0 ${iconClass}`} />
                    <span className="text-xs">{label}</span>
                  </div>
                  <p className="text-2xl font-bold">{value}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Section tabs — Overview / Library / Queue replace what used to be
            nine stacked cards in a single column. */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview">
              <Activity className="h-3.5 w-3.5" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="library">
              <MdBook className="h-3.5 w-3.5" />
              Library
              {stats.total > 0 && (
                <Badge variant="secondary" className="ml-1 px-1.5 py-0">
                  {stats.total}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="queue">
              <Download className="h-3.5 w-3.5" />
              Queue
              {runningJobs > 0 && (
                <Badge variant="secondary" className="ml-1 px-1.5 py-0">
                  {runningJobs}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Overview tab: quick links + backlog/recent insight */}
          <TabsContent value="overview" className="space-y-6">
            <div className="flex flex-wrap gap-2">
              {[
                {
                  href: "/dashboard/health",
                  icon: Activity,
                  title: "Health overview",
                },
                {
                  href: "/dashboard/behind",
                  icon: Archive,
                  title: "Behind titles",
                },
                {
                  href: "/dashboard/sources",
                  icon: Library,
                  title: "Source guide",
                },
                {
                  href: "/dashboard/preferences",
                  icon: Settings,
                  title: "Preferences",
                },
              ].map(({ href, icon: Icon, title }) => (
                <Button key={title} variant="outline" size="sm" asChild>
                  <Link href={href} className="flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5" />
                    {title}
                  </Link>
                </Button>
              ))}
            </div>

            <Card>
              <CardHeader className="space-y-4">
                <div>
                  <CardTitle>
                    {insightView === "behind"
                      ? "Backlog focus"
                      : "Recently checked"}
                  </CardTitle>
                  <CardDescription>
                    {insightView === "behind"
                      ? "The titles with the largest gap between local and source chapters."
                      : "The latest rows that were touched during a refresh."}
                  </CardDescription>
                </div>
                <div className="inline-flex w-fit shrink-0 gap-1 rounded-md border border-border p-0.5">
                  <Button
                    size="xs"
                    variant={insightView === "behind" ? "secondary" : "ghost"}
                    className="rounded-md"
                    onClick={() => setInsightView("behind")}
                  >
                    Behind
                  </Button>

                  <Button
                    size="xs"
                    variant={insightView === "recent" ? "secondary" : "ghost"}
                    className="rounded-md"
                    onClick={() => setInsightView("recent")}
                  >
                    Recent
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {insightView === "behind" ? (
                  librarySummary.mostBehind.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nothing is behind right now.
                    </p>
                  ) : (
                    librarySummary.mostBehind.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-4 rounded-lg border p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {item.manga_name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Checked{" "}
                            {formatDashboardDate(item.date_last_checked)}
                          </p>
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          {item.chapterGap} gap
                        </Badge>
                      </div>
                    ))
                  )
                ) : librarySummary.recentlyChecked.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No library data loaded yet.
                  </p>
                ) : (
                  librarySummary.recentlyChecked.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-4 rounded-lg border p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {item.manga_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Local {item.latest_chapter_local} · Source{" "}
                          {item.latest_chapter_from_mangadex}
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {formatDashboardDate(item.date_last_checked)}
                      </Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Library tab: search, sort, bulk-select, table */}
          <TabsContent value="library" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <MdBook className="h-5 w-5 text-primary" />
                      Manga Library
                    </CardTitle>
                    <CardDescription>
                      All tracked manga and their chapter status.
                    </CardDescription>
                  </div>
                  <div className="relative w-full sm:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search manga..."
                      className="pl-9"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                </div>

                {selectedIds.size > 0 && (
                  <div className="flex items-center gap-3 rounded-md bg-muted px-3 py-2 text-sm">
                    <span className="font-medium">
                      {selectedIds.size} selected
                    </span>
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => {
                        toast.success(
                          `Queued update check for ${selectedIds.size} title(s)`,
                        );
                        loadDashboardData();
                        setSelectedIds(new Set());
                      }}
                    >
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      Check selected
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setSelectedIds(new Set())}
                    >
                      <X className="mr-1 h-3.5 w-3.5" />
                      Clear
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={
                            sortedFiltered.length > 0 &&
                            sortedFiltered.every((m) => selectedIds.has(m.id))
                          }
                          onCheckedChange={(checked) => {
                            setSelectedIds(
                              checked
                                ? new Set(sortedFiltered.map((m) => m.id))
                                : new Set(),
                            );
                          }}
                          aria-label="Select all"
                        />
                      </TableHead>
                      <TableHead>
                        <button
                          className="flex items-center gap-1 hover:text-foreground"
                          onClick={() => toggleSort("name")}
                        >
                          Title
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </TableHead>
                      <TableHead className="hidden md:table-cell">
                        <button
                          className="flex items-center gap-1 hover:text-foreground"
                          onClick={() => toggleSort("checked")}
                        >
                          Last Checked
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </TableHead>
                      <TableHead className="text-center">Local</TableHead>
                      <TableHead className="text-center">MangaDex</TableHead>
                      <TableHead className="text-center">
                        <button
                          className="mx-auto flex items-center gap-1 hover:text-foreground"
                          onClick={() => toggleSort("status")}
                        >
                          Status
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 7 }).map((_, j) => (
                            <TableCell key={j}>
                              <div className="h-4 rounded bg-muted animate-pulse" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : sortedFiltered.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="text-center py-8 text-muted-foreground"
                        >
                          No manga found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      sortedFiltered.map((m) => {
                        const status = getMangaStatus(m);
                        const {
                          label,
                          icon: Icon,
                          className,
                        } = statusConfig[status];
                        return (
                          <TableRow
                            key={m.id}
                            data-state={
                              selectedIds.has(m.id) ? "selected" : undefined
                            }
                          >
                            <TableCell>
                              <Checkbox
                                checked={selectedIds.has(m.id)}
                                onCheckedChange={() => toggleSelected(m.id)}
                                aria-label={`Select ${m.manga_name}`}
                              />
                            </TableCell>
                            <TableCell className="font-medium max-w-50 truncate">
                              {m.manga_name}
                            </TableCell>
                            <TableCell className="hidden md:table-cell text-muted-foreground text-sm">
                              {formatDashboardDate(m.date_last_checked)}
                            </TableCell>
                            <TableCell className="text-center text-sm">
                              {m.latest_chapter_local}
                            </TableCell>
                            <TableCell className="text-center text-sm">
                              {m.latest_chapter_from_mangadex}
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge
                                variant="outline"
                                className={`text-xs gap-1 ${className}`}
                              >
                                <Icon className="h-3 w-3" />
                                {label}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem>
                                    <Download className="mr-2 h-4 w-4" />
                                    Download new chapters
                                  </DropdownMenuItem>
                                  <DropdownMenuItem>
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    Check for updates
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Queue tab: the running/queued/finished job list */}
          <TabsContent value="queue">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Download className="h-5 w-5 text-primary" />
                  Download Queue
                </CardTitle>
                <CardDescription>
                  Running, queued, and finished jobs saved to your account.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {jobs.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-8 text-center">
                    <p className="text-sm text-muted-foreground">
                      No active jobs.
                    </p>
                    <Button size="sm" onClick={() => setAddDialogOpen(true)}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      Add manga
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {jobs.map((job) => (
                      <div
                        key={job.id}
                        className="flex items-center gap-4 rounded-lg border p-3"
                      >
                        <Archive className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium truncate">
                              {job.manga}
                            </p>
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 shrink-0 ${sourceConfig[job.source].className}`}
                            >
                              {sourceConfig[job.source].label}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {job.chapters}
                            {job.detail ? ` · ${job.detail}` : ""}
                          </p>
                        </div>
                        {job.status === "running" && (
                          <div className="w-28 hidden sm:block">
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full bg-primary rounded-full transition-all"
                                style={{ width: `${job.progress}%` }}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 text-right">
                              {job.progress}%{job.eta ? ` · ${job.eta}` : ""}
                            </p>
                          </div>
                        )}
                        <Badge
                          variant="outline"
                          className={`capitalize text-xs shrink-0 ${jobStatusConfig[job.status]}`}
                        >
                          {job.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Floating active-jobs indicator — stays visible from any tab so a
          download in progress is never out of sight, without needing the
          full Queue card permanently taking up page space. */}
      {runningJobs > 0 && activeTab !== "queue" && (
        <button
          onClick={() => setActiveTab("queue")}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-medium shadow-lg transition-transform hover:-translate-y-0.5"
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-600" />
          </span>
          {runningJobs} downloading
        </button>
      )}
    </div>
  );
}
