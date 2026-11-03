import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Layout } from "../components/Layout";
import { useApi } from "../hooks";

type Msg = { dir: "in" | "out"; text: string };

export default function Sms() {
  const { data: phones } = useApi<{ phone: string; name: string; role: string; village: string }[]>("/api/demo/phones");
  const [from, setFrom] = useState("");
  const [text, setText] = useState("");
  const [log, setLog] = useState<Msg[]>([{ dir: "in", text: "NamJai SMS: send HELP" }]);
  const end = useRef<HTMLDivElement>(null);
  const phone = from || phones?.[0]?.phone || "";
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);
  const send = async (body = text) => {
    if (!body.trim()) return;
    setLog((l) => [...l, { dir: "out", text: body }]);
    setText("");
    const r = await api<{ reply: string }>("/api/sms/inbound", { json: { from: phone, text: body } });
    setLog((l) => [...l, { dir: "in", text: r.reply }]);
  };
  return (
    <Layout title="📱 SMS (simulated)">
      <p className="small muted" style={{ marginTop: 12 }}>For keypad phones. A real deployment connects an SMS gateway to the same endpoint; here the phone is simulated.</p>
      <label>From</label>
      <select value={phone} onChange={(e) => setFrom(e.target.value)}>
        {phones?.map((p) => <option key={p.phone} value={p.phone}>{p.phone} · {p.name} ({p.role}, {p.village})</option>)}
      </select>
      <div className="row" style={{ margin: "10px 0", gap: 6 }}>
        {["HELP", "STATUS", "BILL", "READ 01234", "REPORT LEAK near school", "สถานะ"].map((c) => <button key={c} className="btn small" onClick={() => send(c)}>{c}</button>)}
      </div>
      <div className="phone">
        <div className="screen">
          {log.map((m, i) => <div key={i} className={`bubble ${m.dir}`}>{m.text}</div>)}
          <div ref={end} />
        </div>
        <form className="keypad" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <input value={text} maxLength={160} onChange={(e) => setText(e.target.value)} placeholder="READ 01234" />
          <button className="btn primary small">➤</button>
        </form>
      </div>
    </Layout>
  );
}
