export type SiteTheme = "soft" | "dark";

const STORAGE_KEY = "sanmu-site-theme";

export function isSiteTheme(value: unknown): value is SiteTheme {
  return value === "soft" || value === "dark";
}

/** Apply the resolved theme to the document before any shell-specific CSS runs. */
export function applySiteTheme(theme: SiteTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.siteTheme = theme;
  document.documentElement.style.colorScheme = theme === "dark" ? "dark" : "light";
}

/**
 * The site intentionally exposes only two visual systems.  The old
 * `classic` query value is treated as dark so bookmarked preview URLs do not
 * accidentally create a third theme.
 */
export function readSiteTheme(): SiteTheme {
  if (typeof window === "undefined") return "soft";
  const queryTheme = new URLSearchParams(window.location.search).get("theme");
  if (queryTheme === "dark" || queryTheme === "classic") return "dark";
  if (queryTheme === "soft" || queryTheme === "light") return "soft";
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "soft";
  } catch {
    return "soft";
  }
}

export function writeSiteTheme(theme: SiteTheme) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private browsing may deny localStorage; the URL still preserves the
    // choice for the current page.
  }
  const url = new URL(window.location.href);
  if (theme === "soft") url.searchParams.delete("theme");
  else url.searchParams.set("theme", "dark");
  window.history.replaceState({}, "", url);
}

/**
 * Kept as plain script text so the root layout can set the colour system
 * before React hydrates a page. This avoids a bright first frame for people
 * who previously chose the dark theme.
 */
export const siteThemeBootstrapScript = `(() => {
  try {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('theme');
    const stored = window.localStorage.getItem('${STORAGE_KEY}');
    const theme = requested === 'dark' || requested === 'classic'
      ? 'dark'
      : requested === 'soft' || requested === 'light'
        ? 'soft'
        : stored === 'dark'
          ? 'dark'
          : 'soft';
    document.documentElement.dataset.siteTheme = theme;
    document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
  } catch (_) {}
})();`;
