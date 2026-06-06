import { NextResponse } from "next/server";
import { setStop } from "../../../backend/stop";

export async function POST() {
  setStop();
  return NextResponse.json({ stopped: true });
}
