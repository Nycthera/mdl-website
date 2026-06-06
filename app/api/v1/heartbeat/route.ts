import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
    { 
      status: 200, 
      headers: { 'Cache-Control': 'no-store' } // Ensure live data
    }
  );
}