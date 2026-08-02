"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Activity,
  Archive,
  Download,
  Home,
  Library,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sun,
  BookOpen,
} from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useDensity } from "@/components/providers/density-provider";
import { cn } from "@/lib/utils";

export interface CommandPaletteMangaItem {
  id: number | string;
  name: string;
  subtitle?: string;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manga?: CommandPaletteMangaItem[];
  onSelectManga?: (item: CommandPaletteMangaItem) => void;
  onAddDownload?: () => void;
  onCheckAllUpdates?: () => void;
}

interface Entry {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  group: string;
  action: () => void;
}

/**
 * Cmd+K / Ctrl+K quick-action palette, mounted once per dashboard page.
 * Fuzzy-filters navigation, manga jumps, and quick actions from a single
 * text box so common tasks don't require hunting through the page.
 */
export function CommandPalette({
  open,
  onOpenChange,
  manga = [],
  onSelectManga,
  onAddDownload,
  onCheckAllUpdates,
}: CommandPaletteProps) {
  const router = useRouter();
  const { setTheme, theme } = useTheme();
  const { density, setDensity } = useDensity();
  const [query, setQuery] = React.useState("");
  const [highlight, setHighlight] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (next) {
        setQuery("");
        setHighlight(0);
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  // Global shortcut — works regardless of which dashboard page mounted this.
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        handleOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, handleOpenChange]);

  // Focus the input once the dialog has mounted — a DOM side effect, not
  // state derived from other state, so it stays in an effect.
  React.useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const entries = React.useMemo<Entry[]>(() => {
    const nav: Entry[] = [
      {
        id: "nav-dashboard",
        label: "Go to Dashboard",
        icon: Home,
        group: "Navigate",
        action: () => router.push("/dashboard"),
      },
      {
        id: "nav-health",
        label: "Go to Health overview",
        icon: Activity,
        group: "Navigate",
        action: () => router.push("/dashboard/health"),
      },
      {
        id: "nav-behind",
        label: "Go to Behind titles",
        icon: Archive,
        group: "Navigate",
        action: () => router.push("/dashboard/behind"),
      },
      {
        id: "nav-sources",
        label: "Go to Source guide",
        icon: Library,
        group: "Navigate",
        action: () => router.push("/dashboard/sources"),
      },
      {
        id: "nav-preferences",
        label: "Go to Preferences",
        icon: Settings,
        group: "Navigate",
        action: () => router.push("/dashboard/preferences"),
      },
      {
        id: "nav-docs",
        label: "Go to Docs",
        icon: BookOpen,
        group: "Navigate",
        action: () => router.push("/docs"),
      },
    ];

    const actions: Entry[] = [];
    if (onAddDownload) {
      actions.push({
        id: "action-add",
        label: "Add manga to queue",
        icon: Plus,
        group: "Actions",
        action: onAddDownload,
      });
    }
    if (onCheckAllUpdates) {
      actions.push({
        id: "action-check-all",
        label: "Check all for updates",
        icon: RefreshCw,
        group: "Actions",
        action: onCheckAllUpdates,
      });
    }
    actions.push({
      id: "action-theme",
      label:
        theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
      icon: theme === "dark" ? Sun : Moon,
      group: "Actions",
      action: () => setTheme(theme === "dark" ? "light" : "dark"),
    });
    actions.push({
      id: "action-density",
      label:
        density === "compact"
          ? "Switch to comfortable density"
          : "Switch to compact density",
      icon: Settings,
      group: "Actions",
      action: () =>
        setDensity(density === "compact" ? "comfortable" : "compact"),
    });

    const mangaEntries: Entry[] = manga.map((m) => ({
      id: `manga-${m.id}`,
      label: m.name,
      hint: m.subtitle,
      icon: Download,
      group: "Library",
      action: () => onSelectManga?.(m),
    }));

    return [...nav, ...actions, ...mangaEntries];
  }, [
    manga,
    onAddDownload,
    onCheckAllUpdates,
    onSelectManga,
    router,
    setDensity,
    setTheme,
    theme,
    density,
  ]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.label.toLowerCase().includes(q));
  }, [entries, query]);

  // Group filtered entries while preserving group order of first appearance.
  const groups = React.useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, Entry[]>();
    for (const e of filtered) {
      if (!map.has(e.group)) {
        map.set(e.group, []);
        order.push(e.group);
      }
      map.get(e.group)!.push(e);
    }
    return order.map((g) => ({ group: g, items: map.get(g)! }));
  }, [filtered]);

  function runHighlighted() {
    const item = filtered[highlight];
    if (item) {
      item.action();
      handleOpenChange(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runHighlighted();
    }
  }

  let flatIndex = -1;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[20%] max-w-xl translate-y-0 gap-0 p-0"
      >
        <DialogTitle className="sr-only">Quick actions</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search manga, pages, or actions..."
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
            Esc
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {groups.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No matches.
            </p>
          ) : (
            groups.map(({ group, items }) => (
              <div key={group} className="mb-2 last:mb-0">
                <p className="px-2 py-1 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
                  {group}
                </p>
                {items.map((item) => {
                  flatIndex += 1;
                  const isActive = flatIndex === highlight;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onMouseEnter={() => setHighlight(flatIndex)}
                      onClick={() => {
                        item.action();
                        handleOpenChange(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm normal-case",
                        isActive
                          ? "bg-muted text-foreground"
                          : "text-foreground/80",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{item.label}</span>
                      {item.hint && (
                        <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">
                          {item.hint}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
