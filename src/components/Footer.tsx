import { Linkedin, Globe } from "lucide-react";

const links = [
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/mohamed-ashraf-497a13170",
    Icon: Linkedin,
  },
];

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-8 border-t bg-background/60">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-5 text-sm text-muted-foreground sm:flex-row">
        <p>
          © {year} RouteScope — built by{" "}
          <span className="font-medium text-foreground">Mohamed Ashraf</span>. All rights reserved.
        </p>
        <nav className="flex items-center gap-2">
          {links.map(({ label, href, Icon }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={label}
              title={label}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-input bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
