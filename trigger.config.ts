import { defineConfig } from "@trigger.dev/sdk";
import {
  additionalPackages,
  syncVercelEnvVars,
} from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: "proj_shayrpiwadsohrihzqdu",
  runtime: "node",
  logLevel: "log",
  maxDuration: 3600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["./src/trigger"],
  build: {
    // `ws` MUST be external, not bundled. Reason:
    //   Trigger.dev's current prod runtime is Node.js 21, which has no
    //   native `globalThis.WebSocket`. @supabase/realtime-js (v2.108.2)
    //   calls `WebSocketFactory.getWebSocketConstructor()` in
    //   `RealtimeClient._initializeOptions` whenever `options.transport`
    //   is nullish — and SupabaseClient ALWAYS constructs a RealtimeClient
    //   in its constructor, even when you never subscribe to a channel.
    //   So every `createClient()` call throws:
    //     "Node.js 21 detected without native WebSocket support."
    //
    //   The fix is to pass `realtime: { transport: ws }` — but if esbuild
    //   bundles `ws`, the default export ends up `undefined` at runtime
    //   (because `ws`'s optional native deps `bufferutil` /
    //   `utf-8-validate` are not installed in the worker and the bundled
    //   CJS interop silently breaks). `transport: undefined` falls through
    //   `??` to `getWebSocketConstructor()` and the same error fires.
    //
    //   Keeping `ws` external + installing it via `additionalPackages`
    //   (same pattern already used for `archiver`) makes
    //   `import ws from "ws"` resolve to the real WebSocket class at
    //   runtime, which `realtime: { transport: ws }` then uses correctly.
    external: ["archiver", "ws"],
    extensions: [
      additionalPackages({ packages: ["archiver", "ws"] }),
      syncVercelEnvVars({
        projectId: process.env.VERCEL_PROJECT_ID,
        vercelAccessToken: process.env.VERCEL_ACCESS_TOKEN,
        vercelTeamId: process.env.VERCEL_TEAM_ID,
      }),
    ],
  },
});
