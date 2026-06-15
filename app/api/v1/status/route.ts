'use server'

import { NextResponse } from "next/server";

export async function GET() {
    const time_now = new Date().toISOString();
    return NextResponse.json({ status: "ok" });
}