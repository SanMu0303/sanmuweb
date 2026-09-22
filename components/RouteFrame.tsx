"use client";

import {usePathname} from "next/navigation";
import Shell from "@/components/Shell";
import LiveLightHomeShell from "@/components/LiveLightHomeShell";

export default function RouteFrame({children}:{children:React.ReactNode}) {
  const pathname = usePathname() || "/";
  if (pathname === "/terminal" || pathname.startsWith("/terminal/")) return <>{children}</>;
  if (pathname === "/") return <LiveLightHomeShell>{children}</LiveLightHomeShell>;
  // The light homepage is an isolated, local-only design preview. It must not
  // inherit the production shell or its navigation state.
  if (pathname === "/preview/home-light" || pathname.startsWith("/preview/home-light/")) return <>{children}</>;
  return <Shell>{children}</Shell>;
}
