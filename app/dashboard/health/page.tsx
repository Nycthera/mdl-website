import Link from "next/link";
import { AlertCircle, Activity, Clock, Library } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getMangaLibrary,
  getMangaStats,
} from "@/app/backend/supabaseFunctions/getMangaInfo/getMangaInfo";
import { formatDashboardDate, summarizeLibrary } from "@/lib/dashboard";

import { DashboardPageShell } from "../_components/dashboard-page-shell";

export default async function HealthPage() {
  const [library, stats] = await Promise.all([
    getMangaLibrary(),
    getMangaStats(),
  ]);
  const summary = summarizeLibrary(library);

  return (
    <DashboardPageShell
      title="Health overview"
      description="A tighter read on backlog, freshness, and what needs attention first."
      actions={
        <Button asChild>
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Tracked
            </CardTitle>
            <Library className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.total}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              series in the library
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Up to Date
            </CardTitle>
            <Activity className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.upToDate}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              already matched
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
            <p className="text-3xl font-bold">{stats.behind}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              need another download pass
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Backlog Chapters
            </CardTitle>
            <Clock className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{summary.totalGap}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              chapters missing across tracked series
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Most urgent titles</CardTitle>
            <CardDescription>
              These have the widest gap between local and source chapters.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.mostBehind.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Everything is caught up.
              </p>
            ) : (
              summary.mostBehind.map((item) => (
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
                    {item.chapterGap} gap
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recently checked</CardTitle>
            <CardDescription>
              Useful for spotting stale rows or noisy updates.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.recentlyChecked.length === 0 ? (
              <p className="text-sm text-muted-foreground">No manga yet.</p>
            ) : (
              summary.recentlyChecked.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-4 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {item.manga_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Checked {formatDashboardDate(item.date_last_checked)}
                    </p>
                  </div>
                  <Badge variant="outline">
                    {item.chapterGap > 0 ? "Behind" : "Current"}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardPageShell>
  );
}
