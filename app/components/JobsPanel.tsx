"use client";

import { useEffect, useState } from "react";

type Job = {
  id: string;
  status: string;
  payload?: any;
  result?: any;
  error?: any;
};

export default function JobsPanel() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);

  async function fetchJobs() {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/status");
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      setJobs(j.jobs || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchJobs();
    const t = setInterval(fetchJobs, 3000);
    return () => clearInterval(t);
  }, []);

  if (loading && jobs.length === 0) return <div>Loading jobs…</div>;

  return (
    <div className="space-y-3">
      {jobs.length === 0 && <div className="text-sm text-gray-600">No active jobs.</div>}
      {jobs.map((job) => (
        <div key={job.id} className="p-3 border rounded flex items-center justify-between">
          <div>
            <div className="font-medium">{job.payload?.manga || job.id}</div>
            <div className="text-sm text-gray-600">{job.status}</div>
          </div>
          <div className="text-right text-sm">
            {job.result ? <span className="text-green-600">Done</span> : <span className="text-yellow-600">{job.status}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
