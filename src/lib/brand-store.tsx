"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Brand, BrandDraft } from "@/lib/types";
import { hexToHslTriplet } from "@/lib/color";

const LS_CURRENT = "iterio-portal:current:v3"; // UI convenience only (not authoritative)

type BrandStore = {
  brands: Brand[];
  currentBrand: Brand | null;
  currentBrandId: string | null;
  isReady: boolean;
  setCurrentBrand: (id: string) => void;
  addBrand: (draft: BrandDraft) => Promise<Brand>;
  updateBrand: (id: string, patch: Partial<Brand>) => void;
  removeBrand: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<BrandStore | null>(null);

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [currentBrandId, setCurrentBrandId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/brands");
    if (!res.ok) {
      setIsReady(true);
      return;
    }
    const { brands: list } = (await res.json()) as { brands: Brand[] };
    setBrands(list);
    setCurrentBrandId((cur) => {
      if (cur && list.some((b) => b.id === cur)) return cur;
      const saved = typeof window !== "undefined" ? localStorage.getItem(LS_CURRENT) : null;
      if (saved && list.some((b) => b.id === saved)) return saved;
      return list[0]?.id ?? null;
    });
    setIsReady(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (currentBrandId) {
      try {
        localStorage.setItem(LS_CURRENT, currentBrandId);
      } catch {
        /* ignore */
      }
    }
  }, [currentBrandId]);

  const currentBrand = useMemo(
    () => brands.find((b) => b.id === currentBrandId) ?? null,
    [brands, currentBrandId]
  );

  // Per-brand tint wash.
  useEffect(() => {
    const tint = currentBrand ? hexToHslTriplet(currentBrand.brandColor) : "140 16% 40%";
    document.documentElement.style.setProperty("--brand-tint", tint);
  }, [currentBrand]);

  const setCurrentBrand = useCallback((id: string) => setCurrentBrandId(id), []);

  const addBrand = useCallback(async (draft: BrandDraft): Promise<Brand> => {
    const res = await fetch("/api/brands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (!res.ok) throw new Error("Failed to create brand");
    const { brand } = (await res.json()) as { brand: Brand };
    setBrands((prev) => [...prev, brand]);
    setCurrentBrandId(brand.id);
    return brand;
  }, []);

  const updateBrand = useCallback((id: string, patch: Partial<Brand>) => {
    // optimistic
    setBrands((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    fetch(`/api/brands/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {
      /* best-effort; a refresh() will reconcile */
    });
  }, []);

  const removeBrand = useCallback(async (id: string) => {
    setBrands((prev) => {
      const next = prev.filter((b) => b.id !== id);
      setCurrentBrandId((cur) => (cur === id ? next[0]?.id ?? null : cur));
      return next;
    });
    await fetch(`/api/brands/${id}`, { method: "DELETE" }).catch(() => {});
  }, []);

  const value: BrandStore = {
    brands,
    currentBrand,
    currentBrandId,
    isReady,
    setCurrentBrand,
    addBrand,
    updateBrand,
    removeBrand,
    refresh,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBrand(): BrandStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useBrand must be used within a BrandProvider");
  return ctx;
}
