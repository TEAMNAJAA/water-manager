import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Layout, Loading } from "../components/Layout";
import { ago, day, money, useApi } from "../hooks";
import { useT } from "../i18n";
import type { BillT } from "./Bills";

type N = { balance: number; donated: number; donors: number; bills_covered: number; households_helped: number; amount_covered: number;
  board: { name: string; title: string | null }[]; thanks: { text: string; created: string }[] };

export default function Namjai() {
  const { t, lang } = useT();
  const { me, staff } = useAuth();
  const vid = me?.village_id;
  const { data, error, reload } = useApi<N>(vid ? `/api/villages/${vid}/namjai` : null, [vid]);
  const committee = me?.role === "committee" || me?.role === "admin";
  const { data: cands, reload: reloadCands } = useApi<BillT[]>(committee && vid ? `/api/villages/${vid}/namjai/candidates` : null, [vid, committee]);
  const [gift, setGift] = useState({ amount: "", donor: "", anonymous: false });
  const [msg, setMsg] = useState("");
  const record = async () => {
    await api(`/api/villages/${vid}/namjai/donations`, { json: { ...gift, amount: Number(gift.amount) } });
    setGift({ amount: "", donor: "", anonymous: false });
    reload();
  };
  const propose = async (id: number) => {
    try {
      await api(`/api/bills/${id}/namjai`, { method: "POST" });
      setMsg(t("Request sent – needs another approval."));
      reloadCands();
    } catch (e: any) {
      setMsg(String(e.detail));
    }
  };
  return (
    <Layout title={`💚 ${t("Namjai")}`}>
      {!data ? <Loading error={error} /> : (
        <>
          <div className="grid3" style={{ marginTop: 12 }}>
            <div className="card flat center" style={{ margin: 0 }}><div className="small muted">{t("Donated")}</div><b style={{ fontSize: "1.3rem" }}>{money(data.donated)}</b></div>
            <div className="card flat center" style={{ margin: 0 }}><div className="small muted">{t("Households helped")}</div><b style={{ fontSize: "1.3rem" }}>{data.households_helped}</b></div>
            <div className="card flat center" style={{ margin: 0 }}><div className="small muted">{t("Bills covered")}</div><b style={{ fontSize: "1.3rem" }}>{data.bills_covered}</b></div>
          </div>
          <p className="notice small" style={{ marginTop: 12 }}>{t("How to give: hand money to the caretaker or committee; they record it here. Who receives help stays private.")}</p>
          <div className="card">
            <h2>🙏 {t("Thank-you wall")}</h2>
            <ul className="list">{data.thanks.map((x, i) => <li key={i}>“{x.text}” <span className="small muted">· {ago(x.created, lang)}</span></li>)}</ul>
          </div>
          <div className="card">
            <h2>🌟 {t("Givers")}</h2>
            <ul className="list">{data.board.map((d, i) => <li key={i} className="row between"><span>{d.name}</span>{d.title && <span className="chip good">{d.title}</span>}</li>)}</ul>
          </div>
          {staff && (
            <div className="card">
              <h2>{t("Record a gift")}</h2>
              <label>{t("Giver's name")}</label>
              <input value={gift.donor} onChange={(e) => setGift({ ...gift, donor: e.target.value })} />
              <label>{t("Amount")}</label>
              <input inputMode="decimal" value={gift.amount} onChange={(e) => setGift({ ...gift, amount: e.target.value })} />
              <label className="row"><input type="checkbox" checked={gift.anonymous} onChange={(e) => setGift({ ...gift, anonymous: e.target.checked })} /> {t("Show as anonymous")}</label>
              <button className="btn primary block" disabled={!Number(gift.amount) || !gift.donor} onClick={record}>{t("Save")}</button>
            </div>
          )}
          {committee && cands && (
            <div className="card">
              <h2>🔒 {t("Unpaid bills (committee only)")}</h2>
              {msg && <p className="notice good">{msg}</p>}
              <ul className="list">
                {cands.map((b) => (
                  <li key={b.id} className="row between">
                    <span>{b.meter} · {money(b.amount)}<br /><span className="small muted">{t("Due")}: {day(b.due, lang)}</span></span>
                    <button className="btn small" onClick={() => propose(b.id)}>💚 {t("Propose Namjai support")}</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Layout>
  );
}
