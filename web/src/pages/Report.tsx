import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Layout } from "../components/Layout";
import { useT } from "../i18n";

export const KINDS: Record<string, { icon: string; label: string }> = {
  no_water: { icon: "🚱", label: "No water" },
  leak: { icon: "💧", label: "Leak / burst pipe" },
  wet_ground: { icon: "🟫", label: "Wet ground" },
  broken_tap: { icon: "🚰", label: "Broken tap" },
  low_pressure: { icon: "📉", label: "Low pressure" },
  other: { icon: "❓", label: "Other" },
  leak_detected: { icon: "📡", label: "Leak found by NamJai" },
};

export default function Report() {
  const { t } = useT();
  const { me } = useAuth();
  const [kind, setKind] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const locate = () => navigator.geolocation?.getCurrentPosition((p) => setPos({ lat: p.coords.latitude, lon: p.coords.longitude }), () => {}, { enableHighAccuracy: true, timeout: 15000 });
  const submit = async () => {
    setBusy(true);
    const job = await api(`/api/villages/${me!.village_id}/repairs`, { json: { kind, note: note || null, ...pos }, queue: "Problem report" });
    if (photo) {
      const f = new FormData();
      f.append("file", photo, "problem.jpg");
      if (job.id) await api(`/api/repairs/${job.id}/photo`, { form: f, queue: "Problem photo" });
    }
    setSent(job.queued ? t("Saved on this phone. It will be sent when you are online.") : t("Report received. Everyone can follow it under Repairs."));
    setBusy(false);
  };
  if (sent) return (
    <Layout title={t("Report a problem")}>
      <div className="card center stack">
        <div style={{ fontSize: 56 }}>📨</div>
        <h2>{sent}</h2>
        <Link className="btn primary block" to="/repairs">🔧 {t("Repairs")}</Link>
        <Link className="btn block" to="/">🏠 NamJai</Link>
      </div>
    </Layout>
  );
  return (
    <Layout title={t("Report a problem")}>
      <h2 style={{ marginTop: 16 }}>{t("What is the problem?")}</h2>
      <div className="grid3">
        {Object.entries(KINDS).filter(([k]) => k !== "leak_detected").map(([k, v]) => (
          <button key={k} className="tile" aria-pressed={kind === k} onClick={() => setKind(k)} style={kind === k ? { borderColor: "var(--brand)", borderWidth: 3 } : undefined}>
            <span className="icon">{v.icon}</span>{t(v.label)}
          </button>
        ))}
      </div>
      {kind === "broken_tap" && <p className="notice" style={{ marginTop: 12 }}>{t("Small job? Try the repair guide first.")} <Link to="/repairs#guides">{t("Repair guides")} →</Link></p>}
      {kind && (
        <div className="card stack">
          <button className="btn block" onClick={() => file.current?.click()}>📷 {photo ? "✓ " : ""}{t("Add a photo (optional)")}</button>
          <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          <button className="btn block" onClick={locate}>📍 {pos ? `✓ ${t("Location added")}` : t("Add my location")}</button>
          <label htmlFor="note">{t("Note (optional)")}</label>
          <textarea id="note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn danger block report-btn" disabled={busy} onClick={submit}>{t("Send report")}</button>
        </div>
      )}
    </Layout>
  );
}
