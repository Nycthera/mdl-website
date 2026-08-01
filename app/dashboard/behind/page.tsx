import Link from "next/link";
import { AlertTriangle, Download, Library } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getMangaBehind } from "@/app/backend/supabaseFunctions/getMangaInfo/getMangaInfo";
import { formatDashboardDate, summarizeLibrary } from "@/lib/dashboard";

import { DashboardPageShell } from "../_components/dashboard-page-shell";

export default async function BehindPage() {
  const behind = await getMangaBehind();
  const summary = summarizeLibrary(behind);

  return (
    <DashboardPageShell
      title="Behind titles"
      description="The rows that need a download pass, ordered by chapter gap."
      actions={
        <Button asChild>
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Behind
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{behind.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              titles waiting on new chapters
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Gap
            </CardTitle>
            <Download className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{summary.totalGap}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              chapters to catch up on
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Library View
            </CardTitle>
            <Library className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{summary.total}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              matching rows in this filtered view
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Backlog list</CardTitle>
          <CardDescription>
            This is the set the dashboard should prioritize when you want the
            fastest catch-up.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {behind.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No backlog right now. Nice.
            </p>
          ) : (
            behind.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {item.manga_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Checked {formatDashboardDate(item.date_last_checked)} ·
                    Local {item.latest_chapter_local} · Source{" "}
                    {item.latest_chapter_from_mangadex}
                  </p>
                </div>
                <Badge variant="outline" className="w-fit shrink-0">
                  {Math.max(
                    0,
                    item.latest_chapter_from_mangadex -
                      item.latest_chapter_local,
                  )}{" "}
                  chapters behind
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </DashboardPageShell>
  );
}
