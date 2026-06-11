import Link from "next/link";
import { redirect } from "next/navigation";
import { afterAuthDestination, getUser } from "@/lib/auth/session";

export default async function Home() {
  const user = await getUser();
  if (user) redirect(await afterAuthDestination(user.id));

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">Lobbyee</h1>
      <p className="max-w-md text-neutral-600">
        Train your hospitality team on the conversations that matter — with a
        realistic AI guest and coaching after every session.
      </p>
      <div className="flex gap-3">
        <Link
          href="/auth/signup"
          className="rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700"
        >
          Start free
        </Link>
        <Link
          href="/auth/signin"
          className="rounded-xl bg-neutral-100 px-5 py-2.5 text-sm font-semibold text-neutral-900 hover:bg-neutral-200"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
