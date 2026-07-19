"use client";

import { useState } from "react";
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

import { ArrowLeft, ArrowRight } from "lucide-react";
import { MdBook } from "react-icons/md";
import { toast } from "sonner";
import { supabase } from "@/app/backend/supabaseFunctions/supabaseClient";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Supabase's resetPasswordForEmail sends a confirmation link
      // that redirects back to the site (configured in Supabase's
      // Auth → Redirect URLs setting). The link lands the user on
      // a /reset-password page (not yet implemented) with a recovery
      // token in the URL — for now we just trigger the email and
      // tell the user to check their inbox.
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login`,
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
        <Card className="w-full max-w-md">
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
                <div className="rounded-md border border-primary/20 bg-primary/10 p-4 text-sm text-primary">
                  If an account exists for{" "}
                  <span className="font-medium">{email}</span>, a password reset
                  link is on its way. Check your inbox (and spam folder).
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
                  <div className="space-y-2">
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

                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? (
                      "Sending..."
                    ) : (
                      <>
                        Send reset link
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </form>

                <p className="text-center text-sm text-muted-foreground">
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
