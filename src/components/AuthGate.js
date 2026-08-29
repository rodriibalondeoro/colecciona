"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Navbar from "./Navbar";
import BottomNav from "./BottomNav";

export default function AuthGate({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState("checking"); // checking | allowed | denied

  // MODO PRUEBAS: con `true`, cada vez que se cargue la app ignora la sesión guardada
  // y arranca como usuario NUEVO, así llevará al login para probar el onboarding.
  // Tras iniciar sesión funciona normal (entra al menú). Pónlo en `false`
  // para el flujo real (con sesión guardada → menú principal).
  const TEST_START_AS_NEW_USER = false;
  const ignoreStoredRef = useRef(TEST_START_AS_NEW_USER);

  useEffect(() => {
    if (ignoreStoredRef.current) {
      // MODO PRUEBAS: cada carga arranca como usuario nuevo, sin sesión previa
      try {
        localStorage.removeItem("colecciona_session");
      } catch {}
      ignoreStoredRef.current = false;
    }

    let session = null;
    try {
      const raw = localStorage.getItem("colecciona_session");
      if (raw) session = JSON.parse(raw);
    } catch {}

    const isAuthPage = pathname === "/auth";
    const isPublic = isAuthPage || pathname === "/terminos" || pathname === "/privacidad";

    if (session && session.email && session.verified) {
      setStatus("allowed");
      if (isAuthPage) {
        router.replace("/");
      }
    } else {
      setStatus("denied");
      if (!isPublic) {
        router.replace("/auth");
      }
    }
  }, [pathname, router]);

  // Evitar parpadeo mientras se comprueba la sesión
  if (status === "checking") {
    return (
      <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "var(--text-muted, #9aa0b4)", fontSize: "0.9rem" }}>Cargando…</div>
      </div>
    );
  }

  const isAuthPage = pathname === "/auth";
  const isPublic = isAuthPage || pathname === "/terminos" || pathname === "/privacidad";
  if (status === "denied" && !isPublic) {
    return null;
  }

  // Páginas públicas (auth, términos, privacidad): solo el contenido, sin navbar
  if (isPublic) {
    return <>{children}</>;
  }

  return (
    <>
      <Navbar />
      {children}
      <BottomNav />
    </>
  );
}
