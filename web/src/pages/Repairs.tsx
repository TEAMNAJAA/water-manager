import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, photoUrl } from "../api";
import { useAuth } from "../auth";
import { Chip, Layout, Loading } from "../components/Layout";
import { ago, day, litres, people, useApi } from "../hooks";
import { useT } from "../i18n";
import { KINDS } from "./Report";

type Job = { id: number; kind: string; source: string; note: string | null; status: string; litres_per_day: number | null; size: string | null;
  technician: string | null; technician_id: number | null; created: string; updated: string; photo: string | null; lat: number | null; lon: number | null;
  verified: boolean; parts: { name: string; qty: number }[]; history: { at: string; status: string; by: string }[]; village_id: number;
  people_per_day: number | null; proof: Proof };

export type Proof = { state?: "waiting" | "confirmed" | "not_fixed"; since?: string; nights_needed?: number; nights_ok?: number; nights_seen?: number;
  leak_m3h?: number; litres_stopped_per_day?: number; people_per_day?: number; confirmed?: string };

const STATUS: Record<string, { label: string; kind?: "good" | "warning" | "critical" }> = {
  open: { label: "Open", kind: "critical" }, assigned: { label: "Assigned", kind: "warning" }, fixing: { label: "Fixing", kind: "warning" },
  checking: { label: "Repaired – meter checking", kind: "warning" }, done: { label: "Done", kind: "good" }, cancelled: { label: "Cancelled" },
};

export function JobStatus({ s }: { s: string }) {
  const { t } = useT();
  return <Chip kind={STATUS[s]?.kind}>{t(STATUS[s]?.label ?? s)}</Chip>;
}

const GUIDES = [
  { title: { en: "Dripping tap", th: "ก๊อกน้ำหยด" }, steps: { en: ["Close the valve before the tap.", "Unscrew the tap head with a wrench.", "Replace the rubber washer (take the old one to the shop).", "Screw back, open the valve, check for drips."], th: ["ปิดวาล์วก่อนถึงก๊อก", "ใช้ประแจคลายหัวก๊อก", "เปลี่ยนยางรองใน (เอาอันเก่าไปเทียบที่ร้าน)", "ประกอบกลับ เปิดวาล์ว แล้วดูว่ายังหยดไหม"] } },
  { title: { en: "Leaking pipe joint", th: "ข้อต่อท่อรั่ว" }, steps: { en: ["Close the main valve of the house.", "Dry the joint and wrap it with PVC repair tape, or cut and glue a new coupling.", "Wait for the glue to set (see the can) before opening the water."], th: ["ปิดวาล์วหลักของบ้าน", "เช็ดให้แห้ง พันเทปซ่อมท่อ หรือ ตัดแล้วทากาวใส่ข้อต่อใหม่", "รอกาวแห้งตามที่ระบุบนกระป๋องก่อนเปิดน้ำ"] } },
  { title: { en: "Toilet keeps running", th: "ชักโครกน้ำไหลไม่หยุด" }, steps: { en: ["Open the tank lid.", "Check the float: bend or adjust it so water stops below the overflow pipe.", "If the rubber flapper is old, replace it."], th: ["เปิดฝาถังพักน้ำ", "ปรับลูกลอยให้น้ำหยุดต่ำกว่าท่อน้ำล้น", "ถ้ายางปิดน้ำเก่าให้เปลี่ยนใหม่"] } },
  { title: { en: "Is my house leaking?", th: "บ้านฉันรั่วไหม?" }, steps: { en: ["Close every tap and do not use water.", "Read the meter, wait 30 minutes, read again.", "If the number or the small dial moved, there is a leak inside the house."], th: ["ปิดก๊อกทุกตัวและไม่ใช้น้ำ", "จดเลขมิเตอร์ รอ 30 นาที แล้วจดอีกครั้ง", "ถ้าเลขหรือเข็มเล็กขยับ แปลว่ามีรั่วในบ้าน"] } },
];

export default function Repairs() {
  const { t, lang } = useT();
  const { me } = useAuth();
  const [filter, setFilter] = useState<"active" | "all">("active");
  const tech = me?.role === "technician";
  const { data, error } = useApi<(Job & { village?: string })[]>(tech ? "/api/technician/jobs" : me?.village_id ? `/api/villages/${me.village_id}/repairs` : null, [me?.village_id, tech]);
  const jobs = (data ?? []).filter((j) => filter === "all" || !["done", "cancelled"].includes(j.status));
  return (
    <Layout title={t("Repairs")}>
      <div className="row between" style={{ marginTop: 12 }}>
        <div className="tabs">
          <button aria-pressed={filter === "active"} onClick={() => setFilter("active")}>{t("Active")}</button>
          <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>{t("All")}</button>
        </div>
        {!tech && <Link to="/report" className="btn danger small">⚠️ {t("Report a problem")}</Link>}
      </div>
      <p className="small muted">{t("Biggest water loss first.")} {t("Everyone sees this.")}</p>
      {!data ? <Loading error={error} /> : (
        <ul className="list card">
          {jobs.length === 0 && <li className="muted">✓</li>}
          {jobs.map((j) => (
            <li key={j.id}>
              <Link to={`/repairs/${j.id}`} className="row between" style={{ color: "inherit", textDecoration: "none" }}>
                <span className="row" style={{ gap: 10 }}>
                  <span style={{ fontSize: 28 }}>{KINDS[j.kind]?.icon ?? "🔧"}</span>
                  <span>
                    <b>{t(KINDS[j.kind]?.label ?? j.kind)}</b> <span className="muted">#{j.id}{j.village ? ` · ${j.village}` : ""}</span><br />
                    <span className="small muted">{ago(j.created, lang)}{j.litres_per_day ? ` · ${litres(j.litres_per_day)} ${t("lost per day")}` : ""}{j.people_per_day ? ` · ${t("water for {p} people", { p: people(j.people_per_day) })}` : ""}{j.technician ? ` · 👷 ${j.technician}` : ""}</span>
                  </span>
                </span>
                <JobStatus s={j.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <h2 id="guides" style={{ marginTop: 24 }}>🛠️ {t("Repair guides")}</h2>
      {GUIDES.map((g) => (
        <details key={g.title.en} className="card">
          <summary style={{ fontWeight: 700, cursor: "pointer" }}>{g.title[lang]}</summary>
          <ol>{g.steps[lang].map((s) => <li key={s}>{s}</li>)}</ol>
        </details>
      ))}
    </Layout>
  );
}

export function ProofBox({ proof, lang }: { proof: Proof; lang: string }) {
  const { t } = useT();
  if (!proof?.state) return null;
  if (proof.state === "confirmed")
    return (
      <div className="notice good">
        <b>✓ {t("Confirmed by the meter")}</b>
        <p style={{ margin: "4px 0 0" }}>{t("Night flow is back to normal. About {l} a day stopped – water for {p} people.", { l: litres(proof.litres_stopped_per_day), p: people(proof.people_per_day) })}</p>
        <span className="small muted">{day(proof.confirmed, lang)}</span>
      </div>
    );
  if (proof.state === "not_fixed")
    return <div className="notice critical"><b>{t("The meter still sees the leak")}</b><p style={{ margin: "4px 0 0" }}>{t("Night flow stayed high after the repair, so the job is open again.")}</p></div>;
  return (
    <div className="notice warning">
      <b>⏳ {t("Waiting for the meter to confirm")}</b>
      <p style={{ margin: "4px 0 0" }}>{t("{ok} of {need} normal nights so far.", { ok: proof.nights_ok ?? 0, need: proof.nights_needed ?? 2 })}</p>
    </div>
  );
}

export function RepairDetail() {
  const { id } = useParams();
  const { t, lang } = useT();
  const { me, staff } = useAuth();
  const { data: j, error, setData } = useApi<Job>(`/api/repairs/${id}`);
  const { data: near } = useApi<{ technicians: { id: number; name: string; km: number | null; active_jobs: number }[]; depots: { id: number; name: string; km: number | null; items: Record<string, number> }[] }>(`/api/repairs/${id}/technicians`);
  const [verified, setVerified] = useState(false);
  const [depot, setDepot] = useState<number | "">("");
  const [part, setPart] = useState("");
  const [qty, setQty] = useState(1);
  const [cost, setCost] = useState("");
  const [msg, setMsg] = useState("");
  const tech = me?.role === "technician";
  const can = staff || tech;
  const patch = async (body: object) => setData(await api<Job>(`/api/repairs/${id}`, { method: "PATCH", json: body }));
  const finish = () => patch({ status: "done", verified, ...(depot ? { depot_id: depot, parts: part ? [{ name: part, qty }] : [] } : {}) });
  const askFund = async () => {
    await api(`/api/villages/${j!.village_id}/funds`, { json: { wallet: "repair", direction: "expense", amount: Number(cost), kind: "repair_cost", note: `Repair job #${id}`, ref: `job:${id}` } });
    setMsg(t("Request sent – needs another approval."));
  };
  if (!j) return <Layout title={t("Repairs")}><Loading error={error} /></Layout>;
  const items = near?.depots.find((d) => d.id === depot)?.items ?? {};
  return (
    <Layout title={`${t(KINDS[j.kind]?.label ?? j.kind)} #${j.id}`}>
      <div className="card stack">
        <div className="row between"><span style={{ fontSize: 40 }}>{KINDS[j.kind]?.icon}</span><JobStatus s={j.status} /></div>
        {j.note && <p>{j.note}</p>}
        {j.litres_per_day != null && <div className="kv"><span className="muted">{t("lost per day")}</span><b>{litres(j.litres_per_day)}</b></div>}
        {j.people_per_day != null && <div className="kv"><span className="muted">{t("Enough for")}</span><b>{t("{p} people a day", { p: people(j.people_per_day) })}</b></div>}
        <ProofBox proof={j.proof} lang={lang} />
        {j.technician && <div className="kv"><span className="muted">{t("Technician")}</span><b>👷 {j.technician}</b></div>}
        {j.verified && <Chip kind="good">✓ {t("Leak confirmed by technician")}</Chip>}
        {j.photo && <img src={photoUrl(j.photo)} alt="" style={{ borderRadius: 12 }} />}
        {j.lat != null && <a className="btn block" href={`https://www.openstreetmap.org/?mlat=${j.lat}&mlon=${j.lon}#map=18/${j.lat}/${j.lon}`} target="_blank" rel="noreferrer">📍 Map</a>}
      </div>
      <Link className="btn block" to={`/report/${j.id}`}>📄 {t("Evidence report")}</Link>
      {can && !["done", "cancelled", "checking"].includes(j.status) && (
        <div className="card stack">
          {tech && !j.technician_id && <button className="btn primary block" onClick={() => patch({ status: "assigned" })}>👷 {t("Assign to me")}</button>}
          {j.status !== "fixing" && <button className="btn block" onClick={() => patch({ status: "fixing" })}>🔧 {t("Start fixing")}</button>}
          <label className="row"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} /> {t("Leak confirmed by technician")}</label>
          <label>{t("Parts used")}</label>
          <select value={depot} onChange={(e) => setDepot(e.target.value ? Number(e.target.value) : "")}>
            <option value="">–</option>
            {near?.depots.map((d) => <option key={d.id} value={d.id}>{d.name} {d.km != null ? `(${d.km} km)` : ""}</option>)}
          </select>
          {depot !== "" && (
            <div className="row">
              <select value={part} onChange={(e) => setPart(e.target.value)} style={{ flex: 3 }}>
                <option value="">–</option>
                {Object.entries(items).map(([k, v]) => <option key={k} value={k} disabled={v < 1}>{k} ({v})</option>)}
              </select>
              <input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} style={{ flex: 1 }} />
            </div>
          )}
          <button className="btn good block" onClick={finish}>✅ {t("Mark repaired")}</button>
          <p className="small muted">{t("For a leak the meter saw, the job closes after 2 normal nights.")}</p>
        </div>
      )}
      {staff && (
        <div className="card stack">
          <h3>💰 {t("Ask the repair fund to pay")}</h3>
          <input inputMode="decimal" placeholder="฿" value={cost} onChange={(e) => setCost(e.target.value)} />
          <button className="btn block" disabled={!Number(cost)} onClick={askFund}>{t("Send")}</button>
          {msg && <p className="notice good">{msg}</p>}
        </div>
      )}
      {near && (
        <div className="card">
          <h3>👷 {t("Nearest technicians")}</h3>
          <ul className="list">{near.technicians.map((x) => <li key={x.id} className="row between"><span>{x.name}</span><span className="muted small">{x.km ?? "?"} km · {x.active_jobs} 🔧</span></li>)}</ul>
          <h3 style={{ marginTop: 12 }}>📦 {t("Parts stores")}</h3>
          <ul className="list">{near.depots.map((d) => <li key={d.id} className="row between"><span>{d.name}</span><span className="muted small">{d.km ?? "?"} km</span></li>)}</ul>
        </div>
      )}
      <div className="card">
        <h3>{t("History")}</h3>
        <ul className="list">{j.history.map((h, i) => <li key={i} className="row between small"><span><JobStatus s={h.status} /> {h.by}</span><span className="muted">{ago(h.at, lang)}</span></li>)}</ul>
      </div>
    </Layout>
  );
}
