"use client";

import {
  ClipboardList,
  CreditCard,
  History,
  LayoutDashboard,
  type LucideIcon,
  MessagesSquare,
  Users,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = {
  label: string;
  href: string;
  icon: LucideIcon;
  adminOnly?: boolean;
};

export function SidebarNav({
  slug,
  admin,
  orientation = "vertical",
}: {
  slug: string;
  admin: boolean;
  orientation?: "vertical" | "horizontal";
}) {
  const pathname = usePathname();
  const items: Item[] = [
    { label: "Train", href: `/w/${slug}/train`, icon: MessagesSquare },
    { label: "Sessions", href: `/w/${slug}/sessions`, icon: History },
    {
      label: "Dashboard",
      href: `/w/${slug}/dashboard`,
      icon: LayoutDashboard,
      adminOnly: true,
    },
    {
      label: "Guests",
      href: `/w/${slug}/personas`,
      icon: Users,
      adminOnly: true,
    },
    {
      label: "Situations",
      href: `/w/${slug}/scenarios`,
      icon: ClipboardList,
      adminOnly: true,
    },
    { label: "Team", href: `/w/${slug}`, icon: UsersRound, adminOnly: true },
    {
      label: "Billing",
      href: `/w/${slug}/billing`,
      icon: CreditCard,
      adminOnly: true,
    },
  ].filter((i) => admin || !i.adminOnly);

  const isActive = (href: string) =>
    // "Team" lives at the workspace root — match it exactly so it isn't always
    // active; everything else matches its own path or a sub-path.
    href === `/w/${slug}`
      ? pathname === `/w/${slug}`
      : pathname === href || pathname.startsWith(`${href}/`);

  if (orientation === "horizontal") {
    return (
      <nav className="flex gap-1 overflow-x-auto">
        {items.map(({ label, href, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-accent-50 font-medium text-accent-700"
                  : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              <Icon size={16} strokeWidth={2} aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className="flex flex-col gap-0.5">
      {items.map(({ label, href, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-accent-50 font-medium text-accent-700"
                : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
            }`}
          >
            <Icon size={18} strokeWidth={2} aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
