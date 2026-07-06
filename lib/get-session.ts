// lib/get-session.ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns the signed-in user's id from the NextAuth session, or null.
 *
 *  Also validates the id is a real UUID. This matters because the id
 *  ultimately gets written into `download_history.user_id` (a `uuid`
 *  column, via the Trigger.dev task). A stale JWT session — e.g. one
 *  minted before the GitHub-login id mapping was fixed — can otherwise
 *  carry a non-UUID value (like GitHub's own numeric profile id) all
 *  the way into that insert, where it fails with a cryptic Postgres
 *  error far from the actual cause. Rejecting it here instead just
 *  forces the client to treat the user as logged out, so they get
 *  redirected to sign in again and pick up a corrected token. */
export async function getSessionUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const id = session?.user?.id;

  if (!id || !UUID_RE.test(id)) return null;

  return id;
}
