"use client";

import { createContext, useContext, useEffect, useState } from "react";

type PortalMeta = {
  role: "admin" | "member" | "viewer" | null;
  email: string | null;
  configuredKeys: Set<string>;
  isReady: boolean;
};

const Ctx = createContext<PortalMeta | null>(null);

export function PortalMetaProvider({ children }: { children: React.ReactNode }) {
  const [meta, setMeta] = useState<PortalMeta>({
    role: null,
    email: null,
    configuredKeys: new Set(),
    isReady: false,
  });

  useEffect(() => {
    let active = true;
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active || !data) {
          if (active) setMeta((m) => ({ ...m, isReady: true }));
          return;
        }
        setMeta({
          role: data.role ?? null,
          email: data.email ?? null,
          configuredKeys: new Set<string>(data.configuredKeys ?? []),
          isReady: true,
        });
      })
      .catch(() => active && setMeta((m) => ({ ...m, isReady: true })));
    return () => {
      active = false;
    };
  }, []);

  return <Ctx.Provider value={meta}>{children}</Ctx.Provider>;
}

export function usePortalMeta(): PortalMeta {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePortalMeta must be used within a PortalMetaProvider");
  return ctx;
}
