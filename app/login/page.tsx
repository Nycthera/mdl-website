"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { logInUser } from "@/app/backend/supabaseFunctions/loginInUser";


export default function Login() {
    const router = useRouter();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");

    if (isLoggedIn) {
        router.push("/home?login=success");
    }

    async function handleLogin() {
        setErrorMessage("");
        setIsLoading(true);

        try {
            const userData = await logInUser(email, password);

            console.log(userData);

            if (userData?.user) {
                setIsLoggedIn(true);
            } else {
                setErrorMessage("Login failed.");
            }
        } catch (error: any) {
            console.error(error);
            setErrorMessage(
                error?.message || "An unexpected error occurred."
            );
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-white dark:bg-gray-950">
            {/* Background */}
            <div className="absolute inset-0 -z-10">
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#4f4f4f2e_1px,transparent_1px),linear-gradient(to_bottom,#4f4f4f2e_1px,transparent_1px)] bg-[size:14px_24px] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)]" />
            </div>

            <div className="w-full max-w-md px-4">
                <Card className="border-0 shadow-2xl bg-white/90 dark:bg-gray-900/50 backdrop-blur-sm rounded-xl">
                    <CardHeader className="space-y-1 pb-4">
                        <CardTitle className="text-2xl font-semibold tracking-tight">
                            Welcome back
                        </CardTitle>

                        <CardDescription>
                            Enter your credentials to continue
                        </CardDescription>
                    </CardHeader>

                    <CardContent className="space-y-5">
                        <div className="space-y-2">
                            <Label htmlFor="username">
                                Email
                            </Label>

                            <Input
                                id="username"
                                type="email"
                                placeholder="you@example.com"
                                value={email}
                                onChange={(e) =>
                                    setEmail(e.target.value)
                                }
                                className=" h-11 px-4 rounded-xl border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                            />
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="password">
                                    Password
                                </Label>

                                <Link
                                    href="/forgot-password"
                                    className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400"
                                >
                                    Forgot password?
                                </Link>
                            </div>

                            <Input
                                id="password"
                                type="password"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="h-11 px-4 rounded-xl border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200  "
                            />
                        </div>

                        {errorMessage && (
                            <p className="text-sm text-red-500">
                                {errorMessage}
                            </p>
                        )}

                        <Button
                            className="w-full h-11 rounded-xl"
                            onClick={handleLogin}
                            disabled={isLoading}
                        >
                            {isLoading
                                ? "Signing In..."
                                : "Sign In"}
                        </Button>

                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-gray-200 dark:border-gray-800" />
                            </div>

                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-white dark:bg-gray-900 px-2 text-gray-500">
                                    New here?
                                </span>
                            </div>
                        </div>

                        <Button
                            variant="outline"
                            className="w-full h-11 rounded-xl"
                            asChild
                        >
                            <Link href="/register">
                                Create an account
                            </Link>
                        </Button>
                    </CardContent>
                </Card>

                <p className="text-center text-xs text-gray-500 mt-6">
                    By signing in, you agree to our{" "}
                    <Link
                        href="/terms"
                        className="underline underline-offset-4"
                    >
                        Terms
                    </Link>{" "}
                    and{" "}
                    <Link
                        href="/privacy"
                        className="underline underline-offset-4"
                    >
                        Privacy Policy
                    </Link>
                </p>
            </div>
        </div>
    );
}