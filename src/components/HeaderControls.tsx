import { useApp } from "@/lib/app-context";

export function HeaderControls() {
  const { theme, toggleTheme, lang, setLang, t } = useApp();
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={toggleTheme}
        aria-label={t("theme")}
        title={t("theme")}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-sm hover:bg-accent"
      >
        {theme === "dark" ? "☀" : "☾"}
      </button>
      <div className="inline-flex overflow-hidden rounded-md border border-input bg-background text-xs">
        <button
          onClick={() => setLang("en")}
          className={`px-2.5 py-1.5 ${lang === "en" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
        >
          EN
        </button>
        <button
          onClick={() => setLang("ar")}
          className={`px-2.5 py-1.5 ${lang === "ar" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
        >
          ع
        </button>
      </div>
    </div>
  );
}
