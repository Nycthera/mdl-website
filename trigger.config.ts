import { defineConfig } from "@trigger.dev/sdk/v3";
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
    external: ["archiver"],
    extensions: [
      additionalPackages({ packages: ["archiver"] }),
      syncVercelEnvVars({
        projectId: process.env.VERCEL_PROJECT_ID,
        vercelAccessToken: process.env.VERCEL_ACCESS_TOKEN,
        vercelTeamId: process.env.VERCEL_TEAM_ID,
      }),
    ],
  },
});
