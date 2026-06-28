// Shared UI primitives. Black/white + one indigo accent (the "accent-*" theme
// tokens in globals.css). Two type weights, accent on interactive states only.
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
} from "react";

export function Button({
  className = "",
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";
  const styles = {
    primary: "bg-accent-600 text-white hover:bg-accent-700",
    secondary:
      "border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50",
    ghost: "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900",
  }[variant];
  return <button className={`${base} ${styles} ${className}`} {...props} />;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className="w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none transition-colors focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
      {...props}
    />
  );
}

export function Label(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: htmlFor is supplied by every call site
    <label
      className="mb-1.5 block text-sm font-medium text-neutral-700"
      {...props}
    />
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-neutral-200 bg-white p-6 ${className}`}
    >
      {children}
    </div>
  );
}

export function Badge({
  children,
  variant = "neutral",
  className = "",
}: {
  children: ReactNode;
  variant?: "neutral" | "accent" | "success" | "warning" | "danger";
  className?: string;
}) {
  const styles = {
    neutral: "bg-neutral-100 text-neutral-700",
    accent: "bg-accent-50 text-accent-700",
    success: "bg-green-50 text-green-700",
    warning: "bg-amber-50 text-amber-700",
    danger: "bg-red-50 text-red-700",
  }[variant];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles} ${className}`}
    >
      {children}
    </span>
  );
}

export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="text-sm text-red-600">{children}</p>;
}

export function FormMessage({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="text-sm text-neutral-600">{children}</p>;
}
