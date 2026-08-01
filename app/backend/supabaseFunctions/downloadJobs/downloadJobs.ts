import { createAdminClient } from "@/lib/supabase/server";

export type DownloadSource = "mangadex" | "manual" | "weebcentral";
export type DownloadJobStatus = "queued" | "running" | "completed" | "failed";
export type DownloadJobApiStatus =
  "pending" | "running" | "completed" | "failed";

interface DownloadJobRow {
  id: string;
  user_id: string;
  run_id: string;
  url: string;
  source: DownloadSource;
  manga_id: string | null;
  manga_name: string | null;
  status: DownloadJobStatus;
  progress: number;
  chapter_count: number | null;
  stage: string | null;
  status_message: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface PersistDownloadJobInput {
  userId: string;
  runId: string;
  status: DownloadJobStatus;
  progress: number;
  url?: string;
  source?: DownloadSource;
  mangaId?: string | null;
  mangaName?: string | null;
  chapterCount?: number | null;
  stage?: string | null;
  statusMessage?: string | null;
  error?: string | null;
}

export interface DownloadJobResponse {
  id: string;
  status: DownloadJobApiStatus;
  progress: number;
  mangaName: string | null;
  mangaId: string | null;
  chapterCount: number | null;
  downloadUrl: null;
  filename: null;
  error: string | null;
  stage: string | null;
  statusMessage: string | null;
  source: DownloadSource;
  url: string;
}

function mapStatus(status: DownloadJobStatus): DownloadJobApiStatus {
  return status === "queued" ? "pending" : status;
}

function mergeValue<T>(
  next: T | null | undefined,
  current: T | null,
): T | null {
  return next === undefined ? current : next;
}

async function loadDownloadJobByRunId(
  supabase: ReturnType<typeof createAdminClient>,
  runId: string,
): Promise<DownloadJobRow | null> {
  const { data, error } = await supabase
    .from("download_jobs")
    .select("*")
    .eq("run_id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(`download_jobs lookup failed: ${error.message}`);
  }

  return (data as DownloadJobRow | null) ?? null;
}

export async function upsertDownloadJob(
  input: PersistDownloadJobInput,
): Promise<void> {
  const supabase = createAdminClient();
  const existing = await loadDownloadJobByRunId(supabase, input.runId);

  if (existing && existing.user_id !== input.userId) {
    throw new Error("download job ownership mismatch");
  }

  const now = new Date().toISOString();
  const record = {
    user_id: input.userId,
    run_id: input.runId,
    url: input.url ?? existing?.url,
    source: input.source ?? existing?.source,
    manga_id: mergeValue(input.mangaId, existing?.manga_id ?? null),
    manga_name: mergeValue(input.mangaName, existing?.manga_name ?? null),
    status: input.status,
    progress: input.progress,
    chapter_count: mergeValue(
      input.chapterCount,
      existing?.chapter_count ?? null,
    ),
    stage: mergeValue(input.stage, existing?.stage ?? null),
    status_message: mergeValue(
      input.statusMessage,
      existing?.status_message ?? null,
    ),
    error: mergeValue(input.error, existing?.error ?? null),
    created_at: existing?.created_at ?? now,
    updated_at: now,
    completed_at:
      input.status === "completed" || input.status === "failed"
        ? now
        : (existing?.completed_at ?? null),
  };

  if (!record.url) {
    throw new Error("download job url is required");
  }
  if (!record.source) {
    throw new Error("download job source is required");
  }

  const { error } = await supabase
    .from("download_jobs")
    .upsert(record, { onConflict: "run_id" });

  if (error) {
    throw new Error(`download_jobs upsert failed: ${error.message}`);
  }
}

export async function listDownloadJobs(
  userId: string,
): Promise<DownloadJobRow[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("download_jobs")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new Error(`download_jobs list failed: ${error.message}`);
  }

  return (data as DownloadJobRow[] | null) ?? [];
}

export function toDownloadJobResponse(
  row: DownloadJobRow,
): DownloadJobResponse {
  return {
    id: row.run_id,
    status: mapStatus(row.status),
    progress: row.progress,
    mangaName: row.manga_name,
    mangaId: row.manga_id,
    chapterCount: row.chapter_count,
    downloadUrl: null,
    filename: null,
    error: row.error,
    stage: row.stage,
    statusMessage: row.status_message,
    source: row.source,
    url: row.url,
  };
}

export function toDownloadJobStatus(status: string): DownloadJobStatus | null {
  switch (status) {
    case "pending":
      return "queued";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return null;
  }
}

export function fromTriggerRunStatus(status: string): DownloadJobStatus | null {
  switch (status) {
    case "QUEUED":
    case "DELAYED":
    case "WAITING_FOR_DEPLOY":
      return "queued";
    case "EXECUTING":
    case "RETRYING":
      return "running";
    case "COMPLETED":
      return "completed";
    case "FAILED":
    case "CRASHED":
    case "TIMED_OUT":
    case "CANCELED":
      return "failed";
    default:
      return null;
  }
}
