export type SiteTheme = "soft" | "dark";

const STORAGE_KEY = "sanmu-site-theme";

/**
 * The site intentionally exposes only two visual systems.  The old
 * `classic` query value is treated as dark so bookmarked preview URLs do not
 * accidentally create a third theme.
 */
export function readSiteTheme(): SiteTheme {
  if (typeof window === "undefined") return "soft";
  const queryTheme = new URLSearchParams(window.location.search).get("theme");
  if (queryTheme === "dark" || queryTheme === "classic") return "dark";
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

