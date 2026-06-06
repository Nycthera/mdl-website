import { NextResponse } from "next/server";
import { getJob } from "../../../../backend/jobs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(job);
}
