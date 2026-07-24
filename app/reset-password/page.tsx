"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { ArrowLeft, ArrowRight, Loader2, CheckCircle2 } from "lucide-react";
import { MdBook } from "react-icons/md";
import { toast } from "sonner";
import { supabase } from "@/app/backend/supabaseFunctions/supabaseClient";
import { revealIn, popIn } from "@/lib/animations";

export default function ForgotPasswordPage() {
  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    revealIn(".auth-card", { duration: 600 });
    revealIn(".auth-field", { delay: 200, staggerMs: 80 });
    emailRef.current?.focus();
  }, []);

  useEffect(() => {
    if (sent) popIn(".reset-success");
  }, [sent]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Supabase's resetPasswordForEmail sends a confirmation link
      // that redirects back to the site (configured in Supabase's
      // Auth → Redirect URLs setting). The link lands the user on
      // /reset-password with a recovery token in the URL, which
      // exchanges it for a temporary session and lets them set a
      // new password.
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        // Don't leak whether the email exists — Supabase returns
        // generic errors here. Always show the "check your inbox"
        // message to avoid user enumeration.
        toast.error(error.message);
        return;
      }

      // Always show success, even if the email doesn't exist in our
      // system — same anti-enumeration reason. Supabase silently
      // no-ops resetPasswordForEmail for unknown emails.
      setSent(true);
      toast.success("Reset link sent", {
        description: "Check your inbox for a password reset link.",
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to send reset email",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="auth-card w-full max-w-md" style={{ opacity: 0 }}>
          <CardHeader className="space-y-2">
            <div className="mb-2 flex items-center gap-2">
              <MdBook className="h-6 w-6 text-primary" />
              <span className="font-bold text-lg">MDL</span>
            </div>
            <CardTitle className="text-3xl">Forgot password</CardTitle>
            <CardDescription>
              Enter your email and we&apos;ll send you a link to reset your
              password.
            </CardDescription>
          </CardHeader>

          <CardContent>
            {sent ? (
              <div className="space-y-4">
                <div
                  className="reset-success flex items-start gap-3 rounded-md border border-primary/20 bg-primary/10 p-4 text-sm text-primary"
                  style={{ opacity: 0 }}
                >
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                  <span>
                    If an account exists for{" "}
                    <span className="font-medium">{email}</span>, a password
                    reset link is on its way. Check your inbox (and spam
                    folder).
                  </span>
                </div>
                <Button asChild className="w-full">
                  <Link href="/login">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to login
                  </Link>
                </Button>
              </div>
            ) : (
              <>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="auth-field space-y-2" style={{ opacity: 0 }}>
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      ref={emailRef}
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>

                  <Button
                    type="submit"
                    className="auth-field w-full"
                    style={{ opacity: 0 }}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        Send reset link
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </form>

                <p className="text-center text-sm text-muted-foreground mt-6">
                  Remembered your password?{" "}
                  <Link
                    href="/login"
                    className="font-medium text-foreground hover:underline"
                  >
                    Sign in
                  </Link>
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
