import { Link, useLocation } from "wouter";
import { LayoutDashboard, Users, Settings, ChevronRight, Sun, Moon } from "lucide-react";
import { useTheme } from "@/lib/theme";
import type { Manager } from "@/pages/Dashboard";

interface SidebarProps {
  managers: Manager[];
  selectedManager: string | null;
  onSelectManager: (id: string | null) => void;
}

// BLG inline SVG logo
function BLGLogo() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      aria-label="BLG"
      className="flex-shrink-0"
    >
      <rect width="32" height="32" rx="8" fill="hsl(93 48% 45%)" />
      <text
        x="16"
        y="22"
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
        fontWeight="800"
        fontSize="14"
        fill="white"
        letterSpacing="-0.5"
      >
        BLG
      </text>
    </svg>
  );
}

const MANAGER_COLORS: Record<string, string> = {
  jarvis: "hsl(93, 48%, 55%)",
  jan: "hsl(160, 55%, 42%)",
  adriana: "hsl(37, 91%, 55%)",
};

export default function Sidebar({ managers, selectedManager, onSelectManager }: SidebarProps) {
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();

  const navItems = [
    { label: "Dashboard", icon: LayoutDashboard, href: "/" },
    { label: "Clients", icon: Users, href: "/clients" },
    { label: "Settings", icon: Settings, href: "/settings" },
  ];

  return (
    <aside className="sidebar flex flex-col bg-card h-full">
      {/* Logo + Brand */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-border">
        <BLGLogo />
        <div>
          <div className="text-sm font-bold text-foreground leading-none">BestLyfe</div>
          <div className="text-xs text-muted-foreground mt-0.5">Agency Dashboard</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="px-3 py-4 space-y-0.5">
        {navItems.map(({ label, icon: Icon, href }) => (
          <Link key={href} href={href}>
            <button
              data-testid={`nav-${label.toLowerCase()}`}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors cursor-pointer ${
                location === href
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </button>
          </Link>
        ))}
      </nav>

      {/* Manager filter */}
      <div className="px-3 py-3 border-t border-border">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-2">
          Filter by Manager
        </p>
        <div className="space-y-0.5">
          <button
            data-testid="manager-filter-all"
            onClick={() => onSelectManager(null)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
              selectedManager === null
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
          >
            <span
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{ background: "hsl(var(--secondary))", color: "hsl(var(--foreground))" }}
            >
              ★
            </span>
            All Managers
            {selectedManager === null && (
              <ChevronRight className="w-3 h-3 ml-auto text-primary" />
            )}
          </button>

          {managers.map((manager) => {
            const color = MANAGER_COLORS[manager.id] ?? manager.color;
            const parts = manager.name.trim().split(/\s+/);
            const initials = parts.length >= 2
              ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
              : manager.name.slice(0, 2).toUpperCase();
            const isSelected = selectedManager === manager.id;
            return (
              <button
                key={manager.id}
                data-testid={`manager-filter-${manager.id}`}
                onClick={() => onSelectManager(isSelected ? null : manager.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isSelected
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <span
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: color + "30", color }}
                >
                  {initials}
                </span>
                {manager.name}
                {isSelected && (
                  <ChevronRight className="w-3 h-3 ml-auto text-primary" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-auto px-4 py-4 border-t border-border flex items-center justify-between">
        <p className="text-xs text-muted-foreground">BestLyfe Group · 2026</p>
        <button
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </aside>
  );
}
