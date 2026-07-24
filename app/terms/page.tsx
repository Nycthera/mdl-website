import { MdBook } from "react-icons/md";
import Link from "next/link";

export default function Terms() {
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
          <h1 className="text-4xl font-bold mb-2">Terms of Service</h1>
          <p className="text-muted-foreground">Last updated July 2026</p>
        </div>

        <div className="space-y-8 text-sm leading-7 text-muted-foreground">
          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              1. Overview
            </h2>
            <p>
              MDL is an open-source toolkit that provides APIs, background
              workers, and archive-generation tooling for automating media
              workflows. By creating an account or using the service, you agree
              to these terms. If you don't agree, please don't use MDL.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              2. Your account
            </h2>
            <p>
              You're responsible for keeping your login credentials secure and
              for all activity that happens under your account. Let us know as
              soon as possible if you suspect unauthorized access.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              3. Acceptable use
            </h2>
            <p>
              MDL is a tool for downloading and organizing content you have the
              right to access. You're responsible for complying with copyright
              law and the terms of any third-party source you point MDL at.
              Don't use the service to circumvent access controls, redistribute
              copyrighted material without authorization, or overload upstream
              sources in a way that disrupts them for others.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              4. Availability
            </h2>
            <p>
              MDL is provided on an "as available" basis. Features, endpoints,
              and third-party source integrations may change or go away without
              notice, especially since much of the functionality depends on
              external sites that are outside our control.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              5. No warranty
            </h2>
            <p>
              As with the underlying software (see our{" "}
              <Link href="/license" className="text-primary hover:underline">
                license
              </Link>
              ), MDL is provided without warranties of any kind. We aren't
              liable for any damages arising from your use of the service.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              6. Changes
            </h2>
            <p>
              We may update these terms from time to time. Continued use of MDL
              after a change means you accept the updated terms.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
