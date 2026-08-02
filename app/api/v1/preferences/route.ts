// /api/v1/preferences/route.ts
//
// Backs the /dashboard/preferences page. Uses the Supabase *admin* client
// rather than the cookie-based one, for the same reason the rest of the
// app does (see lib/get-session.ts): auth here is a NextAuth JWT, not a
// Supabase SSR cookie session, so there's nothing for the regular client
// to authenticate a supabase.auth.updateUser() call with. The admin API
// (service role key) lets us update the Supabase user directly by id once
// we've verified the caller's identity via the NextAuth session.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSessionUserId } from "@/lib/get-session";
import { resolvePreferences, type AppPreferences } from "@/lib/preferences";

interface PatchBody {
  username?: string;
  preferences?: Partial<AppPreferences>;
  newPassword?: string;
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.auth.admin.getUserById(userId);

  if (error || !data?.user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const metadata = data.user.user_metadata ?? {};

  return NextResponse.json({
    username: metadata.username ?? data.user.email?.split("@")[0] ?? "",
    email: data.user.email ?? null,
    // GitHub-linked accounts don't have a real Supabase password — they
    // authenticate via OAuth, so the preferences page hides the password
    // field for them rather than showing a change form that would fail.
    provider: metadata.provider === "github" ? "github" : "credentials",
    preferences: resolvePreferences(metadata.preferences),
  });
}

export async function PATCH(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: PatchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: existing, error: fetchError } =
    await supabase.auth.admin.getUserById(userId);

  if (fetchError || !existing?.user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const existingMetadata = existing.user.user_metadata ?? {};

  if (body.newPassword && existingMetadata.provider === "github") {
    return NextResponse.json(
      {
        error:
          "This account signs in with GitHub and has no password to change.",
      },
      { status: 400 },
    );
  }

  if (body.newPassword && body.newPassword.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }

  if (body.username !== undefined && !body.username.trim()) {
    return NextResponse.json(
      { error: "Display name can't be empty." },
      { status: 400 },
    );
  }

  const nextMetadata = {
    ...existingMetadata,
    ...(body.username !== undefined ? { username: body.username.trim() } : {}),
    ...(body.preferences
      ? {
          preferences: resolvePreferences({
            ...existingMetadata.preferences,
            ...body.preferences,
          }),
        }
      : {}),
  };

  const { data: updated, error: updateError } =
    await supabase.auth.admin.updateUserById(userId, {
      user_metadata: nextMetadata,
      ...(body.newPassword ? { password: body.newPassword } : {}),
    });

  if (updateError || !updated?.user) {
    return NextResponse.json(
      { error: updateError?.message ?? "Failed to update preferences" },
      { status: 500 },
    );
  }

  const metadata = updated.user.user_metadata ?? {};

  return NextResponse.json({
    username: metadata.username ?? "",
    email: updated.user.email ?? null,
    provider: metadata.provider === "github" ? "github" : "credentials",
    preferences: resolvePreferences(metadata.preferences),
  });
}
