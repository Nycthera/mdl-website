import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_ID ?? "proj_shayrpiwadsohrihzqdu",
  dirs: ["./app/src/trigger"],
  runtime: "node",
  maxDuration: 3600, // scraping + zipping a long-running series can take a while
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 30_000,
      factor: 2,
      randomize: true,
    },
  },
});
