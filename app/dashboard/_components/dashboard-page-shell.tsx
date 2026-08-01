import Link from "next/link";
import { MdBook } from "react-icons/md";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";

interface DashboardPageShellProps {
  title: string;
  description: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  backHref?: string;
}

export function DashboardPageShell({
  title,
  description,
  children,
  actions,
  backHref = "/dashboard",
}: DashboardPageShellProps) {
  return (
    <div className="min-h-screen bg-background">
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/dashboard" className="flex items-center gap-2">
            <MdBook className="h-6 w-6 text-primary" />
            <span className="font-bold text-lg">MDL</span>
          </Link>

          <div className="flex items-center gap-2">
            {backHref !== "/dashboard" && (
              <Button variant="ghost" size="sm" asChild>
                <Link href={backHref} className="flex items-center gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  <span className="hidden sm:inline">Back</span>
                </Link>
              </Button>
            )}
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard/preferences">Preferences</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/docs">Docs</Link>
            </Button>
          </div>
        </div>
      </nav>

      <main className="container mx-auto space-y-8 px-4 py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
            <p className="mt-1 text-muted-foreground">{description}</p>
          </div>
          {actions}
        </div>

        {children}
      </main>
    </div>
  );
}
