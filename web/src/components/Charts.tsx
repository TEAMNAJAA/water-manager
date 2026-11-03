import { useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n";

const W = 480;
const H = 220;
const M = { l: 40, r: 8, t: 16, b: 28 };

function ticks(max: number) {
  const step = Math.pow(10, Math.floor(Math.log10(max || 1)));
  const s = [1, 2, 5, 10].map((k) => k * step).find((v) => max / v <= 4) ?? step * 10;
  return Array.from({ length: Math.floor(max / s) + 1 }, (_, i) => +(i * s).toFixed(6));
}

function Frame({ max, unit, children, xLabels, tip, onMove, onLeave }: {
  max: number; unit: string; children: ReactNode; xLabels: { x: number; text: string }[]; tip: ReactNode;
  onMove: (fx: number, px: number) => void; onLeave: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const y = (v: number) => M.t + (H - M.t - M.b) * (1 - v / max);
  return (
    <div ref={ref} style={{ position: "relative" }} onPointerLeave={onLeave}
      onPointerMove={(e) => {
        const r = ref.current!.getBoundingClientRect();
        const sx = ((e.clientX - r.left) / r.width) * W;
        onMove((sx - M.l) / (W - M.l - M.r), e.clientX - r.left);
      }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img">
        <g className="grid">
          {ticks(max).map((v) => (
            <g key={v}>
              <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} />
              <text x={M.l - 6} y={y(v) + 4} textAnchor="end">{v}</text>
            </g>
          ))}
        </g>
        <text x={4} y={M.t + 4}>{unit}</text>
        {xLabels.map((l) => <text key={l.x} x={l.x} y={H - 8} textAnchor="middle">{l.text}</text>)}
        {children}
      </svg>
      {tip}
    </div>
  );
}

function Tip({ x, children }: { x: number | null; children: ReactNode }) {
  if (x == null) return null;
  return <div className="tooltip" style={{ left: Math.max(0, x - 70), top: 0 }}>{children}</div>;
}

function TableToggle({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn small" style={{ marginTop: 8 }} onClick={() => setOpen(!open)}>{open ? t("Hide table") : t("Show table")}</button>
      {open && (
        <div style={{ maxHeight: 260, overflow: "auto", marginTop: 8 }}>
          <table>
            <thead><tr>{head.map((h, i) => <th key={h} className={i ? "num" : ""}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j ? "num" : ""}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function HourlyChart({ points, lang }: { points: { hour: string; flow: number | null }[]; lang: string }) {
  const [hover, setHover] = useState<{ i: number; px: number } | null>(null);
  const vals = points.map((p) => p.flow ?? 0);
  const max = Math.max(0.5, ...vals) * 1.1;
  const n = points.length;
  const x = (i: number) => M.l + ((W - M.l - M.r) * i) / Math.max(1, n - 1);
  const y = (v: number) => M.t + (H - M.t - M.b) * (1 - v / max);
  const segs: string[] = [];
  let cur = "";
  points.forEach((p, i) => {
    if (p.flow == null) {
      if (cur) segs.push(cur);
      cur = "";
    } else cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(p.flow).toFixed(1)}`;
  });
  if (cur) segs.push(cur);
  const fmt = (iso: string, withTime = false) => new Date(iso).toLocaleString(lang === "th" ? "th-TH" : "en-GB", withTime ? { weekday: "short", hour: "2-digit", minute: "2-digit" } : { weekday: "short", day: "numeric" });
  const labels = points.map((p, i) => ({ p, i })).filter(({ p }) => new Date(p.hour).getHours() === 0).map(({ p, i }) => ({ x: x(i), text: fmt(p.hour) }));
  const h = hover && points[hover.i];
  return (
    <>
      <Frame max={max} unit="m³/h" xLabels={labels} onLeave={() => setHover(null)}
        onMove={(fx, px) => setHover({ i: Math.min(n - 1, Math.max(0, Math.round(fx * (n - 1)))), px })}
        tip={<Tip x={hover?.px ?? null}>{h && <><b>{h.flow == null ? "–" : `${h.flow} m³/h`}</b><br />{fmt(h.hour, true)}</>}</Tip>}>
        {segs.map((d, i) => <path key={i} d={d} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" />)}
        {hover && <line x1={x(hover.i)} x2={x(hover.i)} y1={M.t} y2={H - M.b} stroke="var(--muted)" strokeDasharray="3 3" />}
        {h && h.flow != null && <circle cx={x(hover!.i)} cy={y(h.flow)} r={5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />}
      </Frame>
      <TableToggle head={["hour", "m³/h"]} rows={points.slice().reverse().map((p) => [fmt(p.hour, true), p.flow ?? "–"])} />
    </>
  );
}

export function NightChart({ nights, baseline, lang }: { nights: { night_of: string; flow: number | null; high: boolean; baseline: number | null }[]; baseline: number | null; lang: string }) {
  const { t } = useT();
  const [hover, setHover] = useState<{ i: number; px: number } | null>(null);
  const n = nights.length;
  const max = Math.max(0.3, ...nights.map((d) => d.flow ?? 0), baseline ?? 0) * 1.15;
  const bw = (W - M.l - M.r) / Math.max(1, n);
  const x = (i: number) => M.l + bw * i;
  const y = (v: number) => M.t + (H - M.t - M.b) * (1 - v / max);
  const fmt = (d: string) => new Date(d + "T12:00:00").toLocaleDateString(lang === "th" ? "th-TH" : "en-GB", { day: "numeric", month: "short" });
  const labels = nights.map((d, i) => ({ d, i })).filter(({ i }) => i % Math.ceil(n / 6) === 0).map(({ d, i }) => ({ x: x(i) + bw / 2, text: fmt(d.night_of) }));
  const h = hover && nights[hover.i];
  return (
    <>
      <div className="legend" style={{ marginBottom: 6 }}>
        <span><i style={{ background: "var(--series-1)", height: 10 }} />{t("Night flow (01:00–05:00)")}</span>
        <span><i style={{ background: "var(--critical)", height: 10 }} />⚠ {t("high night")}</span>
        <span><i style={{ background: "var(--text-2)", height: 2 }} />{t("usual night flow")}</span>
      </div>
      <Frame max={max} unit="m³/h" xLabels={labels} onLeave={() => setHover(null)}
        onMove={(fx, px) => setHover({ i: Math.min(n - 1, Math.max(0, Math.floor(fx * n))), px })}
        tip={<Tip x={hover?.px ?? null}>{h && <><b>{h.flow ?? "–"} m³/h</b>{h.high ? " ⚠" : ""}<br />{fmt(h.night_of)}{h.baseline != null ? ` · ${t("usual night flow")} ${h.baseline}` : ""}</>}</Tip>}>
        {nights.map((d, i) => d.flow != null && (
          <rect key={d.night_of} x={x(i) + 1} y={y(d.flow)} width={Math.max(2, bw - 2)} height={Math.max(0, y(0) - y(d.flow))} rx={Math.min(4, bw / 3)}
            fill={d.high ? "var(--critical)" : "var(--series-1)"} opacity={hover && hover.i !== i ? 0.6 : 1} />
        ))}
        {nights.map((d, i) => d.high && d.flow != null && <text key={`w${i}`} x={x(i) + bw / 2} y={y(d.flow) - 4} textAnchor="middle" style={{ fill: "var(--critical-ink)", fontWeight: 700 }}>⚠</text>)}
        {baseline != null && <line x1={M.l} x2={W - M.r} y1={y(baseline)} y2={y(baseline)} stroke="var(--text-2)" strokeWidth={2} strokeDasharray="6 4" />}
      </Frame>
      <TableToggle head={["night", "m³/h", "usual", "high"]} rows={nights.slice().reverse().map((d) => [fmt(d.night_of), d.flow ?? "–", d.baseline ?? "–", d.high ? "⚠ yes" : ""])} />
    </>
  );
}

export function HBars({ rows, unit }: { rows: { label: string; value: number }[]; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="stack">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="row between small"><span>{r.label}</span><b>{r.value.toLocaleString()} {unit}</b></div>
          <div style={{ height: 10, background: "var(--surface-2)", borderRadius: 4 }}>
            <div style={{ width: `${(r.value / max) * 100}%`, height: "100%", background: "var(--series-1)", borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
