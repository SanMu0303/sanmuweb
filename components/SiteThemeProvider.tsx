"use client";

import {createContext, useCallback, useContext, useLayoutEffect, useMemo, useState} from "react";
import {applySiteTheme, readSiteTheme, type SiteTheme, writeSiteTheme} from "@/components/site-theme";

type SiteThemeContextValue = {
  theme: SiteTheme;
  setTheme: (theme: SiteTheme) => void;
  toggleTheme: () => void;
};

const SiteThemeContext = createContext<SiteThemeContextValue | null>(null);

export function SiteThemeProvider({children}: {children: React.ReactNode}) {
  // Keep the server and the hydration tree identical. The bootstrap script in
  // the root layout paints the correct variables before this layout effect
  // synchronises React state.
  const [theme, setThemeState] = useState<SiteTheme>("soft");

  const setTheme = useCallback((next: SiteTheme) => {
    applySiteTheme(next);
    writeSiteTheme(next);
    setThemeState(next);
  }, []);

  useLayoutEffect(() => {
    const syncFromLocation = () => {
      const next = readSiteTheme();
      applySiteTheme(next);
      setThemeState(next);
    };
    syncFromLocation();
    const onStorage = (event: StorageEvent) => {
      if (event.key === "sanmu-site-theme") syncFromLocation();
    };
    window.addEventListener("popstate", syncFromLocation);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("popstate", syncFromLocation);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const value = useMemo<SiteThemeContextValue>(() => ({
    theme,
    setTheme,
    toggleTheme: () => setTheme(theme === "soft" ? "dark" : "soft"),
  }), [setTheme, theme]);

  return <SiteThemeContext.Provider value={value}>{children}</SiteThemeContext.Provider>;
}

export function useSiteTheme() {
  const value = useContext(SiteThemeContext);
  if (!value) throw new Error("useSiteTheme must be used within SiteThemeProvider");
  return value;
}
