"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { animate, stagger } from "animejs";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MdBook } from "react-icons/md";
import { Download, FileText, Database, Workflow, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { supabase } from "./backend/supabaseFunctions/supabaseClient";

import { toast } from "sonner";

export default function Home() {
  const featuresRef = useRef<HTMLDivElement>(null);
  const aboutRef = useRef<HTMLElement>(null);
  const router = useRouter();
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    // Navbar
    animate("nav", {
      translateY: [-20, 0],
      opacity: [0, 1],
      duration: 600,
      ease: "out(3)",
    });

    // Hero stagger
    animate(".hero-item", {
      translateY: [40, 0],
      opacity: [0, 1],
      duration: 800,
      delay: stagger(120, { start: 200 }),
      ease: "out(3)",
    });

    // Feature cards on scroll
    const featureObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            animate(".feature-card", {
              translateY: [50, 0],
              opacity: [0, 1],
              duration: 700,
              delay: stagger(100),
              ease: "out(3)",
            });
            featureObserver.disconnect();
          }
        });
      },
      { threshold: 0.15 }
    );

    if (featuresRef.current) featureObserver.observe(featuresRef.current);

    // About card on scroll
    const aboutObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            animate(".about-card", {
              translateY: [40, 0],
              opacity: [0, 1],
              duration: 700,
              ease: "out(3)",
            });
            aboutObserver.disconnect();
          }
        });
      },
      { threshold: 0.2 }
    );

    if (aboutRef.current) aboutObserver.observe(aboutRef.current);

    return () => {
      featureObserver.disconnect();
      aboutObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setLoggedIn(true);
        toast("You're already logged in", {
          id: "logged-in-toast",  // ✅ prevents duplicate toasts
          description: "Head back to your dashboard.",
          action: {
            label: "Go to Dashboard",
            onClick: () => {
              toast.dismiss("logged-in-toast");  // dismiss on navigate
              router.push("/dashboard");
            },
          },
          duration: 8000,
          style: {
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            color: "hsl(var(--card-foreground))",
          },
          classNames: {
            description: "!text-muted-foreground",
            actionButton: "!bg-primary !text-primary-foreground",
          },
        });
      }
    }
    checkAuth();

    // dismiss toast when leaving the page
    return () => { toast.dismiss("logged-in-toast"); };
  }, [router]);

  
  return (
    <main className="min-h-screen bg-background">
      {/* Navbar */}
      <nav
        style={{ opacity: 0 }}
        className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur"
      >
        <div className="container mx-auto flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <MdBook className="h-6 w-6 text-primary" />
            <span className="font-bold text-lg">MDL</span>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" asChild>
              <Link href="/docs/API.md">Docs</Link>
            </Button>
            <Button asChild className="rounded-xl">
              <Link href={loggedIn ? "/dashboard" : "/login"}>
                {loggedIn ? "Dashboard" : "Login"}
              </Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-linear-to-b from-primary/10 via-transparent to-transparent" />
        <div className="container mx-auto py-28 text-center">
          <Badge variant="secondary" className="hero-item mb-4" style={{ opacity: 0 }}>
            Manga Download Toolkit
          </Badge>

          <h1 className="hero-item opacity-0 text-5xl md:text-7xl font-extrabold tracking-tight">
            Build and manage
            <span className="block text-primary">media workflows</span>
          </h1>

          <p className="hero-item opacity-0 mx-auto mt-6 max-w-2xl text-muted-foreground text-lg">
            MDL provides APIs, background workers, archive generation, and
            workflow tracking for modern media automation.
          </p>

          <div className="hero-item opacity-0 mt-8 flex justify-center gap-4">
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
      <section ref={featuresRef} className="container mx-auto py-20">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold">Everything you need</h2>
          <p className="mt-3 text-muted-foreground">
            Built for developers who automate content workflows.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {[
            { icon: <Database className="h-8 w-8 text-primary" />, title: "API First", desc: "Integrate MDL into existing tools and services." },
            { icon: <Workflow className="h-8 w-8 text-primary" />, title: "Background Jobs", desc: "Queue and monitor long-running downloads." },
            { icon: <Download className="h-8 w-8 text-primary" />, title: "Archive Creation", desc: "Generate CBZ files and package media automatically." },
            { icon: <Database className="h-8 w-8 text-primary" />, title: "Progress Tracking", desc: "Resume workflows and keep records of processed items." },
          ].map(({ icon, title, desc }) => (
            <Card key={title} className="feature-card" style={{ opacity: 0 }}>
              <CardHeader>
                {icon}
                <CardTitle>{title}</CardTitle>
                <CardDescription>{desc}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      {/* About */}
      <section ref={aboutRef} className="container mx-auto pb-24">
        <Card className="about-card border-primary/20 bg-primary/5" style={{ opacity: 0 }}>
          <CardHeader>
            <CardTitle>Who is MDL for?</CardTitle>
            <CardDescription>Developers, hobbyists, and automation enthusiasts.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Whether you're building download pipelines, creating archive workflows,
              or automating content management, MDL provides a lightweight foundation
              that is easy to extend.
            </p>
          </CardContent>
        </Card>
      </section>
      <footer className="border-t border-border/40 py-12">
        <div className="container mx-auto">
          <p className="text-center text-sm text-muted-foreground">
            © {new Date().getFullYear()} MDL. All rights reserved. Licensed <a href="/license" className="text-primary hover:underline">here</a>
          </p>
        </div>
      </footer>
    </main>
  );
}