import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useT } from "../i18n";

type Msg = { id: number; name: string; role: string; text: string; job_id: number | null; created: string };

const SYSTEM: [RegExp, string][] = [
  [/^(.+) took repair #(\d+)$/, "{1} took repair #{2}"],
  [/^(.+) is fixing repair #(\d+)$/, "{1} is fixing repair #{2}"],
  [/^(.+): repair #(\d+) should be finished by (\S+)$/, "{1}: repair #{2} should be finished by {3}"],
  [/^Repair #(\d+) finished\. NamJai is checking the meter for 2 nights$/, "Repair #{1} finished. NamJai is checking the meter for 2 nights"],
  [/^Repair #(\d+) is done$/, "Repair #{1} is done"],
  [/^Repair #(\d+) was cancelled$/, "Repair #{1} was cancelled"],
  [/^Meter confirms repair #(\d+): about (\d+) L\/day saved$/, "Meter confirms repair #{1}: about {2} L/day saved"],
  [/^Night flow is still high after repair #(\d+)\. The job is open again$/, "Night flow is still high after repair #{1}. The job is open again"],
];

export function VillageChat({ villageId }: { villageId: number }) {
  const { t, lang } = useT();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const last = msgs.at(-1)?.id ?? 0;
  const load = useCallback(async () => {
    try {
      const add = await api<Msg[]>(`/api/villages/${villageId}/comments?after=${last}`);
      if (add.length) setMsgs((m) => [...m, ...add.filter((x) => !m.some((y) => y.id === x.id))].slice(-80));
      setErr(null);
    } catch (e: any) {
      setErr(e.status === 0 ? t("Offline") : e.message);
    }
  }, [villageId, last, t]);
  useEffect(() => {
    load();
    const i = setInterval(load, 15000);
    return () => clearInterval(i);
  }, [load]);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [msgs.length]);

  const show = (m: Msg) => {
    if (m.role !== "system") return m.text;
    for (const [re, tpl] of SYSTEM) {
      const g = m.text.match(re);
      if (!g) continue;
      const parts = g.slice(1).map((x) => (/^\d{4}-\d\d-\d\dT/.test(x) ? new Date(x).toLocaleString(lang === "th" ? "th-TH" : "en-GB", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) : x));
      return t(tpl).replace(/\{(\d)\}/g, (_, n) => parts[Number(n) - 1] ?? "");
    }
    return m.text;
  };
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      const m = await api<Msg>(`/api/villages/${villageId}/comments`, { json: { text: text.trim() } });
      setMsgs((x) => [...x, m]);
      setText("");
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const time = (iso: string) => new Date(iso).toLocaleTimeString(lang === "th" ? "th-TH" : "en-GB", { hour: "2-digit", minute: "2-digit" });

  return (
    <section className="card chat">
      <h2>💬 {t("Village chat")}</h2>
      <div className="chat-log" ref={box} aria-live="polite">
        {!msgs.length && <p className="muted small">{t("No messages yet. Say where water is weak or what you saw.")}</p>}
        {msgs.map((m) => (
          <div key={m.id} className={`msg ${m.role === "system" ? "sys" : ""}`}>
            {m.role !== "system" && <b>{m.name}{m.role !== "resident" ? ` · ${t(m.role[0].toUpperCase() + m.role.slice(1))}` : ""}</b>}
            <span>{m.role === "system" ? "🤖 " : ""}{show(m)}</span>
            <time className="muted">{time(m.created)}</time>
          </div>
        ))}
      </div>
      {err && <p className="small" style={{ color: "var(--critical-ink)" }}>{err}</p>}
      <form className="row" onSubmit={send} style={{ gap: 8, marginTop: 8 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder={t("Write to the village…")} aria-label={t("Message")} style={{ flex: 1 }} />
        <button className="btn primary" disabled={!text.trim()}>{t("Send")}</button>
      </form>
    </section>
  );
}
