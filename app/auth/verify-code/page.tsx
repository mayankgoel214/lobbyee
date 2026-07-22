import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { VerifyCodeForm } from "@/components/verify-code-form";

// Code-entry screen. Both passwordless sign-in and signup confirmation land
// here: the user reads the code from their email and types it in the same tab.
// No link, no redirect, no PKCE cookie, so it can't fail across browsers or be
// pre-consumed by an email security scanner.
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
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-neutral-900">
          Enter your code
        </h1>
        <p className="mt-1.5 text-sm text-neutral-500">
          {address ? (
            <>
              We sent a code to{" "}
              <span className="font-medium text-neutral-700">{address}</span>.{" "}
            </>
          ) : (
            "We sent a code to your inbox. "
          )}
          Enter it below to{" "}
          {resolvedFlow === "signup"
            ? "finish setting up your account"
            : "sign in"}
          .
        </p>
      </div>

      {address ? (
        <VerifyCodeForm email={address} flow={resolvedFlow} />
      ) : (
        <p className="text-sm text-neutral-500">
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
        <p className="mt-6 rounded-lg bg-neutral-50 p-3.5 text-sm text-neutral-500">
          Already have an account?{" "}
          <Link
            href="/auth/signin"
            className="font-medium text-accent-700 hover:text-accent-800"
          >
            Sign in instead
          </Link>
          . Signing up again won&rsquo;t send a new code.
        </p>
      ) : null}

      <p className="mt-8 text-center text-sm text-neutral-500">
        <Link
          href="/auth/signin"
          className="font-medium text-accent-700 hover:text-accent-800"
        >
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
