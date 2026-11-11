import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { HBars, HourlyChart, NightChart } from "../components/Charts";
import { Layout, Loading } from "../components/Layout";
import { Map, type Pin } from "../components/Map";
import { StatusCard, type VillageStatus } from "../components/Status";
import { litres, useApi } from "../hooks";
import { useT } from "../i18n";
import { KINDS } from "./Report";

type Balance = { month: string; complete: boolean; supplied_m3: number; billed_m3: number; loss_m3: number; loss_pct: number | null; houses_read: number; houses_missing: number[]; zones: { zone_id: number; m3: number }[] };

function months() {
  const out: string[] = [];
  const d = new Date();
  for (let i = 1; i <= 4; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export default function Dashboard() {
  const { id } = useParams();
  const { t, lang } = useT();
  const [days, setDays] = useState(7);
  const [month, setMonth] = useState<string | null>(null);
  const { data: s, error } = useApi<VillageStatus>(`/api/villages/${id}/status`, [id]);
  const { data: hourly } = useApi<{ points: { hour: string; flow: number | null }[] }>(`/api/villages/${id}/hourly?days=${days}`, [id, days]);
  const { data: nights } = useApi<{ nights: any[]; baseline: number | null }>(`/api/villages/${id}/nights?days=30`, [id]);
  const { data: bal } = useApi<Balance>(`/api/villages/${id}/balance${month ? `?month=${month}` : ""}`, [id, month]);
  const { data: jobs } = useApi<any[]>(`/api/villages/${id}/repairs?include_done=false`, [id]);
  if (!s) return <Layout title={t("Dashboard")} wide><Loading error={error} /></Layout>;
  const zoneName = (z: number) => s.zones.find((x) => x.id === z)?.name ?? "–";
  const main = s.meters.find((m) => m.kind === "main");
  const pins: Pin[] = [
    ...(main?.lat ? [{ id: "main", lat: main.lat, lon: main.lon!, cls: s.level, text: "M", popup: <b>{t("Main meter")}</b> }] : []),
    ...s.meters.filter((m) => m.kind === "house" && m.lat).slice(0, 200).map((m) => ({ id: `h${m.id}`, lat: m.lat!, lon: m.lon!, cls: "house", text: "", popup: <>{m.label} · {zoneName(m.zone_id!)}</> })),
    ...(jobs ?? []).filter((j) => j.lat).map((j) => ({ id: `j${j.id}`, lat: j.lat, lon: j.lon, cls: "job", text: "!", popup: <Link to={`/repairs/${j.id}`}>{KINDS[j.kind]?.icon} {t(KINDS[j.kind]?.label ?? j.kind)} #{j.id}</Link> })),
  ];
  return (
    <Layout title={`${t("Dashboard")} · ${s.name}`} wide>
      <StatusCard s={s} />
      {s.simulated && <p><span className="sim-tag">{t("Simulated data")}</span></p>}
      <Link className="btn block" to={`/story/${id}`}>🎬 {t("Leak story")}: See → Locate → Fix → Prove</Link>
      <div className="card">
        <div className="row between"><h2>{t("Hourly flow at the main meter")}</h2>
          <div className="tabs">{[2, 7, 14].map((d) => <button key={d} aria-pressed={days === d} onClick={() => setDays(d)}>{d}d</button>)}</div>
        </div>
        {hourly ? <HourlyChart points={hourly.points} lang={lang} /> : <Loading />}
      </div>
      <div className="card">
        <h2>{t("Night flow (01:00–05:00)")}</h2>
        {nights ? <NightChart nights={nights.nights.slice(-30)} baseline={nights.baseline} lang={lang} /> : <Loading />}
      </div>
      <div className="card">
        <div className="row between"><h2>{t("Water balance")}</h2>
          <select value={month ?? bal?.month ?? ""} onChange={(e) => setMonth(e.target.value)} style={{ width: "auto" }}>{months().map((m) => <option key={m}>{m}</option>)}</select>
        </div>
        {!bal ? <Loading /> : (
          <>
            {!bal.complete && <p className="notice warning">{t("Not every house is read for this month yet – numbers are incomplete.")}</p>}
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
              <div className="card flat" style={{ margin: 0 }}><div className="small muted">{t("Supplied")}</div><b style={{ fontSize: "1.25rem" }}>{bal.supplied_m3.toLocaleString()} m³</b></div>
              <div className="card flat" style={{ margin: 0 }}><div className="small muted">{t("Billed")}</div><b style={{ fontSize: "1.25rem" }}>{bal.billed_m3.toLocaleString()} m³</b></div>
              <div className="card flat" style={{ margin: 0 }}><div className="small muted">{t("Lost")}</div><b style={{ fontSize: "1.25rem" }}>{bal.complete ? `${bal.loss_m3.toLocaleString()} m³` : "–"}</b>{bal.complete && bal.loss_pct != null && <span className="muted"> ({bal.loss_pct}%)</span>}</div>
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>{bal.houses_read} {t("houses read")}{bal.houses_missing.length ? ` · ${bal.houses_missing.length} missing` : ""}</p>
            <HBars unit="m³" rows={bal.zones.map((z) => ({ label: zoneName(z.zone_id), value: Math.round(z.m3) }))} />
          </>
        )}
      </div>
      <div className="card">
        <h2>{t("Village map")}</h2>
        <Map pins={pins} />
        {jobs && jobs.length > 0 && <ul className="list" style={{ marginTop: 8 }}>{jobs.map((j) => <li key={j.id}><Link to={`/repairs/${j.id}`}>{KINDS[j.kind]?.icon} {t(KINDS[j.kind]?.label ?? j.kind)} #{j.id}</Link>{j.litres_per_day ? ` · ${litres(j.litres_per_day)} ${t("lost per day")}` : ""}</li>)}</ul>}
      </div>
      {s && <p className="center"><Link to={`/network/${(s as any).network_id ?? 1}`}>🤝 {t("District network")} →</Link></p>}
    </Layout>
  );
}

export function Network() {
  const { id } = useParams();
  const { t } = useT();
  const { data: n, error } = useApi<any>(`/api/networks/${id}`, [id]);
  if (!n) return <Layout title={t("District network")} wide><Loading error={error} /></Layout>;
  const icon = { green: "✓", yellow: "!", red: "‼" } as Record<string, string>;
  const pins: Pin[] = [
    ...n.villages.map((v: any) => ({ id: `v${v.id}`, lat: v.lat, lon: v.lon, cls: v.level, text: icon[v.level], popup: <Link to={`/dashboard/${v.id}`}>{v.name}</Link> })),
    ...n.depots.map((d: any) => ({ id: `d${d.id}`, lat: d.lat, lon: d.lon, cls: "depot", text: "📦", popup: <><b>{d.name}</b><br />{Object.entries(d.items).map(([k, q]) => `${k}: ${q}`).join(", ")}</> })),
    ...n.technicians.map((x: any) => ({ id: `t${x.id}`, lat: x.lat, lon: x.lon, cls: "tech", text: "👷", popup: <>{x.name}</> })),
  ];
  const level = { red: 0, yellow: 1, green: 2 } as Record<string, number>;
  return (
    <Layout title={`🤝 ${n.name}`} wide>
      <p className="muted" style={{ marginTop: 12 }}>{t("Shared technicians, parts store and fund for all villages.")}</p>
      <Map pins={pins} zoom={12} />
      <div className="card">
        <table>
          <thead><tr><th>{t("Village")}</th><th>Status</th><th className="num">{t("lost per day")}</th></tr></thead>
          <tbody>
            {[...n.villages].sort((a: any, b: any) => level[a.level] - level[b.level]).map((v: any) => (
              <tr key={v.id}>
                <td><Link to={`/dashboard/${v.id}`}>{v.name}</Link> {v.simulated && <span className="sim-tag">sim</span>}</td>
                <td><span className={`chip ${v.level === "red" ? "critical" : v.level === "yellow" ? "warning" : "good"}`}>{icon[v.level]} {v.kinds.join(", ") || "OK"}</span></td>
                <td className="num">{v.litres_per_day ? litres(v.litres_per_day) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
