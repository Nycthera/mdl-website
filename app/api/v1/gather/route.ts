import { NextResponse } from "next/server";
import { gatherUrls } from "../../../backend/generic";

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.manga) return NextResponse.json({ error: "manga required" }, { status: 400 });
  const slug = String(body.manga).replace(/\s+/g, "-");
  try {
    const urls = await gatherUrls(slug, body);
    return NextResponse.json({ urls });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
