"use client";

import { useState, useEffect, createContext, useContext } from "react";

const PremiumContext = createContext({
  isPremium: false,
  premiumSince: null,
  commissionRate: 0.08,
  loading: true,
  refresh: () => {},
});

export function PremiumProvider({ children }) {
  const [state, setState] = useState({
    isPremium: false,
    premiumSince: null,
    commissionRate: 0.08,
    loading: true,
  });

  const refresh = async () => {
    try {
      const session = JSON.parse(localStorage.getItem("colecciona_session") || "null");
      const token = session?.access_token || session?.accessToken;
      const headers = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      if (session?.email) headers["x-user-email"] = session.email;

      const res = await fetch("/api/premium/status", { headers });
      const data = await res.json();
      setState({
        isPremium: data.isPremium || false,
        premiumSince: data.premiumSince || null,
        commissionRate: data.commissionRate || 0.08,
        loading: false,
      });
    } catch {
      setState((prev) => ({ ...prev, loading: false }));
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <PremiumContext.Provider value={{ ...state, refresh }}>
      {children}
    </PremiumContext.Provider>
  );
}

export function usePremium() {
  return useContext(PremiumContext);
}
