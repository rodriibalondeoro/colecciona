"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Navbar from "./Navbar";
import BottomNav from "./BottomNav";
import { supabase } from "@/lib/supabase";

export default function AuthGate({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState("checking"); // checking | allowed | denied

  const TEST_START_AS_NEW_USER = false;
  const ignoreStoredRef = useRef(TEST_START_AS_NEW_USER);

  useEffect(() => {
    let mounted = true;

    const checkAuth = async () => {
      if (ignoreStoredRef.current) {
        try {
          localStorage.removeItem("colecciona_session");
          if (supabase) await supabase.auth.signOut();
        } catch {}
        ignoreStoredRef.current = false;
      }

      let session = null;

      // Supabase configured → ONLY Supabase Auth
      if (supabase) {
        try {
          const { data } = await supabase.auth.getSession();
          session = data?.session;
        } catch {}
      } else {
        // Demo mode ONLY (Supabase not configured)
        try {
          const raw = localStorage.getItem("colecciona_session");
          if (raw) session = JSON.parse(raw);
        } catch {}
      }

      if (!mounted) return;

      const isAuthPage = pathname === "/auth";
      const isPublic = isAuthPage || pathname === "/terminos" || pathname === "/privacidad";

      if (session && (session.user || session.email)) {
        setStatus("allowed");
        if (isAuthPage) router.replace("/");
      } else {
        setStatus("denied");
        if (!isPublic) router.replace("/auth");
      }
    };

    checkAuth();
    return () => { mounted = false; };
  }, [pathname, router]);

  if (status === "checking") {
    return (
      <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "var(--text-muted, #9aa0b4)", fontSize: "0.9rem" }}>Cargando…</div>
      </div>
    );
  }

  const isAuthPage = pathname === "/auth";
  const isPublic = isAuthPage || pathname === "/terminos" || pathname === "/privacidad";
  if (status === "denied" && !isPublic) return null;

  if (isPublic) return <>{children}</>;

  return (
    <>
      <Navbar />
      {children}
      <BottomNav />
    </>
  );
}
