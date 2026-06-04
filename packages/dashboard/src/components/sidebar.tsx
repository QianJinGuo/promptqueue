"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  ListTodo,
  KanbanSquare,
  Menu,
  X,
  Cpu,
  Bot,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
  { href: "/queues", label: "Queues", icon: KanbanSquare },
  { href: "/providers", label: "Providers", icon: Cpu },
];

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-sidebar-border bg-sidebar transition-all duration-200 w-56",
        collapsed && "w-0 overflow-hidden border-0 md:w-14"
      )}
    >
      {mounted && (
        <>
          <div
            className={cn(
              "flex h-14 items-center gap-2 border-b border-sidebar-border px-4",
              collapsed && "justify-center px-2"
            )}
          >
            <Bot className="h-5 w-5 shrink-0 text-sidebar-primary" />
            {!collapsed && (
              <span className="truncate font-semibold text-sidebar-foreground">
                PromptQueue
              </span>
            )}
          </div>
          <nav className="flex-1 space-y-1 p-2">
            {navItems.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    collapsed && "justify-center px-0",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!collapsed && item.label}
                </Link>
              );
            })}
          </nav>
          {!collapsed && (
            <div className="border-t border-sidebar-border p-3">
              <p className="text-xs text-sidebar-foreground/50">
                PromptQueue v0.1.0
              </p>
            </div>
          )}
        </>
      )}
    </aside>
  );
}

export function MobileSidebar() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed top-3 left-3 z-40 rounded-md p-2 text-sidebar-foreground hover:bg-sidebar-accent md:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 flex w-56 md:hidden">
            <button
              onClick={() => setOpen(false)}
              className="absolute top-3 right-3 z-50 rounded-md p-1 text-sidebar-foreground hover:bg-sidebar-accent"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
            <Sidebar collapsed={false} />
          </div>
        </>
      )}
    </>
  );
}
