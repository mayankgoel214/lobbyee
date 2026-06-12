// Minimal UI primitives for Phase 0 — deliberately plain (the wireframes are
// grayscale; the real design system arrives with the hi-fi pass in Phase 3).
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
  variant?: "primary" | "secondary";
}) {
  const base =
    "rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const styles =
    variant === "primary"
      ? "bg-neutral-900 text-white hover:bg-neutral-700"
      : "bg-neutral-100 text-neutral-900 hover:bg-neutral-200";
  return <button className={`${base} ${styles} ${className}`} {...props} />;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className="w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-neutral-500"
      {...props}
    />
  );
}

export function Label(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: htmlFor is supplied by every call site
    <label
      className="mb-1.5 block text-xs font-semibold tracking-wide text-neutral-500 uppercase"
      {...props}
    />
  );
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6">
      {children}
    </div>
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
