import type { Metadata } from "next";
import { Outfit, Lora, Fira_Code } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from "@vercel/analytics/next";
import SessionProvider from "@/components/providers/session-provider";
import ThemeProvider from "@/components/providers/theme-provider";
import DensityProvider from "@/components/providers/density-provider";

const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"] });

const lora = Lora({ variable: "--font-lora", subsets: ["latin"] });
const firaCode = Fira_Code({
  variable: "--font-fira-code",
  subsets: ["latin"],
});
export const metadata: Metadata = {
  title: "MDL - manga download library",
  description:
    "A simple manga download library for downloading manga from various sources.",
  icons: {
    icon: "/icons/favicon.ico",
    shortcut: "/icons/favicon.ico",
    apple: "/icons/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${outfit.variable} ${lora.variable} ${firaCode.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <DensityProvider>
            <SessionProvider>{children}</SessionProvider>
            <Toaster position="bottom-right" />
          </DensityProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
