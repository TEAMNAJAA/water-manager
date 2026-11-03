import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Layout } from "../components/Layout";
import { useApi } from "../hooks";
import { useT } from "../i18n";

export const ROLES = ["resident", "caretaker", "committee", "technician"] as const;

export function DemoLogin({ compact = false }: { compact?: boolean }) {
  const { t } = useT();
  const { login } = useAuth();
  const nav = useNavigate();
  const { data: villages } = useApi<{ id: number; name: string; level: string; simulated: boolean }[]>("/api/villages");
  const demo = (villages ?? []).filter((v) => v.simulated);
  const [vid, setVid] = useState<number | null>(null);
  const village = vid ?? demo.find((v) => v.level === "red")?.id ?? demo[0]?.id;
  const go = async (role: string) => {
    const r = await api("/api/demo/login", { json: { village_id: village, role } });
    await login(r.token);
    nav("/");
  };
  if (!demo.length) return null;
  return (
    <div className="card">
      <h2>{t("Try the demo")} <span className="sim-tag">{t("Simulated data")}</span></h2>
      <label>{t("Village")}</label>
      <select value={village} onChange={(e) => setVid(Number(e.target.value))}>
        {demo.map((v) => <option key={v.id} value={v.id}>{v.name} {v.level === "red" ? "🔴" : v.level === "yellow" ? "🟡" : "🟢"}</option>)}
      </select>
      <div className={compact ? "grid" : "grid"} style={{ marginTop: 12 }}>
        {ROLES.map((r) => <button key={r} className="btn" onClick={() => go(r)}>{t(r[0].toUpperCase() + r.slice(1))}</button>)}
      </div>
    </div>
  );
}

export default function Login() {
  const { t } = useT();
  const { login } = useAuth();
  const nav = useNavigate();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await api("/api/login", { json: { phone: phone.replace(/\D/g, ""), pin } });
      await login(r.token);
      nav("/");
    } catch {
      setErr(t("Wrong phone or PIN"));
    }
  };
  return (
    <Layout title="NamJai" back={false}>
      <div className="center" style={{ margin: "24px 0 8px" }}>
        <div style={{ fontSize: 56 }}>💧</div>
        <h1>NamJai</h1>
        <p className="muted">Community water · น้ำใจ</p>
      </div>
      <form className="card" onSubmit={submit}>
        <h2>{t("Log in")}</h2>
        <label htmlFor="phone">{t("Phone number")}</label>
        <input id="phone" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <label htmlFor="pin">{t("PIN")}</label>
        <input id="pin" inputMode="numeric" type="password" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)} />
        {err && <p className="notice critical" style={{ marginTop: 10 }}>{err}</p>}
        <button className="btn primary block" style={{ marginTop: 14 }}>{t("Log in")}</button>
      </form>
      <DemoLogin />
      <p className="center"><Link to="/demo">Judges' demo page →</Link></p>
    </Layout>
  );
}
