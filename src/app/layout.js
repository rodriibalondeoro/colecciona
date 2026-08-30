import { Inter, Outfit } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import BottomNav from "@/components/BottomNav";
import AuthGate from "@/components/AuthGate";
import SmoothScroll from "@/components/SmoothScroll";
import Preloader from "@/components/Preloader";
import Cursor from "@/components/Cursor";
import ScrollProgress from "@/components/ScrollProgress";
import HoverFooter from "@/components/HoverFooter";
import { AppProvider } from "@/context/AppContext";
import { PremiumProvider } from "@/hooks/usePremium";
import ToastContainer from "@/components/ToastContainer";

const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

const outfit = Outfit({
  variable: "--font-heading",
  subsets: ["latin"],
  display: "swap",
});

export const metadata = {
  title: "Colecciona — Mercado de Cartas Coleccionables",
  description:
    "Compra y vende cartas coleccionables (Pokémon, Magic, Yu-Gi-Oh!) con las comisiones más bajas del mercado. Envíos seguros y protección al comprador.",
  keywords: [
    "cartas coleccionables",
    "pokémon",
    "magic the gathering",
    "yu-gi-oh",
    "marketplace",
    "trading cards",
    "comprar cartas",
    "vender cartas",
  ],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Colecciona",
  },
  openGraph: {
    title: "Colecciona — Mercado de Cartas Coleccionables",
    description:
      "Las comisiones más bajas del mercado para coleccionistas. Compra y vende cartas Pokémon, Magic, Yu-Gi-Oh! y más.",
    type: "website",
    locale: "es_ES",
    siteName: "Colecciona",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0a0a0f",
};

function RegisterSW() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;

  if (process.env.NODE_ENV === "production") {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  } else {
    // Dev: el SW cachearía versiones antiguas y enmascararía los cambios.
    // Des-registramos cualquier SW previo y limpiamos TODAS las cachés.
    window.addEventListener("load", () => {
      if ("caches" in window) {
        caches
          .keys()
          .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
          .catch(() => {});
      }
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => r.unregister()))
        .then(() => {
          if ("caches" in window) {
            caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).catch(() => {});
          }
        })
        .catch(() => {});
    });
  }
  return null;
}

export default function RootLayout({ children }) {
  return (
    <html lang="es" className={`${inter.variable} ${outfit.variable}`}>
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#090a0c" />
      </head>
      <body>
          <AppProvider>
            <PremiumProvider>
              <RegisterSW />
              <Preloader />
              <SmoothScroll />
              <Cursor />
              <ScrollProgress />
              <div className="grain" aria-hidden="true" />
              <AuthGate>
                <main className="main-content">{children}</main>
              </AuthGate>
              <HoverFooter />
              <ToastContainer />
            </PremiumProvider>
          </AppProvider>
        </body>
    </html>
  );
}
