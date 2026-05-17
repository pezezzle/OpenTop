"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import styles from "./AppShell.module.css";

interface AppShellProps {
  children: ReactNode;
}

const navItems = [
  { href: "/", label: "Board" },
  { href: "/tickets", label: "Tickets" },
  { href: "/executions", label: "Executions" },
  { href: "/settings", label: "Settings" }
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <p className={styles.eyebrow}>OpenTop</p>
          <h1 className={styles.title}>OpenTop</h1>
          <p className={styles.copy}>Compact control plane for ticket execution, review, and GitHub handoff.</p>
        </div>

        <nav aria-label="Primary" className={styles.nav}>
          {navItems.map((item) => {
            const active = isActive(pathname, item.href);

            return (
              <Link
                className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`.trim()}
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className={styles.sidebarMeta}>
          <span>Workflow first</span>
          <span>Compact by default</span>
        </div>
      </aside>

      <div className={styles.content}>{children}</div>
    </div>
  );
}
