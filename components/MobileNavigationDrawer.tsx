"use client";

import {useCallback, useEffect, useId, useRef, useState} from "react";
import {Menu, X} from "lucide-react";
import type {SiteTheme} from "@/components/site-theme";
import {SiteNavigationContent, type SiteSession} from "@/components/SiteNavigation";

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export default function MobileNavigationDrawer({
  path,
  theme,
  session,
  triggerClassName = "",
}: {
  path: string;
  theme: SiteTheme;
  session?: SiteSession | null;
  triggerClassName?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);
  const [open, setOpen] = useState(false);
  const dialogId = useId();

  const finishClose = useCallback(() => {
    setOpen(false);
    if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  const close = useCallback((restoreFocus = true) => {
    restoreFocusRef.current = restoreFocus;
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    else finishClose();
  }, [finishClose]);

  const openDrawer = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    restoreFocusRef.current = true;
    dialog.showModal();
    setOpen(true);
  }, []);

  useEffect(() => {
    if (open) close(false);
  // Route transitions must close the modal before the next page receives focus.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    if (!open) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    const timer = window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const nodes = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)]
        .filter(node => !node.hasAttribute("disabled") && node.tabIndex >= 0);
      if (!nodes.length) {
        event.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(timer);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 761px)");
    const onChange = () => {
      if (media.matches && open) close(false);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [close, open]);

  return <>
    <button
      ref={triggerRef}
      type="button"
      className={`site-mobile-menu-toggle ${triggerClassName}`.trim()}
      aria-label="打开导航"
      aria-expanded={open}
      aria-controls={dialogId}
      onClick={openDrawer}
    >
      <Menu size={20} aria-hidden="true"/>
    </button>
    <dialog
      ref={dialogRef}
      id={dialogId}
      className="site-mobile-drawer"
      data-theme={theme}
      aria-label="研究空间导航"
      onCancel={event => {
        event.preventDefault();
        close();
      }}
      onClose={finishClose}
      onClick={event => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="site-mobile-drawer-content">
        <button ref={closeRef} type="button" className="site-mobile-drawer-close" onClick={() => close()} aria-label="关闭导航">
          <X size={20} aria-hidden="true"/>
        </button>
        <SiteNavigationContent path={path} theme={theme} session={session} onNavigate={() => close(false)}/>
      </div>
    </dialog>
  </>;
}
