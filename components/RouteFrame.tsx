"use client";

import {usePathname} from "next/navigation";
import Shell from "@/components/Shell";

export default function RouteFrame({children}:{children:React.ReactNode}) {
  const pathname = usePathname() || "/";
  if (pathname === "/terminal" || pathname.startsWith("/terminal/")) return <>{children}</>;
  return <Shell>{children}</Shell>;
}
