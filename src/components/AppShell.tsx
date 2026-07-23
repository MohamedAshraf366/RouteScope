import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Map, Compass, ArrowLeftRight, Menu, X, Github, Linkedin, Globe } from "lucide-react";
import { useApp } from "@/lib/app-context";

const nav = [
  { to: "/", label: "Route viewer", icon: Map, desc: "Inspect KML / KMZ" },
  { to: "/explore", label: "Explore map", icon: Compass, desc: "Search & basemaps" },
  { to: "/convert", label: "Converter", icon: ArrowLeftRight, desc: "KML · KMZ · TAB · GeoJSON" },
] as const;

const socials = [
  //{ label: "Portfolio", href: "https://portfolio-updated-tcsz.vercel.app/", Icon: Globe },
  //{ label: "GitHub", href: "https://github.com/MohamedAshraf366?tab=repositories", Icon: Github },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/mohamed-ashraf-497a13170", Icon: Linkedin },
];

export function AppShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { dir, theme, toggleTheme, lang, setLang } = useApp();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground" dir={dir}>
      <div className="lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:min-h-screen">
        {/* Sidebar */}
        <aside
          className={`fixed inset-y-0 z-40 flex w-64 flex-col bg-sidebar text-sidebar-foreground shadow-elevated transition-transform lg:static lg:w-auto lg:translate-x-0 ${
            mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          } ${dir === "rtl" ? "right-0" : "left-0"}`}
        >
          <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-5">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-brand text-brand-foreground font-display text-lg font-bold shadow-glow">
              R
            </div>
            <div className="min-w-0">
              <p className="truncate font-display text-base font-semibold">RouteScope</p>
              <p className="truncate text-[11px] uppercase tracking-widest text-sidebar-foreground/60">
                Geospatial toolkit
              </p>
            </div>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
            {nav.map((item) => {
              const active = pathname === item.to;
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  className={`group flex items-start gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                    active
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-glow"
                      : "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium leading-tight">{item.label}</span>
                    <span
                      className={`block text-[11px] leading-tight ${
                        active ? "text-sidebar-primary-foreground/75" : "text-sidebar-foreground/55"
                      }`}
                    >
                      {item.desc}
                    </span>
                  </span>
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-sidebar-border p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={toggleTheme}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent/30 text-sm hover:bg-sidebar-accent"
                aria-label="Toggle theme"
                title="Toggle theme"
              >
                {theme === "dark" ? "☀" : "☾"}
              </button>
              <div className="inline-flex overflow-hidden rounded-md border border-sidebar-border text-xs">
                <button
                  onClick={() => setLang("en")}
                  className={`px-2.5 py-1.5 ${lang === "en" ? "bg-sidebar-primary text-sidebar-primary-foreground" : "hover:bg-sidebar-accent"}`}
                >
                  EN
                </button>
                <button
                  onClick={() => setLang("ar")}
                  className={`px-2.5 py-1.5 ${lang === "ar" ? "bg-sidebar-primary text-sidebar-primary-foreground" : "hover:bg-sidebar-accent"}`}
                >
                  ع
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between text-[11px] text-sidebar-foreground/60">
              <span>Built by Mohamed Ashraf</span>
              <div className="flex items-center gap-1">
                {socials.map(({ label, href, Icon }) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={label}
                    title={label}
                    className="grid h-7 w-7 place-items-center rounded-full hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                  </a>
                ))}
              </div>
            </div>
          </div>
        </aside>

        {mobileOpen && (
          <button
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 z-30 bg-foreground/40 backdrop-blur-sm lg:hidden"
          />
        )}

        {/* Main */}
        <div className="flex min-w-0 flex-col">
          <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:px-6 sm:py-4">
              <button
                type="button"
                onClick={() => setMobileOpen((v) => !v)}
                className="grid h-9 w-9 place-items-center rounded-md border border-input bg-background lg:hidden"
                aria-label="Toggle navigation"
              >
                {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </button>
              <div className="min-w-0">
                <h1 className="truncate font-display text-lg font-semibold sm:text-xl">{title}</h1>
                {subtitle && (
                  <p className="truncate text-xs text-muted-foreground sm:text-sm">{subtitle}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">{actions}</div>
            </div>
          </header>

          <main className="flex-1 p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
