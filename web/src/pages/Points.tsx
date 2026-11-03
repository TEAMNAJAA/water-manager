import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Layout, Loading } from "../components/Layout";
import { useApi } from "../hooks";
import { useT } from "../i18n";

type Mine = { total: number; rules: Record<string, number>; rewards: { id: string; points: number; en: string; th: string }[] };
const RULES: Record<string, string> = {
  main_photo: "Photo of the main meter (1 person a day)", on_time: "Paying on time",
  verified_report: "Reporting a leak the technician confirms", saving: "Using less water than last month",
};

export default function Points() {
  const { t, lang } = useT();
  const { me, refresh } = useAuth();
  const { data, error, reload } = useApi<Mine>("/api/me/points");
  const { data: board } = useApi<{ month: string; guardians: { name: string; points: number }[] }>(me?.village_id ? `/api/villages/${me.village_id}/leaderboard` : null, [me?.village_id]);
  const [msg, setMsg] = useState("");
  const redeem = async (id: string) => {
    try {
      await api("/api/me/redeem", { json: { reward_id: id } });
      setMsg(t("Requested – the committee will contact you."));
      reload();
      refresh();
    } catch (e: any) {
      setMsg(String(e.detail));
    }
  };
  return (
    <Layout title={t("Points")}>
      {!data ? <Loading error={error} /> : (
        <>
          <div className="card center">
            <div className="muted">{t("My points")}</div>
            <div className="big-number">⭐ {data.total}</div>
          </div>
          <div className="card">
            <h2>🏆 {t("Water Guardians this month")}</h2>
            <ol>{board?.guardians.map((g) => <li key={g.name + g.points} className="kv"><span>{g.name}</span><b>⭐ {g.points}</b></li>)}</ol>
          </div>
          <div className="card">
            <h2>{t("How to earn")}</h2>
            <ul className="list">{Object.entries(data.rules).map(([k, v]) => <li key={k} className="row between"><span>{t(RULES[k] ?? k)}</span><b>+{v}</b></li>)}</ul>
          </div>
          <div className="card">
            <h2>🎁 {t("Rewards")}</h2>
            {msg && <p className="notice good">{msg}</p>}
            <ul className="list">
              {data.rewards.map((r) => (
                <li key={r.id} className="row between">
                  <span>{r[lang]}</span>
                  {r.points > 0 ? <button className="btn small" disabled={data.total < r.points} onClick={() => redeem(r.id)}>{t("Redeem")} ⭐{r.points}</button> : <span className="muted small">auto</span>}
                </li>
              ))}
            </ul>
            <p className="notice small" style={{ marginTop: 10 }}>🔒 {t("Points can never be used for water access.")}</p>
          </div>
        </>
      )}
    </Layout>
  );
}
