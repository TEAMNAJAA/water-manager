import { useT } from "../i18n";
import { day, litres } from "../hooks";

export type VillageStatus = {
  id: number; name: string; level: "green" | "yellow" | "red"; simulated: boolean;
  alerts: { kind: string; level: string; data: any }[];
  leak: { level: string; streak: number; started: string | null; litres_per_day: number | null; learning: boolean } | null;
  devices: { id: string; last_seen: string | null }[];
  meters: { id: number; kind: string; label: string; zone_id: number | null; lat: number | null; lon: number | null; scale: number; n_digits: number }[];
  zones: { id: number; name: string }[];
};

const ICON = { green: "✓", yellow: "!", red: "‼" };

export function StatusCard({ s }: { s: VillageStatus }) {
  const { t, lang } = useT();
  const title = { green: "Water system is OK", yellow: "Watching a possible problem", red: "Leak found – repair team notified" }[s.level];
  const lines: string[] = [];
  const leak = s.alerts.find((a) => a.kind === "leak");
  if (leak) lines.push(t("Night flow high for {n} nights since {d}, about {l} lost per day.", { n: leak.data.nights, d: day(leak.data.started, lang), l: litres(leak.data.litres_per_day) }));
  else if (s.leak?.learning) lines.push(t("Learning the village's normal night flow…"));
  else lines.push(t("Night flow is normal."));
  if (s.alerts.some((a) => a.kind === "clip_silent")) lines.push(t("Main meter camera is offline – the caretaker reads it by phone."));
  if (s.alerts.some((a) => a.kind === "house_high")) lines.push(t("A house is using much more water than usual – check for leaks inside."));
  return (
    <section className={`status ${s.level}`} role="status">
      <div className="dot" aria-hidden>{ICON[s.level]}</div>
      <div>
        <h1>{t(title)}</h1>
        {lines.map((l) => <p key={l} style={{ margin: 0 }}>{l}</p>)}
      </div>
    </section>
  );
}
