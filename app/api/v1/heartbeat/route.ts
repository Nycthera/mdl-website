// app/api/v1/heartbeat/route.ts

export async function GET() {
  const date = new Date().toISOString();
  return Response.json({
    status: "online",
    timestamp: date,
  });
}
