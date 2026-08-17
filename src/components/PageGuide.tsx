import { HelpCircle, Info } from "lucide-react";
import type { ReactNode } from "react";

export type GuideStep = { title: string; body: string };

/**
 * Standard "what is this page / how do I use it" block shown at the top of
 * every tool page so the app is self-explanatory.
 */
export function PageGuide({
  what,
  steps,
  notes,
  children,
}: {
  what: string;
  steps: GuideStep[];
  notes?: string[];
  children?: ReactNode;
}) {
  return (
    <section className="mb-6 rounded-2xl border bg-card p-5 shadow-elevated bg-gradient-surface">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-brand text-brand-foreground shadow-glow">
          <Info className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            What this page does
          </p>
          <p className="mt-1 text-sm leading-relaxed text-foreground">{what}</p>
        </div>
      </div>

      <ol className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.title} className="rounded-xl border bg-background/60 p-3">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                {i + 1}
              </span>
              <p className="font-display text-sm font-semibold">{s.title}</p>
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{s.body}</p>
          </li>
        ))}
      </ol>

      {notes && notes.length > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-dashed border-input bg-background/50 p-3">
          <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <ul className="space-y-1 text-[12px] leading-relaxed text-muted-foreground">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      {children}
    </section>
  );
}
