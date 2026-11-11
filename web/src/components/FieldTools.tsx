import { useEffect, useState } from "react";
import { api, BASE } from "../api";
import { useApi } from "../hooks";
import { useT } from "../i18n";
import type { VillageStatus } from "./Status";

type Clip = { device_id: string; api_key: string; webhook_path: string };

function Copy({ text }: { text: string }) {
  const { t } = useT();
  const [ok, setOk] = useState(false);
  return (
    <button className="btn small" onClick={async () => { await navigator.clipboard?.writeText(text); setOk(true); }}>
      {ok ? "✓" : t("Copy")}
    </button>
  );
}

export function ConnectClip({ meterId }: { meterId: number }) {
  const { t } = useT();
  const [clip, setClip] = useState<Clip | null>(null);
  const [err, setErr] = useState("");
  const origin = BASE || location.origin;
  const local = /^(localhost|127\.|\[::1\])/.test(new URL(origin).hostname);
  const create = async () => {
    try {
      setClip(await api<Clip>(`/api/meters/${meterId}/clips`, { method: "POST" }));
    } catch (e: any) {
      setErr(String(e.detail ?? e.message));
    }
  };
  const url = clip ? `${origin}${clip.webhook_path}` : "";
  return (
    <div className="stack">
      <p className="small muted">{t("For a Clip running AI-on-the-edge-device: create a key, then paste these into the Clip's Webhook settings.")}</p>
      {local && <p className="notice warning small">{t("You opened NamJai as localhost. Open it with the computer's Wi-Fi address (shown when the server starts) so the Clip can reach it.")}</p>}
      {!clip && <button className="btn primary block" onClick={create}>🔑 {t("Create a Clip key")}</button>}
      {err && <p className="notice critical">{err}</p>}
      {clip && (
        <div className="notice stack">
          <div><b>Webhook Uri</b><div className="row between"><code style={{ wordBreak: "break-all" }}>{url}</code><Copy text={url} /></div></div>
          <div><b>Webhook ApiKey</b><div className="row between"><code style={{ wordBreak: "break-all" }}>{clip.api_key}</code><Copy text={clip.api_key} /></div></div>
          <div className="small muted">Webhook UploadImg: 2 · AutoTimer Interval: 5 min · {t("The key is shown only once.")}</div>
        </div>
      )}
    </div>
  );
}

export function ImportLog({ meterId }: { meterId: number }) {
  const { t } = useT();
  const [msg, setMsg] = useState("");
  const send = async (files: FileList | null) => {
    if (!files?.length) return;
    const f = new FormData();
    Array.from(files).forEach((x) => f.append("files", x, x.name));
    try {
      const r = await api(`/api/meters/${meterId}/import`, { form: f });
      setMsg(t("{a} readings added, {s} already there.", { a: r.added, s: r.skipped }));
    } catch (e: any) {
      setMsg(String(e.detail ?? e.message));
    }
  };
  return (
    <div className="stack">
      <p className="small muted">{t("If Wi-Fi did not reach the Clip, copy the files from the SD card folder /log/data and add them here.")}</p>
      <input type="file" accept=".csv,text/csv,text/plain" multiple onChange={(e) => send(e.target.files)} />
      {msg && <p className="notice">{msg}</p>}
    </div>
  );
}

type Step = { label: string; state: string; closed_at: string; opened_at: string | null; before_m3h?: number; during_m3h?: number; drop_m3h?: number; drop_pct?: number };
type ST = { id: number; finished: string | null; steps: Step[]; suspect: { label: string } | null; litres_per_day: number | null; people_per_day: number | null };

export function StepTest({ s }: { s: VillageStatus }) {
  const { t } = useT();
  const { data: list, reload } = useApi<ST[]>(`/api/villages/${s.id}/step-tests`, [s.id]);
  const [cur, setCur] = useState<ST | null>(null);
  const [label, setLabel] = useState("");
  const [err, setErr] = useState("");
  const test = cur ?? list?.find((x) => !x.finished) ?? null;
  const open = test?.steps.find((x) => !x.opened_at);
  useEffect(() => {
    if (!test || test.finished) return;
    const h = setInterval(async () => setCur(await api<ST>(`/api/step-tests/${test.id}`)), 30000);
    return () => clearInterval(h);
  }, [test?.id, test?.finished]);
  const act = async (path: string, json?: object) => {
    setErr("");
    try {
      setCur(await api<ST>(path, json ? { json } : { method: "POST" }));
      reload();
    } catch (e: any) {
      setErr(String(e.detail ?? e.message));
    }
  };
  const zones = s.settings?.zones ?? s.zones;
  return (
    <div className="stack">
      <p className="small muted">{t("Close one valve for about 15 minutes, then open it again. The soi whose valve makes the night flow drop most has the leak. The Clip should read every 5 minutes.")}</p>
      {err && <p className="notice critical">{err}</p>}
      {!test && <button className="btn primary block" onClick={() => act(`/api/villages/${s.id}/step-tests`)}>{t("Start a step test")}</button>}
      {test && !test.finished && (
        open ? (
          <div className="notice warning stack">
            <b>{t("Valve closed")}: {open.label}</b>
            <span className="small">{new Date(open.closed_at).toLocaleTimeString()}</span>
            <button className="btn primary block" onClick={() => act(`/api/step-tests/${test.id}/open`)}>{t("Valve opened again")}</button>
          </div>
        ) : (
          <>
            <div className="grid">
              {zones.map((z) => (
                <button key={z.id} className="btn" onClick={() => act(`/api/step-tests/${test.id}/close`, { label: z.name, zone_id: z.id })}>🔧 {t("Close")}: {z.name}</button>
              ))}
            </div>
            <div className="row">
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("Other valve")} style={{ flex: 1 }} />
              <button className="btn" disabled={!label} onClick={() => act(`/api/step-tests/${test.id}/close`, { label })}>{t("Close")}</button>
            </div>
            <button className="btn block" onClick={() => act(`/api/step-tests/${test.id}/finish`)}>{t("Finish the test")}</button>
          </>
        )
      )}
      {test && test.steps.length > 0 && (
        <table>
          <thead><tr><th>{t("Valve closed")}</th><th className="num">{t("Flow before")}</th><th className="num">{t("Flow drop")}</th></tr></thead>
          <tbody>
            {test.steps.map((x, i) => (
              <tr key={i}>
                <td>{x.label}{test.suspect?.label === x.label ? " ⚠️" : ""}</td>
                <td className="num">{x.before_m3h != null ? `${Math.round(x.before_m3h * 1000)} L/h` : "…"}</td>
                <td className="num">{x.drop_m3h != null ? `${Math.round(x.drop_m3h * 1000)} L/h (${x.drop_pct}%)` : x.state === "no_data" ? t("no readings") : "…"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {test?.suspect && <p className="notice critical"><b>{t("Leak likely behind")}: {test.suspect.label}</b> · {t("about {l} L a day, water for {p} people", { l: test.litres_per_day?.toLocaleString(), p: test.people_per_day })}</p>}
      {test?.finished && <button className="btn block" onClick={() => { setCur(null); act(`/api/villages/${s.id}/step-tests`); }}>{t("Start a new step test")}</button>}
    </div>
  );
}

type Settings = { currency: string; price_per_m3: number; min_charge: number; agencies: { name: string; email?: string; phone?: string }[]; zones: { id: number; name: string }[] };

export function VillageSettings({ vid }: { vid: number }) {
  const { t } = useT();
  const { data, setData } = useApi<Settings>(`/api/villages/${vid}/settings`, [vid]);
  const [zone, setZone] = useState("");
  const [msg, setMsg] = useState("");
  if (!data) return null;
  const set = (k: keyof Settings, v: unknown) => setData({ ...data, [k]: v } as Settings);
  const save = async () => {
    try {
      const body = { currency: data.currency.toUpperCase(), price_per_m3: Number(data.price_per_m3), min_charge: Number(data.min_charge),
        agencies: data.agencies.filter((a) => a.name.trim()), new_zones: zone.split(",").map((z) => z.trim()).filter(Boolean) };
      setData(await api<Settings>(`/api/villages/${vid}/settings`, { method: "PUT", json: body }));
      setZone("");
      setMsg(t("Saved. Thank you!"));
    } catch (e: any) {
      setMsg(JSON.stringify(e.detail ?? e.message));
    }
  };
  return (
    <div className="stack">
      <div className="grid3">
        <div><label>{t("Currency")}</label><input value={data.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></div>
        <div><label>{t("Price per m³")}</label><input inputMode="decimal" value={data.price_per_m3} onChange={(e) => set("price_per_m3", e.target.value)} /></div>
        <div><label>{t("Minimum bill")}</label><input inputMode="decimal" value={data.min_charge} onChange={(e) => set("min_charge", e.target.value)} /></div>
      </div>
      <label>{t("Who to send repair evidence to")}</label>
      {data.agencies.map((a, i) => (
        <div key={i} className="row">
          <input placeholder={t("Name")} value={a.name} onChange={(e) => set("agencies", data.agencies.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} style={{ flex: 2 }} />
          <input placeholder="Email" value={a.email ?? ""} onChange={(e) => set("agencies", data.agencies.map((x, j) => (j === i ? { ...x, email: e.target.value || undefined } : x)))} style={{ flex: 2 }} />
          <input placeholder={t("Phone number")} value={a.phone ?? ""} onChange={(e) => set("agencies", data.agencies.map((x, j) => (j === i ? { ...x, phone: e.target.value || undefined } : x)))} style={{ flex: 1 }} />
        </div>
      ))}
      <button className="btn small" onClick={() => set("agencies", [...data.agencies, { name: "" }])}>+ {t("Add")}</button>
      <label>{t("Sois or zones")}: {data.zones.map((z) => z.name).join(", ") || "–"}</label>
      <input placeholder={t("New sois, separated by commas")} value={zone} onChange={(e) => setZone(e.target.value)} />
      <button className="btn primary block" onClick={save}>{t("Save")}</button>
      {msg && <p className="notice">{msg}</p>}
    </div>
  );
}
