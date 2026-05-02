import { cn } from "@/lib/utils";

interface StatsCardProps {
  label: string;
  value: string | number;
  hint?: string;
  className?: string;
}

export function StatsCard({ label, value, hint, className }: StatsCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface px-5 py-4",
        className,
      )}
    >
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold text-text">{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}
