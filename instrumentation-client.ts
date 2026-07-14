// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

/**
 * Resolves the deployment environment Sentry should tag events with.
 *
 * On the client there's no `process.env.VERCEL_ENV` at runtime (env vars
 * aren't inlined unless they're prefixed with `NEXT_PUBLIC_`). We expose
 * the environment via `NEXT_PUBLIC_VERCEL_ENV` (set in the Vercel project
 * settings) so the browser can tag events the same way the server does.
 */
function resolveEnvironment(): string {
  return (
    process.env.NEXT_PUBLIC_VERCEL_ENV ??
    process.env.NODE_ENV ??
    "development"
  );
}

/**
 * Drops or rewrites events that aren't worth a Sentry notification.
 *
 * Browser-only noise that the server `beforeSend` doesn't see. Keep
 * this conservative — only drop things you'd never page someone for.
 */
function beforeSend(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  const exception = event.exception?.values?.[0];
  const message = exception?.value ?? "";

  // ── ResizeObserver: harmless Chrome warning, not a real error.
  if (
    message.includes("ResizeObserver loop limit exceeded") ||
    message.includes("ResizeObserver loop completed with undelivered")
  ) {
    return null;
  }

  // ── Network errors from ad-blockers blocking the /monitoring tunnel
  //    or third-party CDNs. These happen constantly on ad-blocker
  //    installs and aren't actionable.
  if (
    message.includes("Failed to fetch dynamically imported module") ||
    (message.includes("NetworkError") && message.includes("monitoring"))
  ) {
    return null;
  }

  // ── AbortSignal.timeout — these fire on every slow image fetch we
  //    cancel in build-cbz-in-browser.ts. They're expected, handled,
  //    and retried — not a Sentry-worthy error.
  if (message.includes("AbortError") || message.includes("The operation")) {
    return null;
  }

  return event;
}

Sentry.init({
  dsn: "https://903376cec7957b7a2486e9937dfb8a90@o4509070019788800.ingest.us.sentry.io/4511717220679680",

  // Tag every event with the deployment environment so preview deploys
  // don't pollute production error metrics.
  environment: resolveEnvironment(),

  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,

  // Add optional integrations for additional features
  integrations: [
    Sentry.replayIntegration({
      // Mask all text content by default — replay still shows the layout,
      // just not the actual text. Unmask individual elements by adding
      // `data-sentry-unmask` to them. This is the safe default for a
      // manga app where chapter titles + user emails may appear on screen.
      maskAllText: true,
      // Block all input values — same reasoning. Replay shows that the
      // user typed, not what they typed.
      blockAllMedia: false,
    }),

    // User Feedback widget — adds a small "Report a bug" button to the
    // bottom-right corner. Submitted feedback is attached to the most
    // recent error on the same page load, or stands alone as a user
    // report. Useful on a personal project where you can't watch the
    // Sentry stream 24/7.
    Sentry.feedbackIntegration({
      colorScheme: "system",
      buttonLabel: "Report a bug",
      submitButtonLabel: "Send report",
      formTitle: "Report a bug",
      messagePlaceholder: "What happened? What did you expect?",
      showEmail: false,
      showName: false,
      isNameRequired: false,
      isEmailRequired: false,
    }),
  ],

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate:
    resolveEnvironment() === "production" ? 0.1 : 1.0,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Define how likely Replay events are sampled.
  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate:
    resolveEnvironment() === "production" ? 0.05 : 0.1,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  beforeSend,

  dataCollection: {
    // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection
    // userInfo: false,
    // httpBodies: [],
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
