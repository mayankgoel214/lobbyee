import { KeyRound } from "lucide-react";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { VerifyCodeForm } from "@/components/verify-code-form";

// Code-entry screen. Both passwordless sign-in and signup confirmation land
// here: the user reads the 6-digit code from their email and types it in the
// same tab. No link, no redirect, no PKCE cookie — so it can't fail across
// browsers/devices or be pre-consumed by an email security scanner.
export default async function VerifyCodePage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; flow?: string }>;
}) {
  const { email, flow } = await searchParams;
  const address = email?.trim() ?? "";
  const resolvedFlow = flow === "signup" ? "signup" : "magic";

  return (
    <AuthShell>
      <div className="mb-6 flex flex-col items-center text-center">
        <span
          className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-accent-50 text-accent-700"
          aria-hidden="true"
        >
          <KeyRound size={22} />
        </span>
        <h1 className="text-2xl font-semibold text-neutral-900">
          Enter your code
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-500">
          We emailed a code to{" "}
          {address ? (
            <span className="font-medium text-neutral-800">{address}</span>
          ) : (
            "your inbox"
          )}
          . Enter it below to{" "}
          {resolvedFlow === "signup"
            ? "finish setting up your account"
            : "sign in"}
          .
        </p>
      </div>

      {address ? (
        <VerifyCodeForm email={address} flow={resolvedFlow} />
      ) : (
        <p className="text-center text-sm text-neutral-500">
          We couldn&rsquo;t read your email address.{" "}
          <Link
            href="/auth/signin"
            className="font-medium text-accent-700 hover:text-accent-800"
          >
            Start again
          </Link>
          .
        </p>
      )}

      {/* Signing up with an address that already has an account sends nothing
          (Supabase anti-enumeration), so the code never arrives. We can't
          detect that without leaking which emails exist, so always offer the
          way out on the signup flow. */}
      {resolvedFlow === "signup" ? (
        <div className="mt-8 w-full rounded-lg border border-neutral-200 bg-neutral-50 p-4">
          <p className="text-sm text-neutral-600">
            <span className="font-medium text-neutral-800">
              Already have an account?
            </span>{" "}
            No code will arrive — sign in instead.
          </p>
          <Link
            href="/auth/signin"
            className="mt-3 inline-flex text-sm font-medium text-accent-700 hover:text-accent-800"
          >
            Go to sign in
          </Link>
        </div>
      ) : null}

      <div className="mt-8 border-t border-neutral-100 pt-6 text-center">
        <Link
          href="/auth/signin"
          className="text-sm font-medium text-accent-700 hover:text-accent-800"
        >
          Back to sign in
        </Link>
      </div>
    </AuthShell>
  );
}
