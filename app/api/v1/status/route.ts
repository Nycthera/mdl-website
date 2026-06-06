import { NextResponse } from "next/server";
import { listJobs } from "../../../backend/jobs";

export async function GET() {
  try {
    return NextResponse.json({ status: "ok", jobs: listJobs() });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
