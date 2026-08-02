"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { MdBook } from "react-icons/md";
import { ArrowLeft, Loader2 } from "lucide-react";
import { FaGithub as Github } from "react-icons/fa";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useDensity,
  type Density,
} from "@/components/providers/density-provider";
import {
  DEFAULT_APP_PREFERENCES,
  type AppPreferences,
  type DefaultSource,
  type AutoCheckFrequency,
} from "@/lib/preferences";

interface PreferencesResponse {
  username: string;
  email: string | null;
  provider: "github" | "credentials";
  preferences: AppPreferences;
}

export default function PreferencesPage() {
  const router = useRouter();
  const { status, update } = useSession();
  const { theme, setTheme } = useTheme();
  const { density, setDensity } = useDensity();

  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<"github" | "credentials">(
    "credentials",
  );
  const [email, setEmail] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const [prefs, setPrefs] = useState<AppPreferences>(DEFAULT_APP_PREFERENCES);
  const [savingPrefs, setSavingPrefs] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated") return;

    async function load() {
      try {
        const res = await fetch("/api/v1/preferences");
        if (!res.ok) throw new Error("Failed to load preferences");
        const data: PreferencesResponse = await res.json();
        setUsername(data.username);
        setEmail(data.email);
        setProvider(data.provider);
        setPrefs(data.preferences);
      } catch {
        toast.error("Couldn't load your preferences");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [status]);

  async function saveAccount(e: React.FormEvent) {
    e.preventDefault();
    setSavingAccount(true);
    try {
      const res = await fetch("/api/v1/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");

      // Refresh the NextAuth JWT so the new name shows up immediately
      // (nav, dashboard, etc.) instead of only after a re-login.
      await update({ name: data.username });
      toast.success("Profile updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingAccount(false);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords don't match.");
      return;
    }

    setSavingPassword(true);
    try {
      const res = await fetch("/api/v1/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update password");

      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingPassword(false);
    }
  }

  async function savePrefs(next: AppPreferences) {
    setPrefs(next);
    setSavingPrefs(true);
    try {
      const res = await fetch("/api/v1/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setPrefs(data.preferences);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingPrefs(false);
    }
  }

  if (status === "loading" || (status === "authenticated" && loading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <MdBook className="h-6 w-6 text-primary" />
            <span className="font-bold text-lg">MDL</span>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard" className="flex items-center">
              <ArrowLeft className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Back to dashboard</span>
            </Link>
          </Button>
        </div>
      </nav>

      <div className="container mx-auto max-w-2xl space-y-8 px-4 py-8">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Preferences</h1>
          <p className="text-muted-foreground mt-1">
            Manage your account, defaults, and how the dashboard looks.
          </p>
        </div>

        {/* Account */}
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>
              {email ?? "Your account details"}
              {provider === "github" && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs">
                  <Github className="h-3 w-3" /> Signed in with GitHub
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <form onSubmit={saveAccount}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Display name</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Your username"
                  required
                />
              </div>
            </CardContent>
            <CardFooter className="justify-end gap-2 pt-4">
              <Button type="submit" size="sm" disabled={savingAccount}>
                {savingAccount ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Save"
                )}
              </Button>
            </CardFooter>
          </form>
        </Card>

        {/* Password */}
        {provider === "credentials" && (
          <Card>
            <CardHeader>
              <CardTitle>Password</CardTitle>
              <CardDescription>
                Change the password you use to sign in.
              </CardDescription>
            </CardHeader>
            <form onSubmit={savePassword}>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm new password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
              </CardContent>
              <CardFooter className="justify-end gap-2 pt-4">
                <Button
                  type="submit"
                  size="sm"
                  disabled={savingPassword || !newPassword}
                >
                  {savingPassword ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Update password"
                  )}
                </Button>
              </CardFooter>
            </form>
          </Card>
        )}

        {/* App behavior */}
        <Card>
          <CardHeader>
            <CardTitle>App behavior</CardTitle>
            <CardDescription>
              Defaults used for new downloads and update checks.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="default-source">Default source</Label>
              <Select
                value={prefs.defaultSource}
                onValueChange={(value) =>
                  savePrefs({ ...prefs, defaultSource: value as DefaultSource })
                }
              >
                <SelectTrigger id="default-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mangadex">MangaDex</SelectItem>
                  <SelectItem value="weebcentral">WeebCentral</SelectItem>
                  <SelectItem value="manual">Manual URL</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Pre-selected when you add a new manga to your library.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="auto-check">Auto-check for new chapters</Label>
              <Select
                value={prefs.autoCheckFrequency}
                onValueChange={(value) =>
                  savePrefs({
                    ...prefs,
                    autoCheckFrequency: value as AutoCheckFrequency,
                  })
                }
              >
                <SelectTrigger id="auto-check">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">Off — check manually</SelectItem>
                  <SelectItem value="daily">Once a day</SelectItem>
                  <SelectItem value="twice_daily">Twice a day</SelectItem>
                  <SelectItem value="hourly">Every hour</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="notify-new" className="normal-case">
                  New chapter notifications
                </Label>
                <p className="text-xs text-muted-foreground">
                  Let me know when a tracked series has a new chapter.
                </p>
              </div>
              <Switch
                id="notify-new"
                checked={prefs.notifyOnNewChapters}
                onCheckedChange={(checked) =>
                  savePrefs({ ...prefs, notifyOnNewChapters: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="notify-failed" className="normal-case">
                  Failed job notifications
                </Label>
                <p className="text-xs text-muted-foreground">
                  Let me know if a download or update check fails.
                </p>
              </div>
              <Switch
                id="notify-failed"
                checked={prefs.notifyOnFailedJobs}
                onCheckedChange={(checked) =>
                  savePrefs({ ...prefs, notifyOnFailedJobs: checked })
                }
              />
            </div>
          </CardContent>
          {savingPrefs && (
            <CardFooter className="justify-end pt-0">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Saving…
              </span>
            </CardFooter>
          )}
        </Card>

        {/* Appearance */}
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>
              Stored on this device only — these don&apos;t sync between
              browsers.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="theme">Theme</Label>
              <Select value={theme} onValueChange={setTheme}>
                <SelectTrigger id="theme">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="system">Match system</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="density">Density</Label>
              <Select
                value={density}
                onValueChange={(value) => setDensity(value as Density)}
              >
                <SelectTrigger id="density">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="comfortable">Comfortable</SelectItem>
                  <SelectItem value="compact">Compact</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Compact tightens spacing throughout the dashboard.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
