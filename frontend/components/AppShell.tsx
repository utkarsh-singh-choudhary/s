"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthUser, getUser, logout, ROLE_CAN } from "@/lib/auth";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    setUser(getUser());
  }, [pathname]);

  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 bg-ink text-white flex flex-col shrink-0">
        <div className="px-4 py-4 border-b border-white/10">
          <div className="text-sm font-semibold tracking-wide">PM AUTOMATION</div>
          <div className="text-[11px] text-white/50">FY 26-27</div>
        </div>
        <nav className="flex flex-col py-2 text-sm flex-1">
          <Link className="px-4 py-2 hover:bg-white/10" href="/dashboard">Dashboard</Link>
          <Link className="px-4 py-2 hover:bg-white/10" href="/technician">My Work</Link>
          <Link className="px-4 py-2 hover:bg-white/10" href="/machines">Machines</Link>
          <Link className="px-4 py-2 hover:bg-white/10" href="/pm">PM Plans</Link>
          <Link className="px-4 py-2 hover:bg-white/10" href="/breakdowns">Breakdowns</Link>
          <Link className="px-4 py-2 hover:bg-white/10" href="/work-orders">Work Orders</Link>
          <Link className="px-4 py-2 hover:bg-white/10" href="/spare-parts">Spare Parts</Link>
          <Link className="px-4 py-2 hover:bg-white/10" href="/checklists">Checklists</Link>
          {ROLE_CAN.viewAdmin(user?.role) && (
            <Link className="px-4 py-2 hover:bg-white/10" href="/employees">Employees</Link>
          )}
          <Link className="px-4 py-2 hover:bg-white/10" href="/reports">Reports</Link>
          {ROLE_CAN.viewImport(user?.role) && (
            <Link className="px-4 py-2 hover:bg-white/10" href="/import">Import Excel</Link>
          )}
          {ROLE_CAN.viewAudit(user?.role) && (
            <Link className="px-4 py-2 hover:bg-white/10" href="/audit">Audit Log</Link>
          )}
          {ROLE_CAN.viewAdmin(user?.role) && (
            <Link className="px-4 py-2 hover:bg-white/10" href="/admin">Admin Settings</Link>
          )}
        </nav>
        {user && (
          <div className="px-4 py-3 border-t border-white/10 text-xs">
            <Link href="/profile" className="font-medium hover:underline">
              {user.name}
            </Link>
            <div className="text-white/50">{user.role}</div>
            <button
              onClick={() => logout()}
              className="mt-2 text-white/70 hover:text-white underline underline-offset-2"
            >
              Sign out
            </button>
          </div>
        )}
      </aside>
      <main className="flex-1 bg-surface min-h-screen">{children}</main>
    </div>
  );
}
