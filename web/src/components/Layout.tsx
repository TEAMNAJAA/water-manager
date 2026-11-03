import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BASE, token } from "../api";
import { useT } from "../i18n";
import { flush, onOutbox } from "../outbox";

export function Layout({ title, back = true, wide = false, children }: { title: string; back?: boolean; wide?: boolean; children: ReactNode }) {
  const { t, lang, setLang } = useT();
  const nav = useNavigate();
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const off = onOutbox(setPending);
    return () => {
      off();
    };
  }, []);
  useEffect(() => {
    const up = () => {
      setOnline(navigator.onLine);
      flush(BASE, token.get);
    };
    window.addEventListener("online", up);
    window.addEventListener("offline", up);
    up();
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", up);
    };
  }, []);
  return (
    <>
      <header className="top">
        {back ? <button onClick={() => nav(-1)} aria-label={t("Back")}>←</button> : <Link to="/" aria-label="NamJai">💧</Link>}
        <div className="title">{title}</div>
        {pending > 0 && <span className="badge" title={t("waiting to send")}>{pending}</span>}
        <button onClick={() => setLang(lang === "en" ? "th" : "en")} aria-label={t("Language")}>{lang === "en" ? "ไทย" : "EN"}</button>
      </header>
      <main className={`app ${wide ? "wide" : ""}`}>
        {!online && <div className="notice warning" style={{ marginTop: 12 }}>{t("Offline – showing saved data")}</div>}
        {pending > 0 && online && <div className="notice small" style={{ marginTop: 12 }}>{pending} {t("waiting to send")}…</div>}
        {children}
      </main>
    </>
  );
}

export function Loading({ error }: { error?: string | null }) {
  const { t } = useT();
  if (error) return <div className="notice critical" style={{ marginTop: 12 }}>{error === "offline" ? t("Offline – showing saved data") : `${t("Something went wrong")}: ${error}`}</div>;
  return <div className="center"><div className="spinner" /><span className="muted">{t("Loading…")}</span></div>;
}

export function Chip({ kind, children }: { kind?: "good" | "warning" | "critical"; children: ReactNode }) {
  return <span className={`chip ${kind ?? ""}`}>{children}</span>;
}
