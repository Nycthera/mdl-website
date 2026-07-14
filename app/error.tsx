"use client";

/**
 * Route-level error boundary.
 *
 * Next.js's App Router has TWO error boundary layers:
 *
 *   1. `app/error.tsx` — catches errors thrown in any route or layout
 *      BELOW this segment (but not in the root layout itself). It
 *      renders inside the root layout, so the navbar / footer stay
 *      visible. This is the user-facing layer — show a "Try again"
 *      button + a friendly message.
 *
 *   2. `app/global-error.tsx` — catches errors in the root layout
 *      itself. It replaces the entire `<html>` document, so it has to
 *      re-render `<html>` + `<body>` itself. This is the fallback of
 *      last resort.
 *
 * The Sentry wizard only generated (2). Without (1), any thrown error
 * in `app/dashboard/page.tsx`, `app/api/...`, etc. would bubble all
 * the way up to the global boundary, replacing the entire app shell —
 * jarring UX for what's usually a recoverable error in a single route.
 *
 * Both boundaries call Sentry.captureException. The framework's
 * `onRequestError` hook (wired up in instrumentation.ts) ALSO captures
 * these errors server-side, but capturing client-side too gives you
 * the user's replay + breadcrumb context, which the server-side
 * capture doesn't have.
 */
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // `digest` is Next.js's stable error id (set by the framework on
    // production builds). Tagging the Sentry event with it lets you
    // cross-reference a Sentry issue with the user-visible error id
    // they might paste into a support message.
    Sentry.captureException(error, {
      tags: {
        boundary: "route-error",
        digest: error.digest ?? "unknown",
      },
    });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-2xl font-semibold">Something went wrong</h2>
      <p className="max-w-md text-muted-foreground">
        The page hit an unexpected error. Your error has been reported
        automatically — you can try again, or head back to the dashboard.
      </p>
      <div className="flex gap-2">
        <Button onClick={reset} variant="default">
          Try again
        </Button>
        <Button asChild variant="outline">
          <a href="/dashboard">Back to dashboard</a>
        </Button>
      </div>
      {error.digest && (
        <p className="mt-4 text-xs text-muted-foreground">
          Error ID: <code className="font-mono">{error.digest}</code>
        </p>
      )}
    </div>
  );
}
