import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Camera, type Shot } from "../components/Camera";
import { Layout, Loading } from "../components/Layout";
import type { VillageStatus } from "../components/Status";
import { useApi } from "../hooks";
import { useT } from "../i18n";

type Result = { id: number; suggested: number; digits: string; cells: { digit: number; p: number }[]; quality: { issues: string[] }; issues: string[]; alternative: number | null; queued?: boolean };

const QUALITY: Record<string, string> = {
  blurry: "The photo is blurry. Hold the phone still and retake.",
  too_dark: "The photo is too dark. Turn on the light or flash.",
  glare: "The photo has glare. Tilt the phone a little and retake.",
  low_contrast: "The glass looks foggy or dirty. Wipe it and retake.",
};
const HISTORY: Record<string, string> = {
  decreased: "This number is lower than last time. Please check it.",
  jump_too_large: "This number is much higher than possible since last time. Please check it.",
};

function TypedForm({ meterId, staff, onDone }: { meterId: number; staff: boolean; onDone: (queued: boolean) => void }) {
  const { t } = useT();
  const file = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [msg, setMsg] = useState("");
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setMsg("");
    const f = new FormData();
    f.append("value", value.replace(",", "."));
    f.append("taken_at", new Date().toISOString());
    if (force) f.append("force", "true");
    if (photo) f.append("file", photo, "meter.jpg");
    try {
      const r = await api(`/api/meters/${meterId}/typed`, { form: f, queue: "Meter reading" });
      onDone(!!r.queued);
    } catch (e: any) {
      const issues: string[] = e.detail?.issues ?? [];
      setMsg(issues.map((i) => t(HISTORY[i] ?? i)).join(" ") || String(e.detail ?? e.message));
    }
    setBusy(false);
  };
  return (
    <div className="card stack" style={{ marginTop: 12 }}>
      <label htmlFor="typed">{t("Type the number on the meter")}</label>
      <input id="typed" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0345.426"
        style={{ fontSize: "1.6rem", textAlign: "center", letterSpacing: "0.15em" }} />
      <p className="small muted">{t("Type every digit you see, the red ones too.")}</p>
      <button className="btn block" onClick={() => file.current?.click()}>📷 {photo ? "✓ " : ""}{t("Add a photo of the meter")}{staff ? "" : " *"}</button>
      <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
      {msg && <p className="notice warning">{msg}</p>}
      {msg && staff && <label className="row"><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> {t("Save anyway (I checked the number)")}</label>}
      <button className="btn primary block" disabled={busy || !value || (!photo && !staff)} onClick={save}>{t("Save")}</button>
    </div>
  );
}

export default function ReadMeter() {
  const { t } = useT();
  const { me, staff, refresh } = useAuth();
  const [params] = useSearchParams();
  const { data: s } = useApi<VillageStatus>(me?.village_id ? `/api/villages/${me.village_id}/status` : null, [me?.village_id]);
  const meters = (s?.meters ?? []).filter((m) => staff || m.kind === "main" || m.id === me?.meter_id);
  const [meterId, setMeterId] = useState<number | null>(Number(params.get("meter")) || null);
  const meter = meters.find((m) => m.id === (meterId ?? me?.meter_id ?? meters[0]?.id));
  const [shot, setShot] = useState<Shot | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [fix, setFix] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: string; text: string } | null>(null);
  const [done, setDone] = useState(false);
  const [typed, setTyped] = useState(false);

  const upload = async (sh: Shot) => {
    if (!meter) return;
    setShot(sh);
    setBusy(true);
    setMsg(null);
    const f = new FormData();
    f.append("file", sh.blob, "meter.jpg");
    const q = `?taken_at=${encodeURIComponent(new Date().toISOString())}${sh.roi ? `&roi=${sh.roi.join(",")}` : ""}`;
    try {
      const r = await api<Result>(`/api/meters/${meter.id}/photo${q}`, { form: f, queue: "Meter photo" });
      setRes(r);
      if (r.queued) setMsg({ kind: "good", text: t("Saved on this phone. It will be sent when you are online.") });
    } catch (e: any) {
      setMsg({ kind: "critical", text: `${t("Something went wrong")}: ${e.message}` });
    }
    setBusy(false);
  };

  const confirm = async (value: number, force = false) => {
    if (!res) return;
    setBusy(true);
    try {
      await api(`/api/readings/${res.id}/confirm`, { json: { value, force } });
      setDone(true);
      refresh();
    } catch (e: any) {
      const issues: string[] = e.detail?.issues ?? [];
      setMsg({ kind: "warning", text: issues.map((i) => t(HISTORY[i] ?? i)).join(" ") || e.message });
    }
    setBusy(false);
  };

  const reset = () => {
    setShot(null);
    setRes(null);
    setFix(null);
    setMsg(null);
    setDone(false);
    setTyped(false);
  };

  if (!me) return <Loading />;
  const scaleDigits = res?.digits ?? "";
  return (
    <Layout title={t("Read a meter")}>
      {meters.length > 1 && !shot && (
        <>
          <label>{t("Meter")}</label>
          <select value={meter?.id} onChange={(e) => setMeterId(Number(e.target.value))}>
            {meters.map((m) => <option key={m.id} value={m.id}>{m.kind === "main" ? `⭐ ${t("Main meter")}` : m.label}</option>)}
          </select>
        </>
      )}
      {!meter && <Loading />}
      {done ? (
        <div className="card center stack">
          <div style={{ fontSize: 56 }}>✅</div>
          <h2>{t("Saved. Thank you!")}</h2>
          {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
          <button className="btn block" onClick={reset}>📷 {t("Read a meter")}</button>
          <Link className="btn primary block" to="/">🏠 NamJai</Link>
        </div>
      ) : typed && meter ? (
        <>
          <TypedForm meterId={meter.id} staff={staff} onDone={(queued) => {
            setDone(true);
            if (queued) setMsg({ kind: "good", text: t("Saved on this phone. It will be sent when you are online.") });
            refresh();
          }} />
          <button className="btn block" onClick={() => setTyped(false)}>📷 {t("Take a photo instead")}</button>
        </>
      ) : !shot ? (
        meter && (
          <div style={{ marginTop: 12 }} className="stack">
            <Camera onShot={upload} />
            <button className="btn block" onClick={() => setTyped(true)}>⌨️ {t("Type the number instead")}</button>
          </div>
        )
      ) : (
        <div className="stack" style={{ marginTop: 12 }}>
          <img src={shot.url} alt="" style={{ borderRadius: 12, maxHeight: 220, objectFit: "contain", width: "100%", background: "#000" }} />
          {busy && <Loading />}
          {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
          {res && !res.queued && (
            <div className="card stack">
              {res.quality.issues.map((q) => <div key={q} className="notice warning">{t(QUALITY[q] ?? q)}</div>)}
              {res.issues.filter((i) => HISTORY[i]).map((i) => <div key={i} className="notice warning">{t(HISTORY[i])}</div>)}
              <p className="center muted">{t("We read")}</p>
              <div className="digits" aria-label={scaleDigits}>
                {scaleDigits.split("").map((d, i) => <span key={i} className={res.cells[i]?.p < 0.9 ? "weak" : ""}>{d}</span>)}
              </div>
              {res.cells.some((c) => c.p < 0.9) && <p className="small muted center">{t("Highlighted digits were hard to read.")}</p>}
              <h2 className="center">{t("Is this right?")}</h2>
              {fix === null ? (
                <>
                  <button className="btn good block" disabled={busy} onClick={() => confirm(res.suggested)}>✅ {t("Yes, correct")}</button>
                  <button className="btn block" onClick={() => setFix(scaleDigits)}>✏️ {t("Fix the number")}</button>
                </>
              ) : (
                <>
                  <input inputMode="decimal" value={fix} onChange={(e) => setFix(e.target.value)} style={{ fontSize: "1.6rem", textAlign: "center", letterSpacing: "0.2em" }} />
                  <button className="btn primary block" disabled={busy || !fix} onClick={() => confirm(+(Number(fix) * meter!.scale).toFixed(4))}>{t("Save")}</button>
                  {staff && msg?.kind === "warning" && <button className="btn block" onClick={() => confirm(+(Number(fix) * meter!.scale).toFixed(4), true)}>⚠️ {t("Save")} (force)</button>}
                </>
              )}
            </div>
          )}
          <button className="btn block" onClick={reset}>🔄 {t("Retake")}</button>
        </div>
      )}
    </Layout>
  );
}
