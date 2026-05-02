import { cn } from "@/lib/utils";

type Tone = "neutral" | "accent" | "success" | "warn" | "danger";

interface BadgeProps {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}

const toneClasses: Record<Tone, string> = {
  neutral: "bg-surface text-muted border border-border",
  accent: "bg-accentMuted text-accent border border-accent/30",
  success: "bg-success/10 text-success border border-success/30",
  warn: "bg-warn/10 text-warn border border-warn/30",
  danger: "bg-danger/10 text-danger border border-danger/30",
};

export function Badge({ children, tone = "neutral", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
