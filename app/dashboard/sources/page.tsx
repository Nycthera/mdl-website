import Link from "next/link";
import { Library, AlertTriangle, Download, Link2 } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { DashboardPageShell } from "../_components/dashboard-page-shell";

const sources = [
  {
    name: "MangaDex",
    icon: Library,
    description:
      "The primary source. Use a title or chapter URL and MDL resolves the chapter list from MangaDex metadata.",
    pattern: "https://mangadex.org/title/...",
    accent: "text-orange-600 bg-orange-50 border-orange-200",
  },
  {
    name: "Manual mirror",
    icon: Link2,
    description:
      "Useful when you already have a direct chapter mirror URL and want MDL to treat it as a manual source.",
    pattern: "https://example.com/chapter/...",
    accent: "text-purple-600 bg-purple-50 border-purple-200",
  },
  {
    name: "WeebCentral",
    icon: Download,
    description:
      "Supported for alternate chapter discovery when a manga is mirrored there instead of MangaDex.",
    pattern: "https://weebcentral.com/series/...",
    accent: "text-sky-600 bg-sky-50 border-sky-200",
  },
];

export default function SourcesPage() {
  return (
    <DashboardPageShell
      title="Source guide"
      description="What the dashboard accepts, how it classifies links, and where each source fits."
      actions={
        <Button asChild>
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      }
    >
      <div className="grid gap-4 md:grid-cols-3">
        {sources.map(({ name, icon: Icon, description, pattern, accent }) => (
          <Card key={name}>
            <CardHeader>
              <div
                className={`mb-1 flex h-10 w-10 items-center justify-center border ${accent}`}
              >
                <Icon className="h-5 w-5" />
              </div>
              <CardTitle>{name}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Badge variant="outline" className={`w-fit ${accent}`}>
                {pattern}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>How the dashboard classifies links</CardTitle>
          <CardDescription>
            If the URL does not match one of the supported source types, the
            add-to-queue form rejects it before the request leaves the browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border p-4">
            <p className="text-sm font-medium">Good inputs</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Clean MangaDex, manual mirror, or WeebCentral URLs with no extra
              query noise are the safest path.
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm font-medium">Bad inputs</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Unsupported domains, pasted text with leading spaces, and
              ambiguous chapter URLs should fail fast.
            </p>
          </div>
          <div className="rounded-lg border p-4 md:col-span-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <p className="text-sm font-medium">Review note</p>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              The dashboard still validates the URL before enqueuing the job, so
              bad links should fail quickly instead of surfacing a late runtime
              error.
            </p>
          </div>
        </CardContent>
      </Card>
    </DashboardPageShell>
  );
}
