"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Density = "comfortable" | "compact";

const STORAGE_KEY = "mdl-density";

const DensityContext = createContext<{
  density: Density;
  setDensity: (density: Density) => void;
}>({
  density: "comfortable",
  setDensity: () => {},
});

/**
 * Purely a client-side, localStorage-backed preference — same pattern as
 * next-themes for theme. There's no per-account reason to sync "compact vs
 * comfortable" server-side, so it never touches Supabase.
 *
 * Compact mode nudges the root font-size down a notch. Since Tailwind's
 * spacing/typography scale is rem-based, that proportionally tightens
 * padding, gaps, and text size app-wide without having to touch every
 * component individually. See the `html[data-density="compact"]` rule in
 * globals.css.
 */
export default function DensityProvider({ children }: { children: ReactNode }) {
  const [density, setDensityState] = useState<Density>(() => {
    if (typeof window === "undefined") return "comfortable";
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "compact" || stored === "comfortable"
      ? stored
      : "comfortable";
  });

  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  function setDensity(next: Density) {
    setDensityState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  return (
    <DensityContext.Provider value={{ density, setDensity }}>
      {children}
    </DensityContext.Provider>
  );
}

export function useDensity() {
  return useContext(DensityContext);
}
