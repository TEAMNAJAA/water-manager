import { useState } from "react";
import { Link } from "react-router-dom";
import { api, photoUrl } from "../api";
import { useAuth } from "../auth";
import { Layout, Loading } from "../components/Layout";
import type { VillageStatus } from "../components/Status";
import { ago, day, money, useApi } from "../hooks";
import { useT } from "../i18n";
import { BillStatus, type BillT } from "./Bills";

type Pending = { id: number; meter_id: number; taken_at: string; suggested: number | null; confidence: number | null; source: string; photo: string | null; issues: string[] };
type NT = { id: number; zone_id: number | null; night_of: string };
type NTResult = { verdict: string[]; moved: number[]; houses: { meter_id: number; status: string; m3?: number }[]; main_m3: number | null; excess_m3: number | null; pipe_m3: number | null };

const VERDICT: Record<string, string> = {
  leak_inside_houses: "Leak inside these houses", pipe_leak_likely: "Pipe leak likely (not inside the tested houses)", no_leak_seen: "No leak seen",
};

export default function Staff() {
  const { t, lang } = useT();
  const { me } = useAuth();
  const vid = me?.village_id;
  const { data: s } = useApi<VillageStatus>(vid ? `/api/villages/${vid}/status` : null, [vid]);
  const { data: pending, reload: reloadPending } = useApi<Pending[]>(vid ? `/api/readings/pending?village_id=${vid}&limit=20` : null, [vid]);
  const { data: unpaid, reload: reloadBills } = useApi<(BillT & { meter: string })[]>(vid ? `/api/villages/${vid}/bills?status=unpaid` : null, [vid]);
  const { data: tests, reload: reloadTests } = useApi<NT[]>(vid ? `/api/villages/${vid}/night-tests` : null, [vid]);
  const [values, setValues] = useState<Record<number, string>>({});
  const [made, setMade] = useState<number | null>(null);
  const [zone, setZone] = useState<number | "">("");
  const [night, setNight] = useState(new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState<NTResult | null>(null);
  const [msg, setMsg] = useState("");
  const label = (id: number) => s?.meters.find((m) => m.id === id)?.label ?? `#${id}`;
  const main = s?.meters.find((m) => m.kind === "main");
  const silent = s?.alerts.some((a) => a.kind === "clip_silent");

  const confirm = async (r: Pending, force = false) => {
    try {
      await api(`/api/readings/${r.id}/confirm`, { json: { value: Number(values[r.id] ?? r.suggested), force } });
      reloadPending();
    } catch (e: any) {
      setMsg(`#${r.id}: ${(e.detail?.issues ?? [e.message]).join(", ")}`);
    }
  };
  const runBills = async () => {
    const r = await api(`/api/villages/${vid}/bills/run`, { method: "POST" });
    setMade(r.created.length);
    reloadBills();
  };
  const pay = async (id: number) => {
    await api(`/api/bills/${id}/pay`, { method: "POST" });
    reloadBills();
  };
  const startTest = async () => {
    const r = await api(`/api/villages/${vid}/night-tests`, { json: { zone_id: zone || null, night_of: night } });
    reloadTests();
    setResult(await api(`/api/night-tests/${r.id}`));
  };
  return (
    <Layout title={t("Caretaker tools")}>
      {main && (
        <div className={`card ${silent ? "" : "flat"}`}>
          <div className="row between">
            <span>📡 {t("Clip camera")}: <b>{silent ? "⚠️ offline" : "✓ online"}</b><br />
              <span className="small muted">{t("last seen")}: {ago(s?.devices[0]?.last_seen, lang)}</span></span>
            <Link className={`btn small ${silent ? "primary" : ""}`} to={`/read?meter=${main.id}`}>📷 {t("Photograph the main meter now")}</Link>
          </div>
        </div>
      )}
      {msg && <p className="notice warning">{msg}</p>}
      <div className="card">
        <h2>🔍 {t("Readings to check")}</h2>
        {!pending ? <Loading /> : pending.length === 0 ? <p className="muted">{t("Nothing to check.")}</p> : (
          <ul className="list">
            {pending.map((r) => (
              <li key={r.id} className="stack">
                <div className="row between small"><b>{label(r.meter_id)}</b><span className="muted">{r.source} · {ago(r.taken_at, lang)}</span></div>
                {r.photo && <img src={photoUrl(r.photo)} alt="" style={{ borderRadius: 8, maxHeight: 120, objectFit: "contain", background: "#000", width: "100%" }} />}
                <div className="row">
                  <input inputMode="decimal" style={{ flex: 1 }} value={values[r.id] ?? r.suggested ?? ""} onChange={(e) => setValues({ ...values, [r.id]: e.target.value })} />
                  <button className="btn good" onClick={() => confirm(r)}>✓ {t("Confirm")}</button>
                </div>
                {r.issues.length > 0 && <span className="small muted">{r.issues.join(", ")}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="card stack">
        <h2>🧾 {t("Billing round")}</h2>
        <button className="btn primary block" onClick={runBills}>{t("Create bills from the latest readings")}</button>
        {made !== null && <p className="notice good">{made} {t("bills created")}</p>}
        <h3>{t("Unpaid")}</h3>
        {!unpaid ? <Loading /> : (
          <ul className="list">
            {unpaid.slice(0, 30).map((b) => (
              <li key={b.id} className="row between">
                <span>{b.meter} · <b>{money(b.amount)}</b><br /><span className="small muted">{t("Due")}: {day(b.due, lang)}</span> <BillStatus b={b} /></span>
                <button className="btn small" onClick={() => pay(b.id)}>{t("Mark paid")}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="card stack">
        <h2>🌙 {t("Night test")}</h2>
        <p className="small muted">{t("Ask houses in one soi to photograph their meter at bedtime and on waking.")}</p>
        <select value={zone} onChange={(e) => setZone(e.target.value ? Number(e.target.value) : "")}>
          <option value="">{t("All")}</option>
          {s?.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
        <input type="date" value={night} onChange={(e) => setNight(e.target.value)} />
        <button className="btn block" onClick={startTest}>{t("Start night test")}</button>
        {tests?.map((x) => <button key={x.id} className="btn small" onClick={async () => setResult(await api(`/api/night-tests/${x.id}`))}>{t("See result")}: {x.night_of} {s?.zones.find((z) => z.id === x.zone_id)?.name ?? ""}</button>)}
        {result && (
          <div className="notice">
            {result.verdict.map((v) => <p key={v}><b>{t(VERDICT[v] ?? v)}</b>{v === "leak_inside_houses" ? `: ${result.moved.map(label).join(", ")}` : ""}</p>)}
            <p className="small muted">main {result.main_m3 ?? "–"} m³ · excess {result.excess_m3 ?? "–"} m³ · pipe {result.pipe_m3 ?? "–"} m³ · {result.houses.filter((h) => h.status !== "missing").length}/{result.houses.length}</p>
          </div>
        )}
      </div>
    </Layout>
  );
}
