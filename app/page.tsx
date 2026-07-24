"use client";

import { useEffect } from "react";
import Link from "next/link";
import { MdBook } from "react-icons/md";
import { ArrowRight, Download, Library, ShieldCheck } from "lucide-react";
import { FaGithub as Github } from "react-icons/fa";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { revealIn } from "@/lib/animations";

const features = [
  {
    icon: Library,
    title: "Multiple sources, one library",
    description:
      "Pull chapters from MangaDex, WeebCentral, or a manual mirror URL. Everything lands in the same dashboard, tracked the same way.",
  },
  {
    icon: Download,
    title: "Built for long jobs",
    description:
      "Scrapes run as background tasks with live progress, so a 40-chapter series doesn't time out halfway through like a plain serverless request would.",
  },
  {
    icon: ShieldCheck,
    title: "Private by design",
    description:
      "Page images are proxied straight to your browser and zipped into a .cbz client-side — the raw image bytes never touch our storage.",
  },
];

export default function HomePage() {
  useEffect(() => {
    revealIn(".hero-eyebrow", { duration: 500 });
    revealIn(".hero-title", { duration: 700, delay: 80, y: 18 });
    revealIn(".hero-sub", { duration: 600, delay: 200 });
    revealIn(".hero-cta", { duration: 500, delay: 320, staggerMs: 60 });
    revealIn(".feature-card", { duration: 600, delay: 250, staggerMs: 90 });
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <MdBook className="h-6 w-6 text-primary" />
            <span className="font-bold text-lg">MDL</span>
          </Link>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/docs">Docs</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/login">Log in</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/register">
                Get started
                <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="container mx-auto flex flex-col items-center px-4 pt-24 pb-20 text-center">
        <span
          className="hero-eyebrow text-xs font-semibold tracking-widest text-muted-foreground uppercase"
          style={{ opacity: 0 }}
        >
          Manga download library
        </span>

        <h1
          className="hero-title mt-5 max-w-3xl text-4xl font-bold tracking-tight text-balance md:text-6xl"
          style={{ opacity: 0 }}
        >
          Your manga, archived and ready to read offline.
        </h1>

        <p
          className="hero-sub mt-6 max-w-xl text-base text-muted-foreground md:text-lg"
          style={{ opacity: 0 }}
        >
          Point MDL at a series, pick a source, and walk away. It resolves every
          chapter in the background and hands you back clean .cbz files.
        </p>

        <div
          className="hero-cta mt-9 flex flex-wrap items-center justify-center gap-3"
          style={{ opacity: 0 }}
        >
          <Button size="lg" asChild>
            <Link href="/register">
              Get started
              <ArrowRight />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/docs">Read the docs</Link>
          </Button>
        </div>
      </section>

      {/* Features */}
      <section className="container mx-auto px-4 pb-24">
        <div className="grid gap-5 md:grid-cols-3">
          {features.map(({ icon: Icon, title, description }) => (
            <Card key={title} className="feature-card" style={{ opacity: 0 }}>
              <CardHeader>
                <div className="mb-1 flex h-10 w-10 items-center justify-center border border-primary/20 bg-primary/5">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <CardTitle className="text-base">{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <footer className="border-t">
        <div className="container mx-auto flex flex-col items-center gap-4 px-4 py-10 text-sm text-muted-foreground md:flex-row md:justify-between">
          <div className="flex items-center gap-2">
            <MdBook className="h-4 w-4 text-primary" />
            <span>MDL — manga download library</span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <Link href="/docs" className="hover:text-foreground">
              Docs
            </Link>
            <Link href="/license" className="hover:text-foreground">
              License
            </Link>
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
            <a
              href="https://github.com/Nycthera"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 hover:text-foreground"
            >
              <Github className="h-4 w-4" />
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
