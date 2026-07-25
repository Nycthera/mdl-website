"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Wires up next-themes so the .dark class (already fully styled in
 * globals.css) actually gets toggled on <html>.
 *
 * `next-themes` was already a dependency but was never mounted anywhere —
 * the only consumer was components/ui/sonner.tsx calling useTheme(), which
 * silently fell back to "system" with no provider in the tree. This is what
 * the preferences page's appearance section controls.
 */
export default function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
