"use client";

import { useState, useEffect } from "react";
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
} from "lucide-react";

import {
  getMangaLibrary,
  getMangaStats,
  type Manga,
} from "@/app/backend/supabaseFunctions/getMangaInfo/getMangaInfo";
import { supabase } from "../backend/supabaseFunctions/supabaseClient";
import { useRouter } from "next/navigation";
import { defineTypeOfURL } from "@/app/backend/utils";

import { getMangaDexInfoFromURL } from "@/app/backend/utils";

// --- Types ---
type MangaStatus = "up-to-date" | "behind" | "checking";
type Source = "mangadex" | "manual" | "weebcentral";

interface Job {
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

// --- Helpers ---
function getMangaStatus(manga: Manga): MangaStatus {
  if (manga.latest_chapter_local < manga.latest_chapter_from_mangadex)
    return "behind";
  return "up-to-date";
}

function formatDate(unix: number) {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

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
const mockJobs: Job[] = [];

// get session to check if user is logged in

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
  const [jobs, setJobs] = useState<Job[]>(mockJobs);
  const runningJobs = jobs.filter((j) => j.status === "running").length;

  async function handleAddDownload(e: React.FormEvent) {
    e.preventDefault();

    const typeOfSource = defineTypeOfURL(newMangaUrl);

    if (!typeOfSource) {
      toast.error("Unsupported URL type");
      return;
    }

    setIsAddingDownload(true);
    const jobId = crypto.randomUUID();

    try {
      setJobs((prev) => [
        {
          id: jobId,
          manga: "Preparing download...",
          chapters: "",
          status: "queued",
          progress: 0,
          source: typeOfSource,
        },
        ...prev,
      ]);

      let mangaName: string;
      // What actually gets sent to /api/v1/download. Defaults to the
      // pasted URL/source, but weebcentral overrides both once resolved
      // down to a real mirror URL, since the download itself runs through
      // the same pipeline as `manual`.
      let downloadUrl: string = newMangaUrl;
      let downloadSource: Source = typeOfSource;

      if (typeOfSource === "mangadex") {
        const info = getMangaDexInfoFromURL(newMangaUrl);
        mangaName = info.name;
      } else if (typeOfSource === "manual") {
        const resolveRes = await fetch("/api/v1/resolveManual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mangaUrl: newMangaUrl }),
        });

        if (!resolveRes.ok) {
          throw new Error("Could not resolve manga from URL");
        }

        const { mangaName: resolvedName } = await resolveRes.json();
        mangaName = resolvedName;
      } else if (typeOfSource === "weebcentral") {
        // WeebCentral isn't a separate download mechanism — it's just a
        // discovery path. The server scrapes one chapter page (Playwright
        // can't run in the browser) to find a real mirror image URL, then
        // resolves it exactly like `manual` does.
        const resolveRes = await fetch("/api/v1/resolveWeebcentral", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mangaUrl: newMangaUrl }),
        });

        if (!resolveRes.ok) {
          throw new Error("Could not resolve manga from URL");
        }

        const { mangaName: resolvedName, downloadUrl: resolvedUrl } =
          await resolveRes.json();
        mangaName = resolvedName;

        downloadUrl = resolvedUrl;
        downloadSource = "manual";
      } else {
        mangaName = "Unknown Manga";
      }

      setJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, manga: mangaName } : j))
      );

      const res = await fetch("/api/v1/download", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mangaUrl: downloadUrl,
          mangaName,
          source: downloadSource,
        }),
      });

      if (!res.ok) throw new Error("Download failed");

      const blob = await res.blob();

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");

      a.href = url;
      a.download = `${mangaName}.cbz`;
      document.body.appendChild(a);
      a.click();

      a.remove();
      URL.revokeObjectURL(url);

      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? {
                ...j,
                status: "done",
                progress: 100,
                manga: mangaName,
              }
            : j
        )
      );

      toast.success("Download complete!");
    } catch (err) {
      console.error(err);
      toast.error("Download failed");
      setJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, status: "failed" } : j))
      );
    } finally {
      setIsAddingDownload(false);
    }
  }

  useEffect(() => {
    async function checkAuth() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.push("/login");
      }
    }
    checkAuth();
  }, [router]);

  useEffect(() => {
    async function load() {
      try {
        const [library, mangaStats] = await Promise.all([
          getMangaLibrary(),
          getMangaStats(),
        ]);
        setManga(library);
        setStats(mangaStats);
      } catch (err) {
        console.error("fetch error:", err);
        setError(err instanceof Error ? err.message : "Failed to load library");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const filtered = manga.filter((m) =>
    m.manga_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <MdBook className="h-6 w-6 text-primary" />
            <span className="font-bold text-lg">MDL</span>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/docs/API.md">Docs</Link>
            </Button>

            {/* destory a session */}
            <Button
              variant="ghost"
              size="icon"
              onClick={async () => {
                const { error } = await supabase.auth.signOut();
                router.push("/login");
                if (error) {
                  console.error("Error signing out:", error);
                }
              }}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </nav>

      <div className="container mx-auto py-8 space-y-8">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <p className="text-muted-foreground mt-1">
              Track and manage your manga library.
            </p>
          </div>
          <Button
            onClick={() => {
              setLoading(true);
              setError("");
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Check all for updates
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Tracked
              </CardTitle>
              <Library className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">
                {loading ? "—" : stats.total}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                manga in library
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Up to Date
              </CardTitle>
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">
                {loading ? "—" : stats.upToDate}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                no new chapters
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Behind
              </CardTitle>
              <AlertCircle className="h-4 w-4 text-amber-600" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">
                {loading ? "—" : stats.behind}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                need downloading
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Active Jobs
              </CardTitle>
              <Activity className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{runningJobs}</p>
              <p className="text-xs text-muted-foreground mt-1">
                currently running
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Add to Queue */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              Add to Queue
            </CardTitle>
            <CardDescription>
              Paste a MangaDex, manual, or WeebCentral link to queue a new
              download.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={handleAddDownload}
              className="flex flex-col sm:flex-row gap-3 sm:items-end"
            >
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="manga-url">Manga / chapter URL</Label>
                <Input
                  id="manga-url"
                  type="url"
                  placeholder="https://mangadex.org/title/..."
                  value={newMangaUrl}
                  onChange={(e) => setNewMangaUrl(e.target.value)}
                  required
                />
              </div>
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
            </form>
            <div className="flex flex-wrap items-center gap-2 mt-3 text-xs text-muted-foreground">
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
          </CardContent>
        </Card>

        {/* Download Queue */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5 text-primary" />
              Download Queue
            </CardTitle>
            <CardDescription>
              Currently running and queued jobs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No active jobs.
              </p>
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

        {/* Library Table */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead className="hidden md:table-cell">
                    Last Checked
                  </TableHead>
                  <TableHead className="text-center">Local</TableHead>
                  <TableHead className="text-center">MangaDex</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}>
                          <div className="h-4 rounded bg-muted animate-pulse" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center py-8 text-muted-foreground"
                    >
                      No manga found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((m) => {
                    const status = getMangaStatus(m);
                    const {
                      label,
                      icon: Icon,
                      className,
                    } = statusConfig[status];
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="font-medium max-w-50 truncate">
                          {m.manga_name}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-muted-foreground text-sm">
                          {formatDate(m.date_last_checked)}
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
      </div>
    </div>
  );
}
