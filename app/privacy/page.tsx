import { MdBook } from "react-icons/md";
import Link from "next/link";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <MdBook className="h-6 w-6 text-primary" />
            <span className="font-bold text-lg">MDL</span>
          </Link>
        </div>
      </nav>

      <div className="container mx-auto max-w-3xl py-16 px-4">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-4xl font-bold mb-2">Privacy Policy</h1>
          <p className="text-muted-foreground">Last updated July 2026</p>
        </div>

        <div className="space-y-8 text-sm leading-7 text-muted-foreground">
          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              1. What we collect
            </h2>
            <p>
              When you create an account, we store your email address, username,
              and a securely hashed password (or your GitHub account identifier,
              if you sign in with GitHub). We also store the library data you
              build in MDL — series you've added, download jobs, and their
              status — so your dashboard works across sessions.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              2. How we use it
            </h2>
            <p>
              Your account data is used to authenticate you, run the downloads
              and archive jobs you request, and show you their status. We use
              error monitoring (Sentry) to catch and fix bugs; this may include
              minimal request metadata tied to your user ID, but never your
              password or download contents.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              3. Third-party sources
            </h2>
            <p>
              MDL fetches content from third-party manga sources on your behalf,
              based on URLs or search terms you provide. Those requests are made
              server-side and aren't shared with anyone beyond what's needed to
              fulfill the request.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              4. Data retention
            </h2>
            <p>
              We keep your account and library data for as long as your account
              is active. You can request deletion of your account and associated
              data at any time by contacting us through the project's GitHub
              repository.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              5. Data sharing
            </h2>
            <p>
              We don't sell your data or share it with advertisers. Data is only
              shared with the infrastructure providers that make MDL run —
              currently Supabase (auth and database) and Vercel (hosting and
              analytics).
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              6. Open source
            </h2>
            <p>
              MDL's source code is available under the{" "}
              <Link href="/license" className="text-primary hover:underline">
                MIT license
              </Link>
              , so you can see exactly how your data is handled.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              7. Changes
            </h2>
            <p>
              We may update this policy as the project evolves. Material changes
              will be reflected here with an updated date.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
