import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Chip, Layout, Loading } from "../components/Layout";
import { day, money, useApi } from "../hooks";
import { useT } from "../i18n";

export type BillT = { id: number; meter: string | null; m3: number; amount: number; issued: string; due: string; status: string; paid_at: string | null; paid_via: string | null; overdue: boolean; prev: number; value: number };

export function BillStatus({ b }: { b: BillT }) {
  const { t } = useT();
  if (b.paid_via === "namjai") return <Chip kind="good">💚 {t("Paid with Namjai support")}</Chip>;
  if (b.status === "paid") return <Chip kind="good">✓ {t("Paid")}</Chip>;
  return b.overdue ? <Chip kind="critical">! {t("Overdue")}</Chip> : <Chip kind="warning">{t("Unpaid")}</Chip>;
}

export default function Bills() {
  const { t, lang } = useT();
  const { me } = useAuth();
  const { data, error } = useApi<BillT[]>("/api/me/bills");
  const [thanks, setThanks] = useState("");
  const [sent, setSent] = useState(false);
  const namjai = data?.some((b) => b.paid_via === "namjai");
  const send = async () => {
    await api(`/api/villages/${me!.village_id}/namjai/thanks`, { json: { text: thanks }, queue: "Thank-you" });
    setSent(true);
  };
  return (
    <Layout title={t("My bills")}>
      {!data ? <Loading error={error} /> : data.length === 0 ? <p className="card">{t("No bills yet.")}</p> : (
        <>
          {data.map((b, i) => (
            <div key={b.id} className="card" style={i === 0 ? { borderWidth: 2 } : undefined}>
              <div className="row between">
                <span className="muted">{day(b.issued, lang)}</span>
                <BillStatus b={b} />
              </div>
              <div className="big-number">{money(b.amount)}</div>
              <div className="kv"><span className="muted">{t("Used")}</span><b>{b.m3} m³</b></div>
              <div className="kv small muted"><span>{b.prev} → {b.value}</span><span>{t("Due")}: {day(b.due, lang)}</span></div>
            </div>
          ))}
          <p className="notice small">{t("Pay the caretaker in cash or by bank transfer. NamJai records payments but never holds money.")}</p>
          {namjai && (
            <div className="card">
              <h3>💚 {t("Send a thank-you (optional, anonymous)")}</h3>
              {sent ? <p className="notice good">{t("Saved. Thank you!")}</p> : (
                <>
                  <textarea maxLength={280} value={thanks} onChange={(e) => setThanks(e.target.value)} />
                  <button className="btn primary block" style={{ marginTop: 8 }} disabled={!thanks.trim()} onClick={send}>{t("Send")}</button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </Layout>
  );
}
