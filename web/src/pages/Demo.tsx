import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, BASE } from "../api";
import { Layout, Loading } from "../components/Layout";
import { useApi } from "../hooks";
import { useT } from "../i18n";
import { DemoLogin } from "./Login";

type Sample = { file: string; condition: string; n_digits: number; truth: string; roi: number[] | null };
type Ocr = { value: number; digits: string; confidence: number; cells: { p: number }[]; quality: { issues: string[]; ok: boolean }; issues: string[] };

function Reader() {
  const { data: samples } = useApi<Sample[]>("/samples/samples.json");
  const [pick, setPick] = useState<Sample | null>(null);
  const [res, setRes] = useState<Ocr | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (s: Sample, blob?: Blob) => {
    setPick(s);
    setRes(null);
    setBusy(true);
    const img = blob ?? (await (await fetch(`/samples/${s.file}`)).blob());
    const f = new FormData();
    f.append("file", img, "meter.jpg");
    const q = new URLSearchParams({ n_digits: String(s.n_digits), ...(s.roi ? { roi: s.roi.join(",") } : {}) });
    try {
      setRes(await api<Ocr>(`/api/demo/ocr?${q}`, { form: f }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <h2>📷 Try the meter reader</h2>
      <p className="small muted">Tap a sample. These are <b>rendered (synthetic) meters</b> in four conditions – real-photo accuracy is reported separately in the repository.</p>
      <div className="grid3">
        {samples?.map((s) => (
          <button key={s.file} className="tile" style={{ padding: 6, minHeight: 0 }} onClick={() => run(s)} aria-pressed={pick?.file === s.file}>
            <img src={`/samples/${s.file}`} alt={`${s.condition} sample`} style={{ borderRadius: 8, maxHeight: 70, objectFit: "contain" }} />
            <span className="small">{s.condition}{s.roi ? " · box" : " · auto"}</span>
          </button>
        ))}
      </div>
      <label style={{ marginTop: 12 }}>…or your own photo (5 wheels)</label>
      <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && run({ file: "", condition: "your photo", n_digits: 5, truth: "?", roi: null }, e.target.files[0])} />
      {busy && <Loading />}
      {res && pick && (
        <div className="notice" style={{ marginTop: 12 }}>
          <div className="digits">{res.digits.split("").map((d, i) => <span key={i} className={res.cells[i]?.p < 0.9 ? "weak" : ""}>{d}</span>)}</div>
          <p className="center" style={{ marginTop: 8 }}>
            Read <b>{res.digits}</b> · true <b>{pick.truth}</b> {pick.truth === res.digits ? "✅" : pick.truth === "?" ? "" : "≠"} · confidence {Math.round(res.confidence * 100)}%
          </p>
          <p className="small muted center">Photo check: {res.quality.ok ? "OK" : res.quality.issues.join(", ")}. In the app a person always confirms ✅ before a house reading is used.</p>
        </div>
      )}
    </div>
  );
}

export default function Demo() {
  const { t } = useT();
  const [qr, setQr] = useState("");
  const url = `${location.origin}/demo`;
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 220 }).then(setQr);
  }, [url]);
  const { data: villages } = useApi<{ id: number; name: string; level: string; network_id: number | null }[]>("/api/villages");
  const red = villages?.find((v) => v.level === "red");
  return (
    <Layout title="NamJai · demo for judges" back={false} wide>
      <section className="card" style={{ marginTop: 16 }}>
        <h1>💧 NamJai</h1>
        <p><b>Turning a village's old main water meter into the brain of its community water system.</b></p>
        <p>A small camera clip reads the main meter every hour. NamJai watches the night flow, raises a 🟡 then 🔴 alert when it stays high for several nights,
          narrows the leak down to a soi, sends the nearest technician with the right parts, and shows every household the repair fund.</p>
        <p className="notice warning small">Everything on this page runs on <b>simulated villages</b> (marked “Simulated data”). No sign-up needed.</p>
      </section>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        <div className="card">
          <h2>1 · Open the app</h2>
          <p className="small muted">Pick a role. Village B has a leak that started 4 nights ago.</p>
          <DemoLogin compact />
        </div>
        <div className="card">
          <h2>2 · See the data</h2>
          <div className="stack">
            {red && <Link className="btn block" to={`/dashboard/${red.id}`}>📊 Village dashboard (leak)</Link>}
            {red?.network_id && <Link className="btn block" to={`/network/${red.network_id}`}>🤝 District network map</Link>}
            <Link className="btn block" to="/sms">📱 SMS for keypad phones</Link>
            <a className="btn block" href={`${BASE}/docs`} target="_blank" rel="noreferrer">🔌 API docs</a>
          </div>
        </div>
        <div className="card center">
          <h2>Open on your phone</h2>
          {qr && <img src={qr} alt={`QR code for ${url}`} width={200} height={200} />}
          <p className="small muted">{url}</p>
        </div>
      </div>
      <Reader />
      <div className="card">
        <h2>{t("Everyone sees this.")}</h2>
        <ul>
          <li>Leak location is narrowed to a <b>soi</b> (lane), not an exact point. NamJai cannot fix pipes – people do.</li>
          <li>It needs the local water committee and Tambon office to take part.</li>
          <li>Water fees alone do not cover every cost; the network fund and local budget fill the gap.</li>
        </ul>
      </div>
    </Layout>
  );
}
