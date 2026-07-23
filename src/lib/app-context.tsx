import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark";
export type Lang = "en" | "ar";

type Ctx = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: TKey) => string;
  dir: "ltr" | "rtl";
};

const AppCtx = createContext<Ctx | null>(null);

const translations = {
  en: {
    brand: "RouteScope",
    tagline: "Inspect KML & KMZ routes and estimate drive time.",
    chooseFile: "Choose KML / KMZ file",
    converter: "Converter",
    loaded: "Loaded",
    dropHere: "Drag & drop a .kml/.kmz file here, or use the button above",
    dropNow: "Drop your .kml/.kmz file to load it",
    reading: "Reading file & calculating distance…",
    loadingMap: "Loading map…",
    speed: "Vehicle speed (km/h)",
    distance: "Total distance",
    eta: "Estimated travel time",
    noRoute: "No LineString/road geometry found in this file — travel time can't be calculated.",
    theme: "Toggle theme",
    language: "Language",
    // convert page
    convTitle: "Geo File Converter",
    convSub: "KML · KMZ · GeoJSON · MapInfo MIF",
    backMap: "← Back to map",
    convertTo: "Convert to",
    converting: "Converting…",
    chooseAny: "Choose file",
    supported: "Supported formats",
    invalidDrop: "Please drop a .kml or .kmz file",
  },
  ar: {
    brand: "راوت‌سكوب",
    tagline: "استعرض مسارات KML و KMZ واحسب زمن القيادة.",
    chooseFile: "اختر ملف KML / KMZ",
    converter: "المحوّل",
    loaded: "تم التحميل",
    dropHere: "اسحب وأفلت ملف .kml/.kmz هنا، أو استخدم الزر أعلاه",
    dropNow: "أفلت ملف .kml/.kmz لتحميله",
    reading: "قراءة الملف وحساب المسافة…",
    loadingMap: "جارٍ تحميل الخريطة…",
    speed: "سرعة المركبة (كم/س)",
    distance: "المسافة الإجمالية",
    eta: "زمن الرحلة التقديري",
    noRoute: "لا يحتوي الملف على مسار خطي — لا يمكن حساب زمن الرحلة.",
    theme: "تبديل السمة",
    language: "اللغة",
    convTitle: "محوّل الملفات الجغرافية",
    convSub: "KML · KMZ · GeoJSON · MapInfo MIF",
    backMap: "→ عودة إلى الخريطة",
    convertTo: "تحويل إلى",
    converting: "جارٍ التحويل…",
    chooseAny: "اختر ملفًا",
    supported: "الصيغ المدعومة",
    invalidDrop: "الرجاء إفلات ملف .kml أو .kmz",
  },
} as const;

export type TKey = keyof (typeof translations)["en"];

export function AppProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const t = (localStorage.getItem("theme") as Theme) || "light";
    const l = (localStorage.getItem("lang") as Lang) || "en";
    setThemeState(t);
    setLangState(l);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("lang", lang);
    root.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    localStorage.setItem("lang", lang);
  }, [lang]);

  const dir = lang === "ar" ? "rtl" : "ltr";
  const t = (k: TKey) => translations[lang][k] ?? translations.en[k];

  return (
    <AppCtx.Provider
      value={{
        theme,
        setTheme: setThemeState,
        toggleTheme: () => setThemeState((v) => (v === "dark" ? "light" : "dark")),
        lang,
        setLang: setLangState,
        t,
        dir,
      }}
    >
      {children}
    </AppCtx.Provider>
  );
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp must be used inside AppProvider");
  return c;
}
