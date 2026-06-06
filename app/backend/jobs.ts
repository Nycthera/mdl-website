export type JobStatus = "queued" | "running" | "finished" | "failed";

export interface Job {
  id: string;
  status: JobStatus;
  payload: Record<string, unknown>;
  result: unknown | null;
  error: string | null;
}

const JOBS: Map<string, Job> = new Map();

export function createJob(payload: Record<string, unknown>): Job {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
  const job: Job = { id, status: "queued", payload, result: null, error: null };
  JOBS.set(id, job);
  return job;
}

export function setJobRunning(id: string): void {
  const j = JOBS.get(id);
  if (j) j.status = "running";
}

export function setJobFinished(id: string, result: unknown): void {
  const j = JOBS.get(id);
  if (j) {
    j.status = "finished";
    j.result = result;
  }
}

export function setJobFailed(id: string, error: unknown): void {
  const j = JOBS.get(id);
  if (j) {
    j.status = "failed";
    j.error = String(error);
  }
}

export function getJob(id: string): Job | null {
  return JOBS.get(id) || null;
}

export function listJobs(): Job[] {
  return Array.from(JOBS.values());
}
