import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Chip, Layout, Loading } from "../components/Layout";
import { day, money, useApi } from "../hooks";
import { useT } from "../i18n";

type Entry = { id: number; wallet: string; amount: number; kind: string; note: string | null; status: string; created: string; by: string | null; approvals: number };
type Funds = { water_fees: { month: string; amount: number; bills: number }[]; wallets: Record<string, number>; rules: Record<string, { income: string[]; expense: string[] }>; approvals_needed: number; entries: Entry[]; pending: Entry[] };

export const WALLET: Record<string, { icon: string; label: string }> = {
  repair: { icon: "🔧", label: "Repair fund" }, network: { icon: "🤝", label: "Network fund" },
  rewards: { icon: "🎁", label: "Rewards fund" }, namjai: { icon: "💚", label: "Namjai fund" },
};
const KIND: Record<string, string> = {
  water_fee: "water fee", local_budget: "local budget", contribution: "village contribution", district: "district budget", sponsor: "sponsor",
  donation: "donation", repair_cost: "repair", parts: "parts", operations: "operations", reward_cost: "rewards", namjai_bill: "bill support",
};

export default function FundsPage() {
  const { t, lang } = useT();
  const { me, staff } = useAuth();
  const { data, error, reload } = useApi<Funds>(me?.village_id ? `/api/villages/${me.village_id}/funds` : null, [me?.village_id]);
  const [form, setForm] = useState({ wallet: "repair", direction: "income", amount: "", kind: "", note: "" });
  const [msg, setMsg] = useState("");
  const canApprove = me && ["caretaker", "committee", "admin"].includes(me.role);
  const approve = async (id: number) => {
    try {
      await api(`/api/funds/${id}/approve`, { method: "POST" });
      reload();
    } catch (e: any) {
      setMsg(String(e.detail));
    }
  };
  const kinds = data ? data.rules[form.wallet]?.[form.direction as "income" | "expense"]?.filter((k) => k !== "water_fee") ?? [] : [];
  const record = async () => {
    try {
      await api(`/api/villages/${me!.village_id}/funds`, { json: { ...form, amount: Number(form.amount), kind: form.kind || kinds[0] } });
      setForm({ ...form, amount: "", note: "" });
      setMsg("");
      reload();
    } catch (e: any) {
      setMsg(String(e.detail));
    }
  };
  return (
    <Layout title={t("Village funds")}>
      {!data ? <Loading error={error} /> : (
        <>
          <div className="grid" style={{ marginTop: 12 }}>
            {Object.entries(data.wallets).map(([w, v]) => (
              <div key={w} className="card flat" style={{ margin: 0 }}>
                <div style={{ fontSize: 28 }}>{WALLET[w].icon}</div>
                <div className="small muted">{t(WALLET[w].label)}</div>
                <div style={{ fontSize: "1.5rem", fontWeight: 800 }}>{money(v)}</div>
              </div>
            ))}
          </div>
          <p className="notice small" style={{ marginTop: 12 }}>{t("Water fees go only to the repair fund. Rewards come only from sponsors. NamJai records money but never holds it.")} {t("Spending needs approval from {n} different people.", { n: data.approvals_needed })}</p>
          {msg && <p className="notice critical">{msg}</p>}
          {data.pending.length > 0 && (
            <div className="card">
              <h2>⏳ {t("Waiting for approval")}</h2>
              <ul className="list">
                {data.pending.map((e) => (
                  <li key={e.id} className="row between">
                    <span>{WALLET[e.wallet].icon} <b>{money(-e.amount)}</b> · {KIND[e.kind] ?? e.kind}<br /><span className="small muted">{e.note} · {e.by} · {e.approvals}/{data.approvals_needed}</span></span>
                    {canApprove && <button className="btn small primary" onClick={() => approve(e.id)}>{t("Approve")}</button>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="card">
            <h2>🔧 {t("Water fees by month")}</h2>
            <ul className="list">
              {data.water_fees.map((m) => (
                <li key={m.month} className="row between">
                  <span>{new Date(m.month + "-15").toLocaleDateString(lang === "th" ? "th-TH" : "en-GB", { month: "long", year: "numeric" })}<br /><span className="small muted">{m.bills} {t("bills paid")}</span></span>
                  <Chip kind="good">+{money(m.amount)}</Chip>
                </li>
              ))}
            </ul>
          </div>
          <div className="card">
            <h2>{t("Recent money in and out")}</h2>
            <ul className="list">
              {data.entries.map((e) => (
                <li key={e.id} className="row between">
                  <span>{WALLET[e.wallet].icon} {KIND[e.kind] ?? e.kind}<br /><span className="small muted">{day(e.created, lang)}{e.note ? ` · ${e.note}` : ""}</span></span>
                  <Chip kind={e.amount > 0 ? "good" : undefined}>{e.amount > 0 ? "+" : "−"}{money(Math.abs(e.amount))}</Chip>
                </li>
              ))}
            </ul>
          </div>
          {staff && (
            <div className="card">
              <h2>{t("Record money")}</h2>
              <label>{t("Wallet")}</label>
              <select value={form.wallet} onChange={(e) => setForm({ ...form, wallet: e.target.value, kind: "" })}>
                {Object.keys(data.wallets).map((w) => <option key={w} value={w}>{t(WALLET[w].label)}</option>)}
              </select>
              <div className="tabs" style={{ marginTop: 8 }}>
                <button aria-pressed={form.direction === "income"} onClick={() => setForm({ ...form, direction: "income", kind: "" })}>{t("Money in")}</button>
                <button aria-pressed={form.direction === "expense"} onClick={() => setForm({ ...form, direction: "expense", kind: "" })}>{t("Money out")}</button>
              </div>
              <label>{t("Type")}</label>
              <select value={form.kind || kinds[0]} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {kinds.map((k) => <option key={k} value={k}>{KIND[k] ?? k}</option>)}
              </select>
              <label>{t("Amount")}</label>
              <input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              <label>{t("Note (optional)")}</label>
              <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              <button className="btn primary block" style={{ marginTop: 12 }} disabled={!Number(form.amount) || !kinds.length} onClick={record}>{t("Save")}</button>
            </div>
          )}
        </>
      )}
    </Layout>
  );
}
