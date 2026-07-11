import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_ID ?? "proj_shayrpiwadsohrihzqdu",
  dirs: ["./app/src/trigger"],
  runtime: "node",
  maxDuration: 3600, // scraping a long-running series' page URLs can take a while (image bytes are downloaded client-side now, not in this task)
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
