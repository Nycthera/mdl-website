"use client";

import { useState } from "react";

export default function StartDownloadForm() {
  const [manga, setManga] = useState("");
  const [cbz, setCbz] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("starting");
    setJobId(null);

    try {
      const res = await fetch("/api/v1/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manga, cbz }),
      });

      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data = await res.json();
      setJobId(data.jobId);
      setStatus("started");
      pollJob(data.jobId);
    } catch (err: any) {
      setStatus(`error: ${err?.message || err}`);
    }
  }

  async function pollJob(id: string) {
    setStatus("running");
    try {
      for (;;) {
        const r = await fetch(`/api/v1/jobs/${id}`);
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        if (j.status === "finished") {
          setStatus("finished");
          return;
        }
        if (j.status === "failed") {
          setStatus("failed");
          return;
        }
        await new Promise((res) => setTimeout(res, 1500));
      }
    } catch (err: any) {
      setStatus(`poll error: ${err?.message || err}`);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="block">
        <span className="text-sm">Manga URL or name</span>
        <input
          className="mt-1 w-full rounded border p-2"
          value={manga}
          onChange={(e) => setManga(e.target.value)}
          placeholder="https://mangadex.org/title/... or Spy x Family"
          required
        />
      </label>

      <label className="flex items-center gap-3">
        <input type="checkbox" checked={cbz} onChange={(e) => setCbz(e.target.checked)} />
        <span className="text-sm">Create CBZ after download</span>
      </label>

      <div className="flex items-center gap-3">
        <button className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">Start</button>
        <span className="text-sm text-gray-600">{status ? `Status: ${status}` : "Ready"}</span>
      </div>

      {jobId && (
        <div className="text-sm mt-2">
          Job ID: <code className="bg-gray-100 px-2 py-1 rounded">{jobId}</code>
        </div>
      )}
    </form>
  );
}
