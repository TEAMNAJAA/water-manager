import { useState } from "react";
import { useParams } from "react-router-dom";
import { photoUrl } from "../api";
import { NightChart } from "../components/Charts";
import { Layout, Loading } from "../components/Layout";
import { day, litres, money, people, useApi } from "../hooks";
import { useT } from "../i18n";
import { KINDS } from "./Report";
import { JobStatus, ProofBox, type Proof } from "./Repairs";

type Rep = {
  village: { name: string; simulated: boolean; lat: number | null; lon: number | null };
  settings: { currency: string; agencies: { name: string; email?: string; phone?: string }[] };
  zone: string | null;
  job: { id: number; kind: string; status: string; note: string | null; created: string; litres_per_day: number | null; people_per_day: number | null;
    photo: string | null; technician: string | null; lat: number | null; lon: number | null; proof: Proof };
  alert: { kind: string; started: string; data: { started?: string; nights?: number; litres_per_hour?: number } } | null;
  nights: { night_of: string; flow: number; baseline: number | null; high: boolean }[];
  step_test: { suspect: { label: string } | null; litres_per_day: number | null; steps: { label: string; state: string; drop_m3h?: number; drop_pct?: number }[] } | null;
  costs: { amount: number; status: string; note: string | null }[];
  generated: string;
};

export default function EvidenceReport() {
  const { id } = useParams();
  const { t, lang } = useT();
  const { data: r, error } = useApi<Rep>(`/api/repairs/${id}/report`, [id]);
  const [copied, setCopied] = useState(false);
  if (!r) return <Layout title={t("Evidence report")}><Loading error={error} /></Layout>;
  const j = r.job;
  const url = location.href;
  const summary = [
    `${r.village.name}${r.zone ? `, ${r.zone}` : ""}: ${t(KINDS[j.kind]?.label ?? j.kind)} (#${j.id})`,
    j.litres_per_day ? `${t("lost per day")}: ${litres(j.litres_per_day)} (${t("water for {p} people", { p: people(j.people_per_day) })})` : "",
    r.alert?.data.started ? `${t("Since")}: ${day(r.alert.data.started, lang)}` : "",
    r.step_test?.suspect ? `${t("Step test points to")}: ${r.step_test.suspect.label}` : "",
    url,
  ].filter(Boolean).join("\n");
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: `NamJai #${j.id}`, text: summary, url });
        return;
      } catch {
        return;
      }
    }
    await navigator.clipboard?.writeText(summary);
    setCopied(true);
  };
  const cost = r.costs.reduce((s, c) => s + c.amount, 0);
  return (
    <Layout title={t("Evidence report")} wide>
      <div className="report">
        <header className="row between" style={{ marginTop: 16 }}>
          <div>
            <h1 style={{ marginBottom: 2 }}>💧 NamJai · {t("Repair evidence")} #{j.id}</h1>
            <span className="muted">{r.village.name}{r.zone ? ` · ${r.zone}` : ""} · {day(r.generated, lang)}</span>
          </div>
          <JobStatus s={j.status} />
        </header>
        {r.village.simulated && <p><span className="sim-tag">{t("Simulated data")}</span></p>}
        <div className="grid3" style={{ marginTop: 12 }}>
          <div className="card flat" style={{ margin: 0 }}><div className="small muted">{t("lost per day")}</div><b style={{ fontSize: "1.4rem" }}>{litres(j.litres_per_day)}</b></div>
          <div className="card flat" style={{ margin: 0 }}><div className="small muted">{t("Enough for")}</div><b style={{ fontSize: "1.4rem" }}>{t("{p} people a day", { p: people(j.people_per_day) })}</b></div>
          <div className="card flat" style={{ margin: 0 }}><div className="small muted">{t("Since")}</div><b style={{ fontSize: "1.4rem" }}>{day(r.alert?.data.started ?? j.created, lang)}</b></div>
        </div>
        <p className="small muted">{t("People = litres per day ÷ 50, the WHO amount for intermediate access.")}</p>
        <div className="card">
          <h2>{t(KINDS[j.kind]?.label ?? j.kind)}</h2>
          {j.note && <p>{j.note}</p>}
          {r.zone && <div className="kv"><span className="muted">{t("Where")}</span><b>{r.zone}</b></div>}
          {r.step_test?.suspect && <div className="kv"><span className="muted">{t("Step test points to")}</span><b>{r.step_test.suspect.label}</b></div>}
          {j.technician && <div className="kv"><span className="muted">{t("Technician")}</span><b>{j.technician}</b></div>}
          {r.costs.length > 0 && <div className="kv"><span className="muted">{t("Repair cost")}</span><b>{money(cost)}</b></div>}
          {j.lat != null && <div className="kv"><span className="muted">GPS</span><b>{j.lat.toFixed(5)}, {j.lon?.toFixed(5)}</b></div>}
          <ProofBox proof={j.proof} lang={lang} />
        </div>
        {r.nights.length > 0 && (
          <div className="card">
            <h2>{t("Night flow (01:00–05:00)")}</h2>
            <NightChart nights={r.nights} baseline={r.nights.at(-1)?.baseline ?? null} lang={lang} />
          </div>
        )}
        {r.step_test && (
          <div className="card">
            <h2>{t("Step test")}</h2>
            <table>
              <thead><tr><th>{t("Valve closed")}</th><th className="num">{t("Flow drop")}</th></tr></thead>
              <tbody>{r.step_test.steps.map((s, i) => <tr key={i}><td>{s.label}</td><td className="num">{s.drop_m3h != null ? `${Math.round(s.drop_m3h * 1000)} L/h (${s.drop_pct}%)` : "–"}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        {j.photo && <img src={photoUrl(j.photo)} alt="" style={{ borderRadius: 12, maxHeight: 320, objectFit: "contain" }} />}
        <div className="row no-print" style={{ margin: "16px 0" }}>
          <button className="btn primary" onClick={share}>📤 {copied ? t("Copied") : t("Share")}</button>
          <button className="btn" onClick={() => window.print()}>🖨️ {t("Print or save as PDF")}</button>
          {r.settings.agencies.map((a) => (
            a.email ? <a key={a.name} className="btn" href={`mailto:${a.email}?subject=${encodeURIComponent(`NamJai #${j.id} – ${r.village.name}`)}&body=${encodeURIComponent(summary)}`}>✉️ {a.name}</a>
              : a.phone ? <a key={a.name} className="btn" href={`tel:${a.phone}`}>📞 {a.name}</a> : null
          ))}
        </div>
        <p className="small muted">{t("Numbers come from the village meter. Leak location is narrowed to a soi, not an exact point.")}</p>
      </div>
    </Layout>
  );
}
