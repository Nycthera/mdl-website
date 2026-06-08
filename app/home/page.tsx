"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";

export default function Home() {
    const searchParams = useSearchParams();
    const router = useRouter();

    useEffect(() => {
        if (searchParams.get("login") === "success") {
            toast.success("Logged in successfully!");

            // optional: clean URL so toast doesn't repeat on refresh
            router.replace("/home");
        }
    }, [searchParams, router]);

    return (
        <div className="min-h-screen flex items-center justify-center">
            <h1 className="text-4xl font-bold">
                Welcome to the MDL Website!
            </h1>
        </div>
    );
}