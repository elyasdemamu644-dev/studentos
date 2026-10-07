"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

/**
 * Consistent breadcrumb for nested academic pages.
 *
 * Renders as a semantic `<nav aria-label="Breadcrumb">` with an `<ol>` list.
 * The last item is the current page (no link, `aria-current="page"`).
 * All other items are navigable links.
 *
 * Responsive: on mobile, only the last 3 items are shown (current page and
 * its two parents). On desktop, all items are visible. This keeps the
 * hierarchy accessible without overflowing small screens.
 */
export function Breadcrumb({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  // A single item carries no hierarchy — render nothing rather than a lone label.
  if (items.length < 2) return null;

  return (
    <nav aria-label="Breadcrumb" className={cn("mb-4", className)}>
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          // On mobile, show only the last 3 items
          const isHiddenOnMobile = index < items.length - 3;

          return (
            <li
              key={index}
              className={cn("flex items-center gap-1", isHiddenOnMobile && "hidden sm:flex")}
            >
              {index > 0 && (
                <ChevronRight
                  className={cn("h-3.5 w-3.5 text-muted-foreground", isHiddenOnMobile && "hidden sm:block")}
                  aria-hidden
                />
              )}
              {isLast || !item.href ? (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={cn(
                    "truncate",
                    isLast ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="truncate text-muted-foreground transition-colors hover:text-foreground"
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
