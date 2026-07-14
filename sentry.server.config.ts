// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

/**
 * Resolves the deployment environment Sentry should tag events with.
 *
 * Vercel sets `VERCEL_ENV` to "production" | "preview" | "development" on
 * every deployment. Without this, every Vercel preview deploy would be
 * bucketed under Sentry's default ("production"), drowning real prod
 * errors in preview-deploy noise. Falling back to `NODE_ENV` keeps local
 * `next dev` runs tagged as "development".
 */
function resolveEnvironment(): string {
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";
}

/**
 * Drops or rewrites events that aren't worth a Sentry notification.
 *
 * The wizard's default config sends everything, which floods the inbox
 * with browser-side and NextAuth noise that isn't actionable. This hook
 * is the single place to add ignore rules — keep it conservative, only
 * drop things you'd never page someone for.
 */
function beforeSend(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  const exception = event.exception?.values?.[0];
  const message = exception?.value ?? "";
  const type = exception?.type ?? "";

  // ── NextAuth: stale JWT cookies after a secret rotation or sign-out.
  //    These fire on every protected-page load until the user clears
  //    cookies — not actionable, the user just needs to re-login.
  if (type === "JWTSessionError" || message.includes("[jwt]")) {
    return null;
  }

  // ── NextAuth: OAuth state mismatch. Happens when a user opens the
  //    GitHub login flow in two tabs simultaneously. Self-inflicted,
  //    not a bug.
  if (message.includes("OAuthCallback") && message.includes("state")) {
    return null;
  }

  // ── Browser-side noise that leaks into server logs via RSC error
  //    forwarding. ResizeObserver loop errors are harmless (Chrome
  //    feature, not a real error) and shouldn't trigger alerts.
  if (
    message.includes("ResizeObserver loop limit exceeded") ||
    message.includes("ResizeObserver loop completed with undelivered")
  ) {
    return null;
  }

  return event;
}

Sentry.init({
  dsn: "https://903376cec7957b7a2486e9937dfb8a90@o4509070019788800.ingest.us.sentry.io/4511717220679680",

  // Tag every event with the Vercel deployment environment so preview
  // deploys don't pollute production error metrics.
  environment: resolveEnvironment(),

  // Vercel auto-injects SENTRY_RELEASE from VERCEL_GIT_COMMIT_SHA when
  // the Sentry Vercel integration is enabled. Setting it explicitly
  // here means source-map uploads + release tracking work even if the
  // integration isn't installed.
  release: process.env.SENTRY_RELEASE,

  // 100% in dev (cheap, you want to see everything), 10% in prod
  // (traces are expensive — 0.1 is enough for slow-route diagnosis
  // without blowing the Sentry quota on a personal project).
  tracesSampleRate:
    resolveEnvironment() === "production" ? 0.1 : 1.0,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  beforeSend,

  dataCollection: {
    // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection
    // userInfo: false,
    // httpBodies: [],
  },
});
