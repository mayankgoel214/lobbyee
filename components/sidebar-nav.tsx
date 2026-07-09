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
  group?: "workspace" | "library";
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
  const items: Item[] = (
    [
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
        group: "library" as const,
      },
      {
        label: "Situations",
        href: `/w/${slug}/scenarios`,
        icon: ClipboardList,
        adminOnly: true,
        group: "library" as const,
      },
      {
        label: "Team",
        href: `/w/${slug}`,
        icon: UsersRound,
        adminOnly: true,
        group: "workspace" as const,
      },
      {
        label: "Billing",
        href: `/w/${slug}/billing`,
        icon: CreditCard,
        adminOnly: true,
        group: "workspace" as const,
      },
    ] satisfies Item[]
  ).filter((i) => admin || !i.adminOnly);

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
                  ? "bg-accent-50 font-semibold text-accent-800"
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

  // Vertical layout — group items with quiet section labels ("Library",
  // "Workspace") to match the Atrium reference. Ungrouped items render first.
  const primary = items.filter((i) => !i.group);
  const library = items.filter((i) => i.group === "library");
  const workspace = items.filter((i) => i.group === "workspace");

  const renderItem = ({ label, href, icon: Icon }: Item) => {
    const active = isActive(href);
    return (
      <Link
        key={href}
        href={href}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
          active
            ? "bg-accent-50 font-semibold text-accent-800"
            : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
        }`}
      >
        <Icon size={17} strokeWidth={2} aria-hidden="true" />
        {label}
      </Link>
    );
  };

  return (
    <nav className="flex flex-col gap-0.5">
      {primary.map(renderItem)}
      {library.length > 0 && (
        <>
          <p className="mt-4 px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">
            Library
          </p>
          {library.map(renderItem)}
        </>
      )}
      {workspace.length > 0 && (
        <>
          <p className="mt-4 px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">
            Workspace
          </p>
          {workspace.map(renderItem)}
        </>
      )}
    </nav>
  );
}
