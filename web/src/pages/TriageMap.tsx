import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { StepTest } from "../components/FieldTools";
import type { VillageStatus } from "../components/Status";
import { VillageChat } from "../components/VillageChat";
import type { WJob, WVillage } from "../components/World3D";
import { litres, money, people, useApi } from "../hooks";
import { useT } from "../i18n";
import { JobStatus } from "./Repairs";
import { KINDS } from "./Report";

const World3D = lazy(() => import("../components/World3D"));
type Triage = { villages: WVillage[]; litres_saved_per_day: number; litres_lost_per_day: number };
type Tab = "status" | "repair" | "fund" | "chat";
const LEAKY = ["leak_detected", "burst_detected", "leak", "wet_ground"];
const AGENCY_KINDS = ["government", "local", "volunteer", "foundation", "technician", "other"];
const WEBGL = (() => {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
})();

function useClock(lang: string) {
  return useCallback((iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    const today = d.toDateString() === new Date().toDateString();
    return d.toLocaleString(lang === "th" ? "th-TH" : "en-GB", today ? { hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
  }, [lang]);
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal card" role="dialog" aria-modal aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row between"><h2 style={{ margin: 0 }}>{title}</h2><button className="btn small" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>
  );
}

export default function TriageMap() {
  const { t, lang, setLang } = useT();
  const { me, login } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data, error, reload } = useApi<Triage>("/api/triage");
  const [night, setNight] = useState(false);
  const [filter, setFilter] = useState<"all" | "red" | "yellow" | "green">("all");
  const [tab, setTab] = useState<Tab>("status");
  const [modal, setModal] = useState<"add" | "agency" | "sms" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const clock = useClock(lang);
  const selected = params.get("v") ? Number(params.get("v")) : null;
  const select = useCallback((id: number | null) => {
    setParams(id == null ? { all: "1" } : { v: String(id) }, { replace: true });
  }, [setParams]);

  useEffect(() => {
    const i = setInterval(reload, 20000);
    return () => clearInterval(i);
  }, [reload]);
  useEffect(() => {
    if (selected == null && me?.village_id && data && !params.has("all")) select(me.village_id);
  }, [me?.village_id, data == null]);

  const villages = data?.villages ?? [];
  const sel = villages.find((v) => v.id === selected) ?? null;
  const etaText = useCallback((j: WJob) => clock(j.eta), [clock]);

  useEffect(() => {
    if (!data) return;
    let before: Record<string, string> = {};
    try { before = JSON.parse(localStorage.getItem("namjai.working") ?? "{}"); } catch { /* storage off */ }
    const now: Record<string, string> = {};
    const msgs: string[] = [];
    for (const v of data.villages) {
      for (const j of v.jobs) if (["assigned", "fixing"].includes(j.status)) now[j.id] = v.name;
      for (const j of [...v.jobs, ...v.recent_done])
        if (before[j.id] && !now[j.id] && ["checking", "done"].includes(j.status)) msgs.push(t("Repair #{id} in {v} is finished. The technician has left.", { id: j.id, v: v.name }));
    }
    try { localStorage.setItem("namjai.working", JSON.stringify(now)); } catch { /* storage off */ }
    if (!msgs.length) return;
    setToast(msgs.join(" "));
    const h = setTimeout(() => setToast(null), 9000);
    return () => clearTimeout(h);
  }, [data, t]);

  const shown = villages.filter((v) => filter === "all" || v.level === filter);
  const count = (l: string) => villages.filter((v) => v.level === l).length;

  return (
    <div className={`triage ${night ? "night" : ""}`}>
      <header className="tbar">
        <Link to="/" className="brand" onClick={() => select(null)}>💧 NamJai</Link>
        <div className="tstats small">
          {data && <span title={t("Water lost to leaks now")}>🔴 {litres(data.litres_lost_per_day)}/{t("day")}</span>}
          {data && <span title={t("Saved by confirmed repairs")}>✅ {litres(data.litres_saved_per_day)}/{t("day")}</span>}
        </div>
        <nav className="tbtns">
          <button className="tb urgent" disabled={!villages.length} onClick={() => { select(villages[0]?.id ?? null); setTab("status"); }}>🚨 {t("Help first")} #1</button>
          <button className="tb" onClick={() => setModal("add")}>➕ {t("Add village")}</button>
          <button className="tb" onClick={() => setModal("agency")}>🏢 {t("Agencies")}</button>
          <button className={`tb ${night ? "on" : ""}`} onClick={() => setNight((n) => !n)} aria-pressed={night}>{night ? "☀️" : "🌙"} {t("2 AM leak scan")}</button>
          <button className="tb" onClick={() => setModal("sms")}>📱 SMS</button>
          <button className="tb" onClick={() => setLang(lang === "en" ? "th" : "en")}>{lang === "en" ? "ไทย" : "EN"}</button>
          <button className="tb me" onClick={() => nav(me ? "/me" : "/login")}>👤 {me ? me.name.split(" ")[0] : t("Log in")}</button>
        </nav>
      </header>

      <div className="tbody">
        <aside className="tlist" aria-label={t("Villages by urgency")}>
          <h2>{t("Where to help first")}</h2>
          <div className="filters">
            {(["all", "red", "yellow", "green"] as const).map((f) => (
              <button key={f} className={`fchip ${f} ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>
                {{ all: t("All"), red: "🔴", yellow: "🟡", green: "🟢" }[f]} {f === "all" ? villages.length : count(f)}
              </button>
            ))}
          </div>
          {error && <p className="notice critical small">{error}</p>}
          {!data && !error && <p className="muted">{t("Loading…")}</p>}
          <ol className="vlist">
            {shown.map((v) => (
              <li key={v.id}>
                <button className={`vrow ${v.level} ${v.id === selected ? "on" : ""}`} onClick={() => select(v.id)}>
                  <span className="rank">#{v.rank}</span>
                  <span className="grow">
                    <b>{v.name}</b>
                    <span className="small muted">{headline(v, t)}</span>
                  </span>
                  {v.jobs.some((j) => ["assigned", "fixing"].includes(j.status)) && <span aria-label={t("Technician working")}>👷</span>}
                  {v.simulated && <span className="sim-dot" title={t("Simulated data")}>S</span>}
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <section className="tworld">
          {toast && <div className="toast big" role="status">✅ {toast}</div>}
          {WEBGL ? (
            <Suspense fallback={<div className="w3d loading">{t("Loading 3D map…")}</div>}>
              <World3D villages={villages} selected={selected} night={night} onSelect={select} etaText={etaText} label={t("3D map of villages")} />
            </Suspense>
          ) : <div className="w3d loading">{t("This device cannot show 3D. Use the list.")}</div>}
          <div className="whint small">{t("Drag to turn · pinch or scroll to zoom · tap a village")}</div>
          {night && <div className="nightnote small">🌙 {t("01:00–05:00: almost nobody uses water, so flow that stays high means a leak. Glowing red rings are villages losing water now.")}</div>}
        </section>

        <aside className={`tpanel ${sel ? "open" : ""}`} aria-label={t("Village details")}>
          {sel ? <Panel v={sel} tab={tab} setTab={setTab} onClose={() => select(null)} reload={reload} clock={clock} />
            : <Overview data={data} onPick={select} />}
        </aside>
      </div>

      {modal === "add" && <Modal title={`➕ ${t("Add your village")}`} onClose={() => setModal(null)}>
        <AddVillage onDone={async (id, token) => { await login(token); await reload(); setModal(null); select(id); }} />
      </Modal>}
      {modal === "agency" && <Modal title={`🏢 ${t("Agencies")}`} onClose={() => setModal(null)}>
        <AgencyForm villages={villages} initial={selected} onDone={reload} />
        <AgencyList villages={villages} />
      </Modal>}
      {modal === "sms" && <Modal title={`📱 ${t("Keypad phone (simulated)")}`} onClose={() => setModal(null)}><Phone /></Modal>}
    </div>
  );
}

function headline(v: WVillage, t: ReturnType<typeof useT>["t"]) {
  if (v.alerts.includes("burst")) return t("Possible burst");
  if (v.litres_lost_per_day) return t("Leak: {l} lost per day", { l: litres(v.litres_lost_per_day) });
  if (v.alerts.includes("no_flow")) return t("No water flowing");
  const open = v.jobs.filter((j) => j.status === "open").length;
  if (open) return t("{n} problems waiting for a technician", { n: open });
  if (v.jobs.length) return t("{n} repairs in progress", { n: v.jobs.length });
  if (v.alerts.includes("clip_silent")) return t("Meter camera offline");
  return t("Water system is OK");
}

function Overview({ data, onPick }: { data: Triage | null; onPick: (id: number) => void }) {
  const { t } = useT();
  if (!data) return null;
  const vs = data.villages;
  const workers = vs.reduce((n, v) => n + v.jobs.filter((j) => ["assigned", "fixing"].includes(j.status)).length, 0);
  return (
    <div className="pbody">
      <h2>{t("All villages")}</h2>
      <div className="nums">
        <div><b>{vs.filter((v) => v.level === "red").length}</b><span>{t("need help now")}</span></div>
        <div><b>{workers}</b><span>{t("technicians working")}</span></div>
        <div><b>{litres(data.litres_lost_per_day)}</b><span>{t("lost per day")}</span></div>
        <div><b>{litres(data.litres_saved_per_day)}</b><span>{t("saved per day")}</span></div>
      </div>
      <p className="muted">{t("NamJai ranks villages by water lost, people affected and problems waiting. Tap a village on the map or in the list.")}</p>
      {vs[0] && <button className="btn danger block" onClick={() => onPick(vs[0].id)}>🚨 {t("Open the most urgent village")}: {vs[0].name}</button>}
    </div>
  );
}

function Panel({ v, tab, setTab, onClose, reload, clock }: { v: WVillage; tab: Tab; setTab: (t: Tab) => void; onClose: () => void; reload: () => void; clock: (s: string | null) => string | null }) {
  const { t } = useT();
  const tabs: [Tab, string][] = [["status", `🔍 ${t("Status")}`], ["repair", `👷 ${t("Repair / valves")}`], ["fund", `💰 ${t("Fund")}`], ["chat", `💬 ${t("Chat")}`]];
  return (
    <>
      <div className={`phead ${v.level}`}>
        <div>
          <div className="small">#{v.rank} · {{ red: t("Urgent"), yellow: t("Watch"), green: t("OK") }[v.level]}{v.simulated ? ` · ${t("Simulated data")}` : ""}</div>
          <h2>{v.name}</h2>
        </div>
        <button className="btn small" onClick={onClose} aria-label={t("Close")}>✕</button>
      </div>
      <div className="ptabs" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div className="pbody">
        {tab === "status" && <StatusTab v={v} clock={clock} />}
        {tab === "repair" && <RepairTab v={v} reload={reload} clock={clock} />}
        {tab === "fund" && <FundTab v={v} reload={reload} />}
        {tab === "chat" && <ChatTab v={v} />}
      </div>
    </>
  );
}

function StatusTab({ v, clock }: { v: WVillage; clock: (s: string | null) => string | null }) {
  const { t } = useT();
  const kind = (k: string) => t(KINDS[k]?.label ?? k);
  const broke: string[] = [];
  if (v.alerts.includes("burst")) broke.push(t("Possible burst: about {l} lost per hour.", { l: litres(v.burst_litres_per_hour) }));
  if (v.litres_lost_per_day) broke.push(t("Night flow high for {n} nights: about {l} lost per day, the daily water of {p} people.", { n: v.nights ?? "–", l: litres(v.litres_lost_per_day), p: people(v.people_lost) }));
  if (v.alerts.includes("no_flow")) broke.push(t("No water flowing at a time it usually does. Check the pump and tank."));
  if (v.alerts.includes("house_high")) broke.push(t("A house is using much more water than usual – check for leaks inside."));
  if (v.alerts.includes("clip_silent")) broke.push(t("Main meter camera is offline – the caretaker reads it by phone."));
  for (const j of v.jobs.filter((j) => j.kind !== "leak_detected" && j.kind !== "burst_detected")) broke.push(`${KINDS[j.kind]?.icon ?? "🔧"} ${kind(j.kind)} #${j.id}${j.note ? `: ${j.note}` : ""}`);

  const fix: string[] = [];
  for (const j of v.jobs) {
    if (j.status === "open") fix.push(t("#{id} {k}: needs a technician", { id: j.id, k: kind(j.kind) }));
    else if (["assigned", "fixing"].includes(j.status)) fix.push(t("#{id} {k}: 👷 {who} fixing", { id: j.id, k: kind(j.kind), who: j.technician ?? "" }) + (j.eta ? ` · ⏱ ${clock(j.eta)}` : ""));
    else if (j.status === "checking") fix.push(t("#{id}: repaired, the meter checks 2 nights", { id: j.id }));
  }
  if (v.litres_lost_per_day && !v.jobs.some((j) => ["assigned", "fixing", "checking"].includes(j.status))) fix.push(t("Find the leak: step test at night, close one valve at a time."));
  if (!v.agencies.length) fix.push(t("No agency linked yet. Local office or volunteers can register to help."));
  if (v.repair_fund < 1000) fix.push(t("Repair fund is low ({m}). Parts or budget help is needed.", { m: money(v.repair_fund) }));

  const good: string[] = [];
  if (v.has_main_meter && !v.alerts.includes("clip_silent")) good.push(t("Main meter watched every night"));
  if (!v.litres_lost_per_day && !v.alerts.includes("burst")) good.push(t("Night flow is normal."));
  if (v.litres_saved_per_day) good.push(t("Confirmed repairs save {l} per day – water for {p} people.", { l: litres(v.litres_saved_per_day), p: people(v.people_saved) }));
  for (const j of v.recent_done) good.push(t("Repair #{id} done", { id: j.id }) + (j.proof?.state === "confirmed" ? ` · ✓ ${t("confirmed by the meter")}` : ""));
  if (v.agencies.length) good.push(t("{n} agencies support this village", { n: v.agencies.length }));
  if (v.repair_fund >= 1000) good.push(t("Repair fund: {m}", { m: money(v.repair_fund) }));

  return (
    <>
      <div className="nums">
        <div><b>{litres(v.litres_lost_per_day ?? 0)}</b><span>{t("lost per day")}</span></div>
        <div><b>{people(v.people_lost ?? 0)}</b><span>{t("people's water")}</span></div>
        <div><b>{v.households || "–"}</b><span>{t("households")}</span></div>
        <div><b>{v.jobs.length}</b><span>{t("open repairs")}</span></div>
      </div>
      <Card cls="broke" title={`🔴 ${t("What broke")}`} items={broke} empty={t("Nothing broken right now.")} />
      <Card cls="fix" title={`🛠️ ${t("What has to be fixed")}`} items={fix} empty={t("Nothing to fix.")} />
      <Card cls="good" title={`🟢 ${t("What is good")}`} items={good} empty="–" />
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Link className="btn small" to={`/story/${v.id}`}>🎬 {t("Leak story")}</Link>
        <Link className="btn small" to={`/dashboard/${v.id}`}>📊 {t("Dashboard")}</Link>
      </div>
    </>
  );
}

function Card({ cls, title, items, empty }: { cls: string; title: string; items: string[]; empty: string }) {
  return (
    <section className={`bfg ${cls}`}>
      <h3>{title}</h3>
      {items.length ? <ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="muted small">{empty}</p>}
    </section>
  );
}

function RepairTab({ v, reload, clock }: { v: WVillage; reload: () => void; clock: (s: string | null) => string | null }) {
  const { t } = useT();
  const { me, staff } = useAuth();
  const canWork = !!me && (me.role === "admin" || (staff && me.village_id === v.id) || (me.role === "technician" && (me.network_id === v.network_id || me.village_id === v.id)));
  const isStaff = !!me && staff && (me.village_id === v.id || me.role === "admin");
  const { data: status } = useApi<VillageStatus>(isStaff ? `/api/villages/${v.id}/status` : null, [v.id, isStaff]);
  return (
    <>
      {!v.jobs.length && <p className="muted">{t("No open repairs.")}</p>}
      {v.jobs.map((j) => <JobCard key={j.id} j={j} canWork={canWork} isTech={me?.role === "technician"} reload={reload} clock={clock} />)}
      <Link className="btn danger block" to={me ? "/report" : "/login"}>⚠️ {t("Report a problem")}</Link>
      {!canWork && <p className="small muted">{t("Technicians and caretakers log in to take a job, set the finish time and write problems on site.")}</p>}
      <h3 style={{ marginTop: 16 }}>🧭 {t("Step test: find the leaking pipe")}</h3>
      {isStaff && status ? <StepTest s={status} /> : <p className="small muted">{t("At night the caretaker closes one zone valve at a time. When the main meter drops, the leak is in that zone. Caretakers start it here after logging in.")}</p>}
      {v.zones.length > 0 && <p className="small">{t("Zones")}: {v.zones.map((z) => z.name).join(" · ")}</p>}
    </>
  );
}

function JobCard({ j, canWork, isTech, reload, clock }: { j: WJob; canWork: boolean; isTech: boolean; reload: () => void; clock: (s: string | null) => string | null }) {
  const { t } = useT();
  const [eta, setEta] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const patch = async (body: object) => {
    setBusy(true);
    setErr("");
    try {
      await api(`/api/repairs/${j.id}`, { method: "PATCH", json: body });
      setEta("");
      setProblem("");
      reload();
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  };
  const working = ["assigned", "fixing"].includes(j.status);
  return (
    <div className={`job ${j.status}`}>
      <div className="row between">
        <b>{KINDS[j.kind]?.icon ?? "🔧"} {t(KINDS[j.kind]?.label ?? j.kind)} #{j.id}</b>
        <JobStatus s={j.status} />
      </div>
      {j.note && <p className="small">{j.note}</p>}
      {j.litres_per_day ? <p className="small">{litres(j.litres_per_day)} {t("lost per day")}{j.people_per_day ? ` · ${t("water for {p} people", { p: people(j.people_per_day) })}` : ""}</p> : null}
      {j.technician && <p className="small">👷 {j.technician}{j.eta && working ? ` · ⏱ ${t("finish by")} ${clock(j.eta)}` : ""}</p>}
      {j.problems.length > 0 && (
        <ul className="probs small">{j.problems.map((p, i) => <li key={i}>⚠️ <b>{p.by}</b> {clock(p.at)}: {p.text}</li>)}</ul>
      )}
      {j.status === "checking" && <p className="small">🔍 {t("The meter is checking the repair for 2 nights.")}</p>}
      {canWork && j.status !== "checking" && (
        <div className="jact">
          {j.status === "open" && <button className="btn primary small" disabled={busy} onClick={() => patch({ status: isTech ? "assigned" : "fixing" })}>👷 {isTech ? t("Take this job") : t("Start fixing")}</button>}
          {j.status === "assigned" && <button className="btn small" disabled={busy} onClick={() => patch({ status: "fixing" })}>🔧 {t("Start fixing")}</button>}
          <label className="small">{t("When will it be finished?")}
            <span className="row" style={{ gap: 6 }}>
              <input type="datetime-local" value={eta} onChange={(e) => setEta(e.target.value)} style={{ flex: 1 }} />
              <button className="btn small" disabled={!eta || busy} onClick={() => patch({ eta: new Date(eta).toISOString(), ...(j.status === "open" ? { status: "fixing" } : {}) })}>{t("Save")}</button>
            </span>
          </label>
          <label className="small">{t("Problem on site (everyone can see it)")}
            <span className="row" style={{ gap: 6 }}>
              <input value={problem} maxLength={300} onChange={(e) => setProblem(e.target.value)} placeholder={t("e.g. pipe under the road, waiting for a part")} style={{ flex: 1 }} />
              <button className="btn small" disabled={!problem.trim() || busy} onClick={() => patch({ problem })}>{t("Send")}</button>
            </span>
          </label>
          {working && <button className="btn good small" disabled={busy} onClick={() => patch({ status: "done", verified: LEAKY.includes(j.kind) })}>✅ {t("Mark repaired")}</button>}
          <Link className="small" to={`/repairs/${j.id}`}>{t("Open the repair job")} →</Link>
          {err && <p className="small" style={{ color: "var(--critical-ink)" }}>{err}</p>}
        </div>
      )}
    </div>
  );
}

type Funds = { wallets: Record<string, number>; entries: { id: number; wallet: string; amount: number; kind: string; note: string | null; created: string }[] };

function FundTab({ v, reload }: { v: WVillage; reload: () => void }) {
  const { t } = useT();
  const { data } = useApi<Funds>(`/api/villages/${v.id}/funds`, [v.id]);
  const names: Record<string, string> = { repair: t("Repair fund"), network: t("District network fund"), rewards: t("Rewards"), namjai: t("Namjai fund") };
  const top = Math.max(1, ...Object.values(data?.wallets ?? {}));
  return (
    <>
      {data ? Object.entries(data.wallets).map(([w, n]) => (
        <div key={w} className="wallet">
          <div className="row between small"><span>{names[w] ?? w}</span><b>{money(n)}</b></div>
          <div className="bar"><i style={{ width: `${Math.max(2, (n / top) * 100)}%` }} /></div>
        </div>
      )) : <p className="muted">{t("Loading…")}</p>}
      {data && data.entries.length > 0 && (
        <>
          <h3>{t("Latest spending and income")}</h3>
          <ul className="flat small">{data.entries.slice(0, 5).map((e) => <li key={e.id} className="row between"><span>{e.note ?? e.kind}</span><b>{money(e.amount)}</b></li>)}</ul>
        </>
      )}
      <Link className="btn small" to="/funds">{t("All fund records")} →</Link>
      <h3 style={{ marginTop: 16 }}>🏢 {t("Agencies that help")}</h3>
      {v.agencies.length ? (
        <ul className="flat">{v.agencies.map((a, i) => (
          <li key={i}><b>{a.name}</b> <span className="small muted">{a.kind ? t(cap(a.kind)) : ""}{a.verified === false ? ` · ${t("not verified yet")}` : ""}</span>
            {a.helps_with && <div className="small">{a.helps_with}</div>}
            {(a.phone || a.email) && <div className="small muted">{a.phone} {a.email}</div>}</li>
        ))}</ul>
      ) : <p className="muted small">{t("No agency yet.")}</p>}
      <details><summary className="btn small">+ {t("Register an agency")}</summary><AgencyForm villages={[v]} initial={v.id} onDone={reload} /></details>
    </>
  );
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function AgencyForm({ villages, initial, onDone }: { villages: WVillage[]; initial: number | null; onDone: () => void }) {
  const { t } = useT();
  const [vid, setVid] = useState<number | "">(initial ?? villages[0]?.id ?? "");
  const [f, setF] = useState({ name: "", kind: "local", phone: "", email: "", helps_with: "" });
  const [msg, setMsg] = useState("");
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const body = Object.fromEntries(Object.entries(f).filter(([, x]) => x.trim()));
      await api(`/api/villages/${vid}/agencies`, { json: body });
      setMsg(t("Saved. The village caretaker will verify it."));
      setF({ name: "", kind: "local", phone: "", email: "", helps_with: "" });
      onDone();
    } catch (er: any) {
      setMsg(er.message);
    }
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="stack" onSubmit={send} style={{ marginTop: 8 }}>
      {villages.length > 1 && <label>{t("Village")}<select value={vid} onChange={(e) => setVid(Number(e.target.value))}>{villages.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>}
      <label>{t("Agency name")}<input required minLength={2} value={f.name} onChange={set("name")} /></label>
      <label>{t("Type")}<select value={f.kind} onChange={set("kind")}>{AGENCY_KINDS.map((k) => <option key={k} value={k}>{t(cap(k))}</option>)}</select></label>
      <label>{t("How you can help")}<input value={f.helps_with} onChange={set("helps_with")} placeholder={t("e.g. pipes and parts, budget, volunteers")} /></label>
      <div className="row" style={{ gap: 8 }}>
        <label style={{ flex: 1 }}>{t("Phone")}<input value={f.phone} onChange={set("phone")} inputMode="tel" /></label>
        <label style={{ flex: 1 }}>Email<input value={f.email} onChange={set("email")} type="email" /></label>
      </div>
      <button className="btn primary" disabled={vid === "" || f.name.trim().length < 2}>{t("Register")}</button>
      {msg && <p className="small">{msg}</p>}
    </form>
  );
}

function AgencyList({ villages }: { villages: WVillage[] }) {
  const { t } = useT();
  const rows = villages.flatMap((v) => v.agencies.map((a) => ({ ...a, village: v.name })));
  if (!rows.length) return null;
  return (
    <>
      <h3>{t("Registered agencies")}</h3>
      <ul className="flat small">{rows.map((a, i) => <li key={i}><b>{a.name}</b> · {a.village}{a.helps_with ? ` · ${a.helps_with}` : ""}</li>)}</ul>
    </>
  );
}

function ChatTab({ v }: { v: WVillage }) {
  const { t } = useT();
  const { me } = useAuth();
  const member = !!me && (me.role === "admin" || me.village_id === v.id || (me.role === "technician" && !!me.network_id && me.network_id === v.network_id));
  if (member) return <VillageChat villageId={v.id} />;
  return (
    <div className="stack">
      <p>{t("The chat is for people of this village, its caretaker and the district technicians.")}</p>
      <Link className="btn primary" to="/login">{t("Log in")}</Link>
    </div>
  );
}

function AddVillage({ onDone }: { onDone: (id: number, token: string) => void }) {
  const { t } = useT();
  const [f, setF] = useState({ name: "", households: "40", zones: "", caretaker: "", phone: "", pin: "" });
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const where = () => navigator.geolocation?.getCurrentPosition((p) => setPos({ lat: +p.coords.latitude.toFixed(5), lon: +p.coords.longitude.toFixed(5) }), () => setErr(t("Could not get the location.")));
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    try {
      const r = await api<{ village_id: number; token: string }>("/api/villages/register", {
        json: { name: f.name, households: Number(f.households), zones: f.zones.split(/[,\n]/).map((z) => z.trim()).filter(Boolean), caretaker: f.caretaker,
          phone: f.phone.replace(/[\s-]/g, ""), pin: f.pin, ...(pos ?? {}) },
      });
      onDone(r.village_id, r.token);
    } catch (er: any) {
      setErr(er.status === 409 ? t("This phone number is already used.") : er.message);
    }
  };
  return (
    <form className="stack" onSubmit={send}>
      <p className="small muted">{t("You become the caretaker of the new village. Then connect the main meter or read it by phone.")}</p>
      <label>{t("Village name")}<input required minLength={2} value={f.name} onChange={set("name")} /></label>
      <label>{t("Households")}<input required type="number" min={1} max={5000} value={f.households} onChange={set("households")} /></label>
      <label>{t("Zones or soi (comma between)")}<input value={f.zones} onChange={set("zones")} placeholder="Soi 1, Soi 2, Temple" /></label>
      <label>{t("Your name")}<input required value={f.caretaker} onChange={set("caretaker")} /></label>
      <div className="row" style={{ gap: 8 }}>
        <label style={{ flex: 2 }}>{t("Phone number")}<input required inputMode="tel" value={f.phone} onChange={set("phone")} /></label>
        <label style={{ flex: 1 }}>PIN<input required inputMode="numeric" pattern="[0-9]{4,8}" value={f.pin} onChange={set("pin")} /></label>
      </div>
      <button type="button" className="btn small" onClick={where}>📍 {pos ? `${pos.lat}, ${pos.lon}` : t("Use my location (optional)")}</button>
      <button className="btn primary">{t("Add village")}</button>
      {err && <p className="small" style={{ color: "var(--critical-ink)" }}>{err}</p>}
    </form>
  );
}

function Phone() {
  const { t } = useT();
  const { data: phones } = useApi<{ phone: string; name: string; role: string; village: string }[]>("/api/demo/phones");
  const residents = useMemo(() => (phones ?? []).filter((p) => p.role === "resident"), [phones]);
  const [from, setFrom] = useState("");
  const [text, setText] = useState("");
  const [log, setLog] = useState<{ dir: "in" | "out"; text: string }[]>([]);
  const end = useRef<HTMLDivElement>(null);
  const phone = from || residents[0]?.phone || "";
  useEffect(() => end.current?.scrollIntoView({ block: "nearest" }), [log]);
  const send = async (body: string) => {
    if (!body.trim() || !phone) return;
    setLog((l) => [...l, { dir: "out", text: body }]);
    setText("");
    try {
      const r = await api<{ reply: string }>("/api/sms/inbound", { json: { from: phone, text: body } });
      setLog((l) => [...l, { dir: "in", text: r.reply }]);
    } catch (e: any) {
      setLog((l) => [...l, { dir: "in", text: `⚠ ${e.message}` }]);
    }
  };
  const keys: [string, string][] = [["1", "STATUS"], ["2", "BILL"], ["3", "REPORT LEAK"], ["4", "REPORT NOWATER"], ["5", "READ "], ["?", "HELP"]];
  return (
    <div className="phone-wrap">
      <select value={phone} onChange={(e) => setFrom(e.target.value)} aria-label={t("Phone number")}>
        {residents.map((p) => <option key={p.phone} value={p.phone}>{p.name} · {p.village}</option>)}
      </select>
      <div className="phone">
        <div className="screen">
          {!log.length && <p>NamJai SMS<br />1 STATUS · 2 BILL<br />3 LEAK · 4 NO WATER<br />5 READ meter</p>}
          {log.map((m, i) => <p key={i} className={m.dir}>{m.dir === "out" ? "> " : ""}{m.text}</p>)}
          <div ref={end} />
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); send(text); }} style={{ gap: 4 }}>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={160} aria-label="SMS" style={{ flex: 1, minHeight: 36 }} />
          <button className="btn small">OK</button>
        </form>
        <div className="keys">
          {keys.map(([k, cmd]) => <button key={k} onClick={() => (cmd.endsWith(" ") ? setText(cmd) : send(cmd))}><b>{k}</b><span>{cmd.trim()}</span></button>)}
        </div>
      </div>
      <p className="small muted">{t("Works on any keypad phone. A real deployment connects an SMS gateway to the same endpoint.")}</p>
    </div>
  );
}
