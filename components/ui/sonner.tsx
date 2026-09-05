"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group richColors"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "hsl(36, 33%, 97%, 0.6)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "hsl(0, 0%, 100%, 0.5)",
          "--border-radius": "1.1rem",
          "--success-bg": "hsl(143, 55%, 94%, 0.85)",
          "--success-text": "hsl(140, 70%, 22%)",
          "--success-border": "hsl(143, 55%, 75%, 0.6)",
          "--error-bg": "hsl(0, 80%, 96%, 0.85)",
          "--error-text": "hsl(0, 70%, 35%)",
          "--error-border": "hsl(0, 80%, 80%, 0.6)",
          "--warning-bg": "hsl(45, 90%, 94%, 0.85)",
          "--warning-text": "hsl(30, 70%, 30%)",
          "--warning-border": "hsl(45, 90%, 75%, 0.6)",
          "--info-bg": "hsl(210, 90%, 95%, 0.85)",
          "--info-text": "hsl(215, 70%, 35%)",
          "--info-border": "hsl(210, 90%, 80%, 0.6)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast cn-toast-glass",
          description: "!text-foreground/90",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
