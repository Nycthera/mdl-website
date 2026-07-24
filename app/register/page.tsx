"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { Eye, EyeOff, ArrowRight, Loader2, Check, X } from "lucide-react";
import { FaGithub as Github } from "react-icons/fa";
import { MdBook } from "react-icons/md";
import { toast } from "sonner";
import { registerUser } from "@/app/backend/supabaseFunctions/createUser/createUser";
import { revealIn, shake, popIn } from "@/lib/animations";

export default function RegisterPage() {
  const router = useRouter();
  const usernameRef = useRef<HTMLInputElement>(null);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);
  const [error, setError] = useState("");

  // Live feedback as the user types the confirmation field, instead of
  // only finding out about a mismatch after submitting the whole form.
  const passwordsMismatch = confirm.length > 0 && password !== confirm;
  const passwordsMatch = confirm.length > 0 && password === confirm;

  useEffect(() => {
    revealIn(".auth-left", { duration: 700 });
    revealIn(".auth-card", { duration: 700, delay: 100 });
    revealIn(".auth-field", { delay: 250, staggerMs: 70 });
    usernameRef.current?.focus();
  }, []);

  useEffect(() => {
    if (error) shake(".register-error");
  }, [error]);

  useEffect(() => {
    if (passwordsMatch) popIn(".match-indicator");
  }, [passwordsMatch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setIsLoading(true);

    try {
      // 1. Create the user in Supabase. registerUser now tells us
      //    whether Supabase requires email confirmation before login
      //    is allowed — this is the production default but OFF in the
      //    local Supabase CLI, which is why signup→login worked
      //    locally but silently bounced to /login on Vercel.
      const result = await registerUser(email, password, username);

      // 2. If email confirmation is required, don't even try to
      //    auto-sign-in — signInWithPassword would return "Email not
      //    confirmed" and we'd silently bounce to /login with no
      //    explanation. Instead, redirect to /login with a query
      //    param so the login page can show a clear "check your
      //    inbox" message.
      if (result.emailConfirmationRequired) {
        toast.success("Account created!", {
          description: "Check your inbox to confirm your email, then sign in.",
        });
        router.push("/login?registered=confirm-email");
        return;
      }

      // 3. Email confirmation NOT required — attempt auto-sign-in
      //    with NextAuth credentials provider so the user lands on
      //    /dashboard without typing their password again.
      const signInResult = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (signInResult?.error) {
        // Account was created but auto-sign-in failed for some other
        // reason (rare — most likely a transient Supabase hiccup).
        // Surface the actual error to the user instead of silently
        // bouncing, and send them to /login with a generic
        // "registered" flag so the login page knows to show a
        // success-style message.
        console.error("Auto sign-in failed after signup:", signInResult.error);
        toast.success("Account created!", {
          description: "Please sign in to continue.",
        });
        router.push("/login?registered=1");
      } else {
        toast.success("Welcome to MDL!");
        router.push("/dashboard");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create account");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGithubSignIn = () => {
    setGithubLoading(true);
    signIn("github", { callbackUrl: "/dashboard" });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="grid min-h-screen lg:grid-cols-2">
        {/* Left Side */}
        <div
          className="auth-left hidden lg:flex flex-col justify-between border-r bg-muted/30 p-12"
          style={{ opacity: 0 }}
        >
          <div>
            <div className="mb-12 flex items-center gap-2">
              <MdBook className="h-8 w-8 text-primary" />
              <span className="font-bold text-lg">MDL</span>
            </div>

            <div className="max-w-md space-y-6">
              <div className="inline-flex items-center rounded-full border px-3 py-1 text-sm text-muted-foreground">
                Manga Download Platform
              </div>

              <h1 className="text-5xl font-bold tracking-tight">
                Start automating your media.
              </h1>

              <p className="text-lg text-muted-foreground">
                Create an account to access downloads, archive generation, and
                workflow tracking from a single dashboard.
              </p>
            </div>
          </div>

          <Card>
            <CardContent className="grid gap-4">
              <div className="flex items-center gap-4">
                <div className="rounded-full bg-primary/10 p-2">
                  <MdBook className="h-6 w-6 text-primary" />
                </div>
                <div>Blazing fast downloads</div>
              </div>
              <div className="flex items-center gap-4">
                <div className="rounded-full bg-primary/10 p-2">
                  <MdBook className="h-6 w-6 text-primary" />
                </div>
                <div>Custom archive generation</div>
              </div>
              <div className="flex items-center gap-4">
                <div className="rounded-full bg-primary/10 p-2">
                  <MdBook className="h-6 w-6 text-primary" />
                </div>
                <div>Workflow tracking and logs</div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Side */}
        <div className="flex items-center justify-center p-6">
          <Card className="auth-card w-full max-w-md" style={{ opacity: 0 }}>
            <CardHeader className="space-y-2">
              <CardTitle className="text-3xl">Create an account</CardTitle>
              <CardDescription>Get started with MDL for free</CardDescription>
            </CardHeader>

            <CardContent>
              <div className="space-y-6">
                <Button
                  variant="outline"
                  className="auth-field w-full"
                  style={{ opacity: 0 }}
                  type="button"
                  onClick={handleGithubSignIn}
                  disabled={githubLoading || isLoading}
                >
                  {githubLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Github className="mr-2 h-4 w-4" />
                  )}
                  {githubLoading ? "Redirecting..." : "Continue with GitHub"}
                </Button>

                <div
                  className="auth-field flex items-center gap-3"
                  style={{ opacity: 0 }}
                >
                  <Separator className="flex-1" />
                  <span className="text-xs text-muted-foreground">
                    OR CONTINUE WITH EMAIL
                  </span>
                  <Separator className="flex-1" />
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="auth-field space-y-2" style={{ opacity: 0 }}>
                    <Label htmlFor="username">Username</Label>
                    <Input
                      id="username"
                      ref={usernameRef}
                      type="text"
                      placeholder="Your username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                    />
                  </div>

                  <div className="auth-field space-y-2" style={{ opacity: 0 }}>
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>

                  <div className="auth-field space-y-2" style={{ opacity: 0 }}>
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="auth-field space-y-2" style={{ opacity: 0 }}>
                    <Label htmlFor="confirm">Confirm password</Label>
                    <div className="relative">
                      <Input
                        id="confirm"
                        type={showConfirm ? "text" : "password"}
                        placeholder="••••••••"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        aria-invalid={passwordsMismatch}
                        className={
                          passwordsMismatch ? "border-b-destructive" : undefined
                        }
                        required
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-8 top-1/2 -translate-y-1/2"
                        onClick={() => setShowConfirm(!showConfirm)}
                      >
                        {showConfirm ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                      {passwordsMatch && (
                        <Check
                          className="match-indicator absolute right-1 top-1/2 h-4 w-4 -translate-y-1/2 text-green-600"
                          style={{ opacity: 0 }}
                        />
                      )}
                      {passwordsMismatch && (
                        <X className="absolute right-1 top-1/2 h-4 w-4 -translate-y-1/2 text-destructive" />
                      )}
                    </div>
                    {passwordsMismatch && (
                      <p className="text-xs text-destructive">
                        Passwords don't match yet
                      </p>
                    )}
                  </div>

                  {error && (
                    <div className="register-error rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                      {error}
                    </div>
                  )}

                  <Button
                    type="submit"
                    className="auth-field w-full"
                    style={{ opacity: 0 }}
                    disabled={isLoading || githubLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating account...
                      </>
                    ) : (
                      <>
                        Create Account
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </form>

                <p className="text-center text-xs text-muted-foreground">
                  By creating an account, you agree to our{" "}
                  <Link
                    href="/terms"
                    className="underline hover:text-foreground"
                  >
                    Terms
                  </Link>{" "}
                  and{" "}
                  <Link
                    href="/privacy"
                    className="underline hover:text-foreground"
                  >
                    Privacy Policy
                  </Link>
                  .
                </p>

                <p className="text-center text-sm text-muted-foreground">
                  Already have an account?{" "}
                  <Link
                    href="/login"
                    className="font-medium text-foreground hover:underline"
                  >
                    Sign in
                  </Link>
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
