import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { litres, people } from "../hooks";
import { useT } from "../i18n";
import { JobStatus } from "../pages/Repairs";
import type { VillageStatus } from "./Status";

export type MapJob = {
  id: number; kind: string; status: string; zone_id: number | null; technician: string | null;
  litres_per_day: number | null; people_per_day: number | null; eta: string | null; note: string | null;
};

type Pick = { kind: "tank" } | { kind: "zone"; id: number | null } | { kind: "house"; id: number } | { kind: "job"; id: number };

const ACTIVE = ["open", "assigned", "fixing", "checking"];
const WORKING = ["assigned", "fixing"];
const LEAKY = ["leak_detected", "burst_detected", "leak", "wet_ground"];
const ANCHORS: [number, number][] = [[178, 112], [262, 150], [318, 196], [214, 196], [124, 178], [286, 104]];
const TANK: [number, number] = [74, 66];
const MAIN: [number, number] = [112, 98];

function House({ x, y, hot, on }: { x: number; y: number; hot?: boolean; on?: boolean }) {
  const w = 11, h = 9;
  return (
    <g transform={`translate(${x} ${y})`} className={`house${hot ? " hot" : ""}${on ? " on" : ""}`}>
      <polygon points={`${-w},0 0,${w / 2} 0,${w / 2 + h} ${-w},${h}`} className="wall-l" />
      <polygon points={`0,${w / 2} ${w},0 ${w},${h} 0,${w / 2 + h}`} className="wall-r" />
      <polygon points={`${-w - 1},0 0,${-w + 1} ${w + 1},0 0,${w / 2 + 1}`} className="roof" />
    </g>
  );
}

function eta(iso: string | null, lang: string) {
  if (!iso) return null;
  const d = new Date(iso);
  const mins = Math.round((d.getTime() - Date.now()) / 60000);
  const at = d.toLocaleTimeString(lang === "th" ? "th-TH" : "en-GB", { hour: "2-digit", minute: "2-digit" });
  return { at, mins };
}

export function VillageMap({ s, jobs }: { s: VillageStatus; jobs: MapJob[] }) {
  const { t, lang } = useT();
  const [pick, setPick] = useState<Pick | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(i);
  }, []);

  const zones = useMemo(() => {
    const list: { id: number | null; name: string }[] = s.zones.map((z) => ({ id: z.id, name: z.name }));
    const houses = s.meters.filter((m) => m.kind === "house");
    if (houses.some((m) => m.zone_id == null) || !list.length) list.push({ id: null, name: t("Other houses") });
    return list.slice(0, ANCHORS.length).map((z, i) => ({ ...z, at: ANCHORS[i], houses: houses.filter((m) => (m.zone_id ?? null) === z.id) }));
  }, [s, t]);
  const zoneAt = (id: number | null) => zones.find((z) => z.id === id)?.at ?? [(MAIN[0] + ANCHORS[0][0]) / 2, (MAIN[1] + ANCHORS[0][1]) / 2 + 4];
  const hot = new Set(s.alerts.filter((a) => a.kind === "house_high").map((a) => a.data?.meter_id));
  const active = jobs.filter((j) => ACTIVE.includes(j.status));
  const pipeState = s.level === "red" ? "bad" : s.level === "yellow" ? "watch" : "ok";

  const seen = useRef<string | null>(null);
  useEffect(() => {
    const key = `namjai.working.${s.id}`;
    let before: number[] = [];
    try { before = JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { /* storage off */ }
    const now = jobs.filter((j) => WORKING.includes(j.status)).map((j) => j.id);
    const finished = jobs.filter((j) => before.includes(j.id) && ["checking", "done"].includes(j.status));
    const sig = JSON.stringify(now);
    if (seen.current !== sig) {
      seen.current = sig;
      try { localStorage.setItem(key, sig); } catch { /* storage off */ }
    }
    if (finished.length) {
      setToast(finished.map((j) => t("Repair #{id} is finished. The technician has left.", { id: j.id })).join(" "));
      const h = setTimeout(() => setToast(null), 8000);
      return () => clearTimeout(h);
    }
  }, [jobs, s.id, t]);

  const sel = pick?.kind === "job" ? jobs.find((j) => j.id === pick.id) : null;
  const selZone = pick?.kind === "zone" ? zones.find((z) => z.id === pick.id) : null;
  const selHouse = pick?.kind === "house" ? s.meters.find((m) => m.id === pick.id) : null;
  const tap = (p: Pick) => (e: { stopPropagation: () => void }) => { e.stopPropagation(); setPick(p); };
  const key = (p: Pick) => (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPick(p); } };

  return (
    <section className="vmap card flat">
      {toast && <div className="toast" role="status">✅ {toast}</div>}
      <svg viewBox="0 0 400 250" role="img" aria-label={t("Village water map")} onClick={() => setPick(null)}>
        <polygon className="ground" points="200,12 392,118 200,236 8,118" />
        <path className="stream" d="M 296,64 C 326,84 352,100 380,112" />
        {zones.map((z) => (
          <g key={`p${z.id}`}>
            <path className={`pipe ${pipeState}`} d={`M ${MAIN[0]},${MAIN[1]} L ${z.at[0]},${z.at[1]}`} />
            <path className={`flow ${pipeState}`} d={`M ${MAIN[0]},${MAIN[1]} L ${z.at[0]},${z.at[1]}`} />
          </g>
        ))}
        <path className={`pipe ${pipeState}`} d={`M ${TANK[0]},${TANK[1] + 18} L ${MAIN[0]},${MAIN[1]}`} />
        <g className="hit" tabIndex={0} role="button" aria-label={t("Water tank and main meter")} onClick={tap({ kind: "tank" })} onKeyDown={key({ kind: "tank" })}>
          <line x1={TANK[0] - 10} y1={TANK[1] + 8} x2={TANK[0] - 12} y2={TANK[1] + 26} className="leg" />
          <line x1={TANK[0] + 10} y1={TANK[1] + 8} x2={TANK[0] + 12} y2={TANK[1] + 26} className="leg" />
          <ellipse cx={TANK[0]} cy={TANK[1] + 8} rx="15" ry="6" className="tank" />
          <rect x={TANK[0] - 15} y={TANK[1] - 12} width="30" height="20" className="tank" />
          <ellipse cx={TANK[0]} cy={TANK[1] - 12} rx="15" ry="6" className="tank-top" />
          <circle cx={MAIN[0]} cy={MAIN[1]} r="6" className={`meter ${s.level}`} />
          <text x={MAIN[0]} y={MAIN[1] + 2.5} className="meter-icon">◉</text>
        </g>
        {zones.map((z) => (
          <g key={`z${z.id}`} className={`hit zone${pick?.kind === "zone" && pick.id === z.id ? " on" : ""}`} tabIndex={0} role="button"
            aria-label={z.name} onClick={tap({ kind: "zone", id: z.id })} onKeyDown={key({ kind: "zone", id: z.id })}>
            <ellipse cx={z.at[0]} cy={z.at[1] + 6} rx="40" ry="20" className="plot" />
            {z.houses.slice(0, 6).map((m, i) => {
              const hx = z.at[0] - 22 + (i % 3) * 22 + (Math.floor(i / 3) % 2) * 11, hy = z.at[1] - 3 + Math.floor(i / 3) * 12;
              return (
                <g key={m.id} onClick={tap({ kind: "house", id: m.id })}>
                  <House x={hx} y={hy} hot={hot.has(m.id)} on={pick?.kind === "house" && pick.id === m.id} />
                </g>
              );
            })}
            <text x={z.at[0]} y={z.at[1] + 36} className="zlabel">{z.name}{z.houses.length > 6 ? ` +${z.houses.length - 6}` : ""}</text>
          </g>
        ))}
        {active.map((j, i) => {
          const [x, y] = zoneAt(j.zone_id);
          const ox = x + 30 + (i % 2) * 14, oy = y - 16 - (i % 3) * 8;
          const leaky = LEAKY.includes(j.kind);
          const e = eta(j.eta, lang);
          return (
            <g key={j.id} className="hit job" tabIndex={0} role="button" aria-label={`${t("Repair")} #${j.id}`}
              onClick={tap({ kind: "job", id: j.id })} onKeyDown={key({ kind: "job", id: j.id })}>
              {leaky && j.status !== "checking" && <circle cx={x + 10} cy={y + 8} r="5" className="leak-pulse" />}
              {leaky && <text x={x + 10} y={y + 11} className="drop">💧</text>}
              {WORKING.includes(j.status) && (
                <g className="worker">
                  <text x={ox} y={oy} className="emoji">👷</text>
                  <text x={ox + 12} y={oy - 4} className="emoji wrench">🔧</text>
                  {e && <g><rect x={ox - 22} y={oy - 32} width="46" height="14" rx="7" className="eta-bg" />
                    <text x={ox + 1} y={oy - 22} className="eta">{e.mins > 0 ? `⏱ ${e.at}` : t("late")}</text></g>}
                </g>
              )}
              {j.status === "checking" && <text x={ox} y={oy} className="emoji">🔍</text>}
              {j.status === "open" && <text x={ox} y={oy} className="emoji wait">❗</text>}
            </g>
          );
        })}
      </svg>
      <div className="vmap-legend small muted">
        <span>💧 {t("Leak")}</span><span>👷 {t("Technician working")}</span><span>🔍 {t("Meter checking the repair")}</span><span>❗ {t("Waiting for a technician")}</span>
      </div>
      {!pick && <p className="small muted center" style={{ margin: "4px 0 0" }}>{t("Tap the tank, a group of houses or a technician.")}</p>}
      {pick?.kind === "tank" && (
        <div className="vmap-panel">
          <h3>🛢️ {t("Water tank and main meter")}</h3>
          <p>{t(s.level === "green" ? "Water system is OK" : s.level === "yellow" ? "Watching a possible problem" : "Leak found – repair team notified")}</p>
          {s.leak?.litres_per_day ? <p>{litres(s.leak.litres_per_day)} {t("lost per day")}</p> : null}
          <Link to={`/story/${s.id}`}>{t("Leak story")} →</Link>
        </div>
      )}
      {selZone && (
        <div className="vmap-panel">
          <h3>🏘️ {selZone.name}</h3>
          <p>{t("{n} houses with a meter", { n: selZone.houses.length })}</p>
          {active.filter((j) => (j.zone_id ?? null) === selZone.id).map((j) => <p key={j.id}><Link to={`/repairs/${j.id}`}>🔧 #{j.id}</Link> <JobStatus s={j.status} /></p>)}
          <Link className="btn small" to="/report">⚠️ {t("Report a problem")}</Link>
        </div>
      )}
      {selHouse && (
        <div className="vmap-panel">
          <h3>🏠 {selHouse.label}</h3>
          <p>{hot.has(selHouse.id) ? t("A house is using much more water than usual – check for leaks inside.") : t("Usage looks normal.")}</p>
        </div>
      )}
      {sel && (
        <div className="vmap-panel">
          <h3>🔧 {t("Repair")} #{sel.id}</h3>
          <p><JobStatus s={sel.status} />{sel.technician ? ` · 👷 ${sel.technician}` : ""}</p>
          {(() => {
            const e = eta(sel.eta, lang);
            return e && WORKING.includes(sel.status) ? <p>{e.mins > 0 ? t("Should be finished by {t} (in about {m} min)", { t: e.at, m: e.mins }) : t("Taking longer than planned")}</p> : null;
          })()}
          {sel.litres_per_day ? <p>{litres(sel.litres_per_day)} {t("lost per day")}{sel.people_per_day ? ` · ${t("water for {p} people", { p: people(sel.people_per_day) })}` : ""}</p> : null}
          <Link to={`/repairs/${sel.id}`}>{t("Open the repair job")} →</Link>
        </div>
      )}
    </section>
  );
}
