"use client";

import {
  AlertTriangle,
  Building2,
  CreditCard,
  type LucideIcon,
  UserRound,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = {
  label: string;
  href: string;
  icon: LucideIcon;
  emphasis?: "danger";
};

export function SettingsNav({
  slug,
  admin,
  owner,
}: {
  slug: string;
  admin: boolean;
  owner: boolean;
}) {
  const pathname = usePathname();
  const items: Item[] = [
    { label: "Account", href: `/w/${slug}/settings/account`, icon: UserRound },
    ...(admin
      ? [
          {
            label: "Workspace",
            href: `/w/${slug}/settings/workspace`,
            icon: Building2,
          },
          {
            label: "Members",
            href: `/w/${slug}/settings/members`,
            icon: UsersRound,
          },
          {
            label: "Billing & plan",
            href: `/w/${slug}/settings/billing`,
            icon: CreditCard,
          },
        ]
      : []),
    ...(owner
      ? [
          {
            label: "Danger zone",
            href: `/w/${slug}/settings/danger`,
            icon: AlertTriangle,
            emphasis: "danger" as const,
          },
        ]
      : []),
  ];

  return (
    <nav className="flex flex-col gap-0.5">
      {items.map(({ label, href, icon: Icon, emphasis }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const baseColor =
          emphasis === "danger"
            ? active
              ? "bg-bad/10 font-semibold text-bad"
              : "text-bad/80 hover:bg-bad/10 hover:text-bad"
            : active
              ? "bg-accent-50 font-semibold text-accent-800"
              : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900";
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${baseColor}`}
          >
            <Icon size={16} strokeWidth={2} aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
