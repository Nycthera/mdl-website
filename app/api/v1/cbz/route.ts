import { NextResponse } from "next/server";
import { createCbz } from "../../../backend/cbz";

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.folder) return NextResponse.json({ error: "folder required" }, { status: 400 });
  try {
    const cbz = await createCbz(body.folder);
    return NextResponse.json({ cbz });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
