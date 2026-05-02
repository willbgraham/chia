import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const baseField =
  "w-full rounded-md bg-surface text-text border border-border px-3 py-2 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(baseField, className)} {...rest} />;
  },
);

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  rows?: number;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, rows = 4, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cn(baseField, "font-mono leading-relaxed", className)}
        {...rest}
      />
    );
  },
);

interface LabelProps {
  htmlFor?: string;
  children: React.ReactNode;
  hint?: string;
}

export function Label({ htmlFor, children, hint }: LabelProps) {
  return (
    <label htmlFor={htmlFor} className="flex items-center justify-between mb-1.5">
      <span className="text-sm font-medium text-text">{children}</span>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}

export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} hint={hint}>
        {label}
      </Label>
      {children}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
