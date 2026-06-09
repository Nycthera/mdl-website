import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import {
  Download,
  FileText,
  Database,
  Workflow,
  ArrowRight,
} from "lucide-react";

export const metadata: Metadata = {
  title: "MDL — Intro",
  description: "MDL — Introduction and overview of the project.",
};

export default function Home() {
  return (
    <main className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary" />
            <span className="font-bold text-lg">MDL</span>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="ghost" asChild>
              <Link href="/docs/API.md">Docs</Link>
            </Button>

            <Button asChild>
              <Link href="/login">Login</Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/10 via-transparent to-transparent" />

        <div className="container mx-auto py-28 text-center">
          <Badge variant="secondary" className="mb-4">
            Media Download Toolkit
          </Badge>

          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight">
            Build and manage
            <span className="block text-primary">
              media workflows
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-muted-foreground text-lg">
            MDL provides APIs, background workers, archive generation,
            and workflow tracking for modern media automation.
          </p>

          <div className="mt-8 flex justify-center gap-4">
            <Button size="lg" asChild>
              <Link href="/download">
                Get Started
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>

            <Button variant="outline" size="lg" asChild>
              <Link href="/docs/API.md">
                <FileText className="mr-2 h-4 w-4" />
                API Docs
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="container mx-auto py-20">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold">
            Everything you need
          </h2>
          <p className="mt-3 text-muted-foreground">
            Built for developers who automate content workflows.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <Database className="h-8 w-8 text-primary" />
              <CardTitle>API First</CardTitle>
              <CardDescription>
                Integrate MDL into existing tools and services.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <Workflow className="h-8 w-8 text-primary" />
              <CardTitle>Background Jobs</CardTitle>
              <CardDescription>
                Queue and monitor long-running downloads.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <Download className="h-8 w-8 text-primary" />
              <CardTitle>Archive Creation</CardTitle>
              <CardDescription>
                Generate CBZ files and package media automatically.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <Database className="h-8 w-8 text-primary" />
              <CardTitle>Progress Tracking</CardTitle>
              <CardDescription>
                Resume workflows and keep records of processed items.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>

      {/* About */}
      <section className="container mx-auto pb-24">
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle>Who is MDL for?</CardTitle>
            <CardDescription>
              Developers, hobbyists, and automation enthusiasts.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <p className="text-muted-foreground">
              Whether you're building download pipelines, creating archive
              workflows, or automating content management, MDL provides
              a lightweight foundation that is easy to extend.
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}