// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
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

Sentry.init({
  dsn: "https://903376cec7957b7a2486e9937dfb8a90@o4509070019788800.ingest.us.sentry.io/4511717220679680",

  // Tag every event with the Vercel deployment environment so preview
  // deploys don't pollute production error metrics.
  environment: resolveEnvironment(),

  release: process.env.SENTRY_RELEASE,

  // 100% in dev, 10% in prod. Edge traces are cheap but plentiful
  // (every middleware hit generates one), so 10% is plenty.
  tracesSampleRate: resolveEnvironment() === "production" ? 0.1 : 1.0,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  dataCollection: {
    // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection
    // userInfo: false,
    // httpBodies: [],
  },
});
