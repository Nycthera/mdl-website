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
} from "lucide-react";

import {
    getMangaLibrary,
    getMangaStats,
    type Manga,
} from "@/app/backend/supabaseFunctions/getMangaInfo/getMangaInfo";

// --- Types ---
type MangaStatus = "up-to-date" | "behind" | "checking";

interface Job {
    id: string;
    manga: string;
    chapters: string;
    status: "running" | "queued" | "done" | "failed";
    progress: number;
}

interface Stats {
    total: number;
    upToDate: number;
    behind: number;
}

// --- Mock jobs (no jobs table yet) ---
const mockJobs: Job[] = [
    { id: "j1", manga: "Otonari no Tenshi sama", chapters: "Ch. 27", status: "running", progress: 62 },
    { id: "j2", manga: "Alya Sometimes Hides Her Feelings", chapters: "Ch. 80–82", status: "queued", progress: 0 },
    { id: "j3", manga: "Wistoria: Wand and Sword", chapters: "Ch. 65–66", status: "queued", progress: 0 },
    { id: "j4", manga: "Onii-chan wa Oshimai!", chapters: "Ch. 110–112", status: "done", progress: 100 },
];

// --- Helpers ---
function getMangaStatus(manga: Manga): MangaStatus {
    if (manga.latest_chapter_local < manga.latest_chapter_from_mangadex) return "behind";
    return "up-to-date";
}

function formatDate(unix: number) {
    return new Date(unix * 1000).toLocaleDateString("en-GB", {
        day: "numeric", month: "short", year: "numeric",
    });
}

const statusConfig = {
    "up-to-date": { label: "Up to date", icon: CheckCircle2, className: "text-green-600 bg-green-50 border-green-200" },
    "behind": { label: "Behind", icon: AlertCircle, className: "text-amber-600 bg-amber-50 border-amber-200" },
    "checking": { label: "Checking", icon: Clock, className: "text-muted-foreground bg-muted border-border" },
};

const jobStatusConfig = {
    running: "text-blue-600 bg-blue-50 border-blue-200",
    queued: "text-muted-foreground bg-muted border-border",
    done: "text-green-600 bg-green-50 border-green-200",
    failed: "text-destructive bg-destructive/10 border-destructive/20",
};

const runningJobs = mockJobs.filter(j => j.status === "running").length;

export default function DashboardPage() {
    const [search, setSearch] = useState("");
    const [manga, setManga] = useState<Manga[]>([]);
    const [stats, setStats] = useState<Stats>({ total: 0, upToDate: 0, behind: 0 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    

    useEffect(() => {
        async function load() {
            try {
                const [library, mangaStats] = await Promise.all([
                    getMangaLibrary(),
                    getMangaStats(),
                ]);
                console.log("library:", library);
                console.log("stats:", mangaStats);
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

    const filtered = manga.filter(m =>
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
                        <Button variant="ghost" size="icon">
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
                        <p className="text-muted-foreground mt-1">Track and manage your manga library.</p>
                    </div>
                    <Button onClick={() => { setLoading(true); setError(""); }}>
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
                            <CardTitle className="text-sm font-medium text-muted-foreground">Total Tracked</CardTitle>
                            <Library className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <p className="text-3xl font-bold">{loading ? "—" : stats.total}</p>
                            <p className="text-xs text-muted-foreground mt-1">manga in library</p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Up to Date</CardTitle>
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                        </CardHeader>
                        <CardContent>
                            <p className="text-3xl font-bold">{loading ? "—" : stats.upToDate}</p>
                            <p className="text-xs text-muted-foreground mt-1">no new chapters</p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Behind</CardTitle>
                            <AlertCircle className="h-4 w-4 text-amber-600" />
                        </CardHeader>
                        <CardContent>
                            <p className="text-3xl font-bold">{loading ? "—" : stats.behind}</p>
                            <p className="text-xs text-muted-foreground mt-1">need downloading</p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Active Jobs</CardTitle>
                            <Activity className="h-4 w-4 text-blue-600" />
                        </CardHeader>
                        <CardContent>
                            <p className="text-3xl font-bold">{runningJobs}</p>
                            <p className="text-xs text-muted-foreground mt-1">currently running</p>
                        </CardContent>
                    </Card>
                </div>

                {/* Download Queue */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Download className="h-5 w-5 text-primary" />
                            Download Queue
                        </CardTitle>
                        <CardDescription>Currently running and queued jobs.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {mockJobs.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-4 text-center">No active jobs.</p>
                        ) : (
                            <div className="space-y-3">
                                {mockJobs.map((job) => (
                                    <div key={job.id} className="flex items-center gap-4 rounded-lg border p-3">
                                        <Archive className="h-4 w-4 text-muted-foreground shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{job.manga}</p>
                                            <p className="text-xs text-muted-foreground">{job.chapters}</p>
                                        </div>
                                        {job.status === "running" && (
                                            <div className="w-24 hidden sm:block">
                                                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                                    <div
                                                        className="h-full bg-primary rounded-full transition-all"
                                                        style={{ width: `${job.progress}%` }}
                                                    />
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-1 text-right">{job.progress}%</p>
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
                                <CardDescription>All tracked manga and their chapter status.</CardDescription>
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
                                    <TableHead className="hidden md:table-cell">Last Checked</TableHead>
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
                                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                            No manga found.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filtered.map((m) => {
                                        const status = getMangaStatus(m);
                                        const { label, icon: Icon, className } = statusConfig[status];
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
                                                    <Badge variant="outline" className={`text-xs gap-1 ${className}`}>
                                                        <Icon className="h-3 w-3" />
                                                        {label}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8">
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