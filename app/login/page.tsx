"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { Eye, EyeOff, ArrowRight } from "lucide-react";
import { FaGithub as Github } from "react-icons/fa";
import { MdBook } from "react-icons/md";

export default function LoginPage() {
  const router = useRouter();

  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setError("");
    setIsLoading(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Invalid email or password");
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign in");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGithubSignIn = () => {
    signIn("github", { callbackUrl: "/dashboard" });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="grid min-h-screen lg:grid-cols-2">
        {/* Left Side */}
        <div className="hidden lg:flex flex-col justify-between border-r bg-muted/30 p-12">
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
                Manage your media workflows.
              </h1>

              <p className="text-lg text-muted-foreground">
                Download, package, track and automate manga processing from a
                single dashboard.
              </p>
            </div>
          </div>

          <Card>
            {/* add some stats */}
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
          <Card className="w-full max-w-md">
            <CardHeader className="space-y-2">
              <CardTitle className="text-3xl">Welcome back</CardTitle>

              <CardDescription>Sign in to continue to MDL</CardDescription>
            </CardHeader>

            <CardContent>
              <div className="space-y-6">
                <Button
                  variant="outline"
                  className="w-full"
                  type="button"
                  onClick={handleGithubSignIn}
                >
                  <Github className="mr-2 h-4 w-4" />
                  Continue with GitHub
                </Button>

                <div className="flex items-center gap-3">
                  <Separator className="flex-1" />
                  <span className="text-xs text-muted-foreground">
                    OR CONTINUE WITH EMAIL
                  </span>
                  <Separator className="flex-1" />
                </div>

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

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password">Password</Label>

                      <Link
                        href="/forgot-password"
                        className="text-sm text-muted-foreground hover:text-foreground"
                      >
                        Forgot password?
                      </Link>
                    </div>

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

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="remember"
                      checked={rememberMe}
                      onCheckedChange={(value) => setRememberMe(value === true)}
                    />

                    <Label htmlFor="remember" className="font-normal">
                      Keep me signed in
                    </Label>
                  </div>

                  {error && (
                    <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                      {error}
                    </div>
                  )}

                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? (
                      "Signing in..."
                    ) : (
                      <>
                        Sign In
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </form>

                <p className="text-center text-sm text-muted-foreground">
                  Don't have an account?{" "}
                  <Link
                    href="/register"
                    className="font-medium text-foreground hover:underline"
                  >
                    Create one
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
