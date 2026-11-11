import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { NightChart } from "../components/Charts";
import { Layout, Loading } from "../components/Layout";
import { day, litres, people, useApi } from "../hooks";
import { useT } from "../i18n";
import { JobStatus, ProofBox, type Proof } from "./Repairs";

type Job = { id: number; kind: string; status: string; created: string };
type Rep = {
  village: { name: string; simulated: boolean };
  zone: string | null;
  job: { id: number; status: string; litres_per_day: number | null; people_per_day: number | null; technician: string | null; proof: Proof };
  alert: { data: { started?: string; nights?: number } } | null;
  nights: { night_of: string; flow: number; baseline: number | null; high: boolean }[];
  step_test: { suspect: { label: string } | null; litres_per_day: number | null } | null;
};

function Step({ n, state, title, children }: { n: number; state: "done" | "now" | "todo"; title: string; children: ReactNode }) {
  return (
    <section className={`card story-step ${state}`}>
      <div className="num" aria-hidden>{state === "done" ? "✓" : n}</div>
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}

export default function Story() {
  const { id } = useParams();
  const { t, lang } = useT();
  const { data: jobs, error } = useApi<Job[]>(`/api/villages/${id}/repairs`, [id]);
  const leak = jobs?.find((j) => j.kind === "leak_detected" || j.kind === "burst_detected");
  const { data: r } = useApi<Rep>(leak ? `/api/repairs/${leak.id}/report` : null, [leak?.id]);
  if (!jobs) return <Layout title={t("Leak story")}><Loading error={error} /></Layout>;
  if (!leak) return <Layout title={t("Leak story")}><p className="card">{t("No leak found by the meter yet. The story starts when night flow stays high.")}</p></Layout>;
  if (!r) return <Layout title={t("Leak story")}><Loading /></Layout>;
  const j = r.job;
  const fixed = ["checking", "done"].includes(j.status);
  const proved = j.proof?.state === "confirmed";
  return (
    <Layout title={`${t("Leak story")} · ${r.village.name}`} wide>
      <p style={{ fontWeight: 800, fontSize: "1.3rem", margin: "16px 0 4px" }}>See. Locate. Fix. Prove.</p>
      {r.village.simulated && <span className="sim-tag">{t("Simulated data")}</span>}
      <Step n={1} state="done" title={t("See: the meter notices at night")}>
        <p>{t("Night flow high for {n} nights since {d}, about {l} lost per day.", { n: r.alert?.data.nights ?? "–", d: day(r.alert?.data.started, lang), l: litres(j.litres_per_day) })}{" "}
          {t("That is the daily water of about {p} people.", { p: people(j.people_per_day) })}</p>
        {r.nights.length > 0 && <NightChart nights={r.nights} baseline={r.nights.at(-1)?.baseline ?? null} lang={lang} />}
      </Step>
      <Step n={2} state={r.step_test?.suspect || r.zone ? "done" : "now"} title={t("Locate: close one valve at a time")}>
        {r.step_test?.suspect ? <p>{t("Step test points to")}: <b>{r.step_test.suspect.label}</b></p>
          : r.zone ? <p>{t("Where")}: <b>{r.zone}</b></p>
          : <p className="muted">{t("Not done yet. The caretaker runs a step test at night from Caretaker tools.")}</p>}
      </Step>
      <Step n={3} state={fixed ? "done" : "now"} title={t("Fix: the nearest technician repairs it")}>
        <p><JobStatus s={j.status} /> {j.technician ? `👷 ${j.technician}` : ""}</p>
        <Link to={`/repairs/${j.id}`}>{t("Open the repair job")} →</Link>
      </Step>
      <Step n={4} state={proved ? "done" : fixed ? "now" : "todo"} title={t("Prove: the meter confirms the repair")}>
        {j.proof?.state ? <ProofBox proof={j.proof} lang={lang} /> : <p className="muted">{t("After the repair, NamJai watches 2 more nights before the job can close.")}</p>}
      </Step>
      <p className="center"><Link className="btn" to={`/report/${j.id}`}>📄 {t("Evidence report")}</Link></p>
    </Layout>
  );
}
