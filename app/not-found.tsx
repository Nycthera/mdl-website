"use client";

import { useEffect } from "react";
import Link from "next/link";
import { MdBook } from "react-icons/md";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Compass } from "lucide-react";
import { revealIn } from "@/lib/animations";

export default function NotFound() {
  useEffect(() => {
    revealIn(".notfound-code", { duration: 700, y: 20 });
    revealIn(".notfound-item", { delay: 150, staggerMs: 100 });
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <MdBook className="h-6 w-6 text-primary" />
            <span className="font-bold text-lg">MDL</span>
          </Link>
        </div>
      </nav>

      <div className="container mx-auto flex min-h-[calc(100vh-4rem)] max-w-xl flex-col items-center justify-center px-4 text-center">
        <span
          className="notfound-code text-sm font-medium text-muted-foreground"
          style={{ opacity: 0 }}
        >
          404
        </span>
        <h1
          className="notfound-item mt-3 text-4xl font-bold tracking-tight md:text-5xl"
          style={{ opacity: 0 }}
        >
          Page not found
        </h1>
        <p
          className="notfound-item mt-4 text-muted-foreground"
          style={{ opacity: 0 }}
        >
          The page you're looking for doesn't exist, moved, or the manga you
          wanted got delisted. Let's get you back on track.
        </p>

        <div
          className="notfound-item mt-8 flex flex-wrap justify-center gap-3"
          style={{ opacity: 0 }}
        >
          <Button asChild size="lg">
            <Link href="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back home
            </Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link href="/docs">
              <Compass className="mr-2 h-4 w-4" />
              Browse the docs
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
