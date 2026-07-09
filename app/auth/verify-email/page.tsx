import { Mail } from "lucide-react";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { ResendEmail } from "@/components/resend-email";

// Full-page "check your email" screen. Sign-up and magic-link both land here
// so the user gets a clear, deliberate confirmation instead of a small inline
// message that's easy to miss on the form they just submitted.
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; via?: string }>;
}) {
  const { email, via } = await searchParams;
  const address = email?.trim();
  const isMagic = via === "magic";

  return (
    <AuthShell>
      <div className="flex flex-col items-center text-center">
        <span
          className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-accent-50 text-accent-700"
          aria-hidden="true"
        >
          <Mail size={22} />
        </span>
        <h1 className="text-2xl font-semibold text-neutral-900">
          Check your email
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-500">
          {isMagic ? "We sent a sign-in link" : "We sent a confirmation link"}{" "}
          to{" "}
          {address ? (
            <span className="font-medium text-neutral-800">{address}</span>
          ) : (
            "your inbox"
          )}
          . Click the link in that email to{" "}
          {isMagic ? "sign in" : "finish setting up your account"}.
        </p>
        <p className="mt-4 text-xs text-neutral-400">
          It can take a minute to arrive. If you don&rsquo;t see it, check your
          spam folder.
        </p>

        {address ? (
          <div className="mt-6">
            <ResendEmail email={address} />
          </div>
        ) : null}

        <div className="mt-8 border-t border-neutral-100 pt-6">
          <Link
            href="/auth/signin"
            className="text-sm font-medium text-accent-700 hover:text-accent-800"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
