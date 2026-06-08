import type { Metadata } from "next";
import {
  Download,
  Database,
  Package,
  Zap,
  ArrowRight,
} from "lucide-react";
import Link from 'next/link'

export const metadata: Metadata = {
  title: "MDL — Intro",
  description:
    "MDL — Introduction and overview of the project and website.",
};

const features = [
  {
    icon: Zap,
    title: "API First",
    description:
      "Integrate MDL into existing workflows with a simple HTTP API.",
  },
  {
    icon: Download,
    title: "Background Jobs",
    description:
      "Queue downloads and monitor progress without blocking requests.",
  },
  {
    icon: Package,
    title: "Archive Creation",
    description:
      "Automatically package downloaded content into CBZ archives.",
  },
  {
    icon: Database,
    title: "Tracking System",
    description:
      "Resume interrupted workflows and keep track of processed items.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-black text-white">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-blue-500/20 blur-3xl" />
      </div>
      { /* top nav bar */}
      <nav className="relative z-10 border-b border-white/10 bg-black/20 backdrop-blur">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="text-xl font-bold">MDL</div>
            <div className="flex items-center gap-4">
              <Link href="/login" className="rounded-lg px-3 py-2 transition hover:bg-white/10">
                Login
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <div className="relative mx-auto max-w-6xl px-6 py-20">
        {/* Hero */}
        <section className="text-center">
          <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm backdrop-blur">
            Open Source Media Toolkit
          </div>

          <h1 className="mt-8 text-6xl font-black tracking-tight">
            MDL
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-300">
            A lightweight toolkit for discovering, downloading,
            packaging, and managing media workflows.
          </p>

          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <a
              href="/download"
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 font-medium transition hover:bg-blue-500"
            >
              Get Started
              <ArrowRight size={18} />
            </a>

            <a
              href="/docs/API.md"
              className="rounded-xl border border-white/10 bg-white/5 px-6 py-3 backdrop-blur transition hover:bg-white/10"
            >
              API Documentation
            </a>
          </div>
        </section>

        {/* Stats */}
        <section className="mt-24 grid gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <div className="text-3xl font-bold">REST</div>
            <div className="mt-1 text-slate-400">
              Modern API architecture
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <div className="text-3xl font-bold">CBZ</div>
            <div className="mt-1 text-slate-400">
              Built-in packaging support
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <div className="text-3xl font-bold">24/7</div>
            <div className="mt-1 text-slate-400">
              Background job processing
            </div>
          </div>
        </section>

        {/* About */}
        <section className="mt-28">
          <h2 className="text-3xl font-bold">What is MDL?</h2>

          <p className="mt-4 max-w-3xl text-slate-300 leading-relaxed">
            MDL provides a modular backend and frontend for
            discovering, downloading, and packaging media. It
            includes a flexible API, job queue system, archive
            creation tools, and workflow tracking capabilities.
          </p>
        </section>

        {/* Features */}
        <section className="mt-16">
          <div className="grid gap-6 md:grid-cols-2">
            {features.map((feature) => {
              const Icon = feature.icon;

              return (
                <div
                  key={feature.title}
                  className="group rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur transition hover:border-blue-500/50 hover:bg-white/10"
                >
                  <Icon
                    size={28}
                    className="mb-4 text-blue-400"
                  />

                  <h3 className="text-xl font-semibold">
                    {feature.title}
                  </h3>

                  <p className="mt-2 text-slate-400">
                    {feature.description}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

      </div>
    </main>
  );
}