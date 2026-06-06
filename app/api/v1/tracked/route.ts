import { NextResponse } from "next/server";
import { getTracked, recordDownload } from "../../../backend/tracked";

export async function GET() {
  try {
    const tracked = getTracked();
    return NextResponse.json({ tracked });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  try {
    recordDownload(body);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
