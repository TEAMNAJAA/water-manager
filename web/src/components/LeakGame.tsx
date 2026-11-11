import { useMemo, useRef, useState } from "react";
import { useT } from "../i18n";

const SOIS = ["Soi 1", "Soi 2", "Soi 3", "Soi 4"];
const LEAK = 600;
const BACKGROUND = 30;

function setup() {
  return { leak: Math.floor(Math.random() * SOIS.length), use: SOIS.map(() => 15 + Math.round(Math.random() * 35)) };
}

export function LeakGame() {
  const { t } = useT();
  const [game, setGame] = useState(setup);
  const [closed, setClosed] = useState<number | null>(null);
  const [waiting, setWaiting] = useState<number | null>(null);
  const [log, setLog] = useState<{ soi: number; drop: number }[]>([]);
  const started = useRef<number | null>(null);
  const [found, setFound] = useState<number | null>(null);
  const flowOf = (c: number | null) => BACKGROUND + game.use.reduce((s, u, i) => s + (i === c ? 0 : u), 0) + (game.leak === c ? 0 : LEAK);
  const full = useMemo(() => flowOf(null), [game]);
  const now = flowOf(closed);
  const tap = (i: number) => {
    if (waiting !== null || found !== null) return;
    if (closed === i) {
      setClosed(null);
      return;
    }
    started.current ??= Date.now();
    setClosed(null);
    setWaiting(i);
    setTimeout(() => {
      setWaiting(null);
      setClosed(i);
      const drop = full - flowOf(i);
      setLog((l) => [...l.filter((x) => x.soi !== i), { soi: i, drop }]);
      if (i === game.leak) setFound((Date.now() - (started.current ?? Date.now())) / 1000);
    }, 1200);
  };
  const again = () => {
    setGame(setup());
    setClosed(null);
    setLog([]);
    started.current = null;
    setFound(null);
  };
  const x = (i: number) => 70 + i * 80;
  const lpd = LEAK * 24;
  return (
    <div className="stack">
      <p>{t("It is 3 a.m. Almost no one uses water, yet the main meter shows {f} L/h. Close one soi's valve at a time to find where the water goes.", { f: full })}</p>
      <div className="row between">
        <div>
          <div className="small muted">{t("Main meter now")}</div>
          <div style={{ fontSize: "2rem", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{waiting !== null ? "…" : `${now} L/h`}</div>
        </div>
        <div style={{ flex: 1, maxWidth: 260, height: 14, background: "var(--surface-2)", borderRadius: 4 }} aria-hidden>
          <div style={{ width: `${(now / full) * 100}%`, height: "100%", background: "var(--series-1)", borderRadius: 4, transition: "width .6s" }} />
        </div>
      </div>
      <svg viewBox="0 0 380 230" className="chart" role="img" aria-label={t("Village pipe map")}>
        <rect x="6" y="22" width="34" height="36" rx="6" fill="var(--surface-2)" stroke="var(--text-2)" />
        <text x="23" y="45" textAnchor="middle" style={{ fontSize: 11, fill: "var(--text-2)" }}>M</text>
        <line x1="40" y1="40" x2="360" y2="40" stroke="var(--series-1)" strokeWidth="6" strokeLinecap="round" />
        {SOIS.map((name, i) => {
          const isClosed = closed === i;
          const isLeak = found !== null && i === game.leak;
          return (
            <g key={name}>
              <line x1={x(i)} y1="40" x2={x(i)} y2="205" stroke={isClosed ? "var(--line)" : "var(--series-1)"} strokeWidth="4" />
              {[0, 1, 2].map((k) => <rect key={k} x={x(i) + 8} y={110 + k * 32} width="18" height="16" rx="3" fill="var(--surface-2)" stroke="var(--text-2)" />)}
              {isLeak && <text x={x(i) - 18} y="170" style={{ fontSize: 22 }}>💧</text>}
              <text x={x(i)} y="225" textAnchor="middle" style={{ fontSize: 12, fill: "var(--text-2)" }}>{name}</text>
            </g>
          );
        })}
      </svg>
      <div className="grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
        {SOIS.map((name, i) => (
          <button key={name} className={`btn small ${closed === i ? "primary" : ""}`} aria-pressed={closed === i} disabled={found !== null && i !== game.leak}
            onClick={() => tap(i)} aria-label={`${closed === i ? t("Open") : t("Close")} ${name}`}>
            {waiting === i ? "⏳" : closed === i ? "🔒" : "🔧"} {name}
          </button>
        ))}
      </div>
      {waiting !== null && <p className="small muted center">{t("Valve closed. Waiting 15 minutes for the meter…")}</p>}
      {log.length > 0 && (
        <table>
          <thead><tr><th>{t("Valve closed")}</th><th className="num">{t("Flow drop")}</th></tr></thead>
          <tbody>{log.map((r) => <tr key={r.soi}><td>{SOIS[r.soi]}{r.soi === game.leak && found !== null ? " ⚠️" : ""}</td><td className="num">{r.drop} L/h</td></tr>)}</tbody>
        </table>
      )}
      {found !== null && (
        <div className="notice critical stack">
          <b style={{ display: "block" }}>{t("Found it in {s} seconds: the leak is in {soi}.", { s: Math.max(1, Math.round(found)), soi: SOIS[game.leak] })}</b>
          <span style={{ display: "block" }}>{t("NamJai would open a repair job: about {l} L a day, the daily water of {p} people. After the repair, the meter confirms it.", { l: lpd.toLocaleString(), p: Math.round(lpd / 50) })}</span>
          <button className="btn block" onClick={again}>🔁 {t("Play again")}</button>
        </div>
      )}
      <p className="small muted">{t("Simulated village. In a real village the caretaker does the same with the real valves at night.")}</p>
    </div>
  );
}
