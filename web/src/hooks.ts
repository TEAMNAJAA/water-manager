import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e: any) {
      setError(e.status === 0 ? "offline" : e.message);
    }
    setLoading(false);
  }, [path]);
  useEffect(() => {
    load();
  }, [load, ...deps]);
  return { data, error, loading, reload: load, setData };
}

let currency = "THB";
export const setCurrency = (c: string | null | undefined) => {
  if (c) currency = c;
};

export const money = (n: number | null | undefined) => {
  if (n == null) return "–";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(n);
  } catch {
    return `${n.toLocaleString()} ${currency}`;
  }
};

export const people = (n: number | null | undefined) => (n == null ? "–" : Math.round(n).toLocaleString());

export const litres = (n: number | null | undefined) => (n == null ? "–" : `${Math.round(n).toLocaleString()} L`);

export function ago(iso: string | null | undefined, lang: string) {
  if (!iso) return "–";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  const fmt = new Intl.RelativeTimeFormat(lang === "th" ? "th" : "en", { numeric: "auto" });
  if (Math.abs(s) < 3600) return fmt.format(-Math.round(s / 60), "minute");
  if (Math.abs(s) < 86400) return fmt.format(-Math.round(s / 3600), "hour");
  return fmt.format(-Math.round(s / 86400), "day");
}

export const day = (iso: string | null | undefined, lang: string) =>
  iso ? new Date(iso).toLocaleDateString(lang === "th" ? "th-TH" : "en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–";
