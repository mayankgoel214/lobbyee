// Shared UI primitives. "Atrium" system: white surfaces, cool-grey neutrals,
// teal accent (accent-*) as the single confident color for CTAs, focus rings,
// and active states. Semantic tokens (empathy/clarity/problem/prof, good/warn
// /bad) are used inline elsewhere where meaning matters.
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
      "border border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50",
    ghost: "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900",
  }[variant];
  return <button className={`${base} ${styles} ${className}`} {...props} />;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className="w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none transition-colors focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
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
      className={`rounded-xl border border-neutral-200 bg-white p-6 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

// Extended variants add semantic (competency + status) tags so a Badge can
// carry meaning at a glance — used across feedback, dashboard, and session
// status pills. Legacy variants (accent/success/warning/danger) are kept so
// existing call sites remain untouched.
export function Badge({
  children,
  variant = "neutral",
  className = "",
}: {
  children: ReactNode;
  variant?:
    | "neutral"
    | "accent"
    | "success"
    | "warning"
    | "danger"
    | "empathy"
    | "clarity"
    | "problem"
    | "prof"
    | "good"
    | "warn"
    | "bad";
  className?: string;
}) {
  const styles: Record<string, string> = {
    neutral: "bg-neutral-100 text-neutral-700",
    accent: "bg-accent-50 text-accent-700",
    success: "bg-good/10 text-good",
    warning: "bg-warn/15 text-[#a76a12]",
    danger: "bg-bad/10 text-bad",
    empathy: "bg-empathy/10 text-empathy",
    clarity: "bg-clarity/10 text-clarity",
    problem: "bg-problem/15 text-[#a76a12]",
    prof: "bg-prof/10 text-prof",
    good: "bg-good/10 text-good",
    warn: "bg-warn/15 text-[#a76a12]",
    bad: "bg-bad/10 text-bad",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="text-sm text-bad">{children}</p>;
}

export function FormMessage({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="text-sm text-neutral-600">{children}</p>;
}
