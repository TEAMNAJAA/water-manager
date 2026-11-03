import { useEffect, useRef, useState } from "react";
import { api, photoUrl } from "../api";
import { useApi } from "../hooks";
import { useT } from "../i18n";

type Latest = { photo: string | null; roi: number[] | null };

export function RoiEditor({ meterId }: { meterId: number }) {
  const { t } = useT();
  const { data } = useApi<Latest>(`/api/meters/${meterId}/latest-photo`, [meterId]);
  const img = useRef<HTMLImageElement>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [roi, setRoi] = useState<number[] | null>(null);
  const [drag, setDrag] = useState<number[] | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setRoi(data?.roi ?? null), [data]);
  if (!data?.photo) return <p className="small muted">{t("No Clip photo yet.")}</p>;
  const toImg = (e: React.PointerEvent) => {
    const r = img.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * nat!.w, ((e.clientY - r.top) / r.height) * nat!.h];
  };
  const box = drag ?? roi;
  const pct = (b: number[]) => ({ left: `${(Math.min(b[0], b[2]) / nat!.w) * 100}%`, top: `${(Math.min(b[1], b[3]) / nat!.h) * 100}%`,
    width: `${(Math.abs(b[2] - b[0]) / nat!.w) * 100}%`, height: `${(Math.abs(b[3] - b[1]) / nat!.h) * 100}%` });
  const save = async () => {
    await api(`/api/meters/${meterId}/roi`, { method: "PUT", json: { roi } });
    setSaved(true);
  };
  return (
    <div className="stack">
      <p className="small muted">{t("Drag a box around the digit wheels.")}</p>
      <div style={{ position: "relative", touchAction: "none", userSelect: "none" }}
        onPointerDown={(e) => { if (nat) { const [x, y] = toImg(e); setDrag([x, y, x, y]); setSaved(false); (e.target as Element).setPointerCapture?.(e.pointerId); } }}
        onPointerMove={(e) => { if (drag) { const [x, y] = toImg(e); setDrag([drag[0], drag[1], x, y]); } }}
        onPointerUp={() => { if (drag) { const b = [Math.min(drag[0], drag[2]), Math.min(drag[1], drag[3]), Math.max(drag[0], drag[2]), Math.max(drag[1], drag[3])]; if (b[2] - b[0] > 10 && b[3] - b[1] > 5) setRoi(b.map(Math.round)); setDrag(null); } }}>
        <img ref={img} src={photoUrl(data.photo)} alt="" draggable={false} onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} style={{ width: "100%", borderRadius: 8, display: "block" }} />
        {box && nat && <div style={{ position: "absolute", border: "3px solid #fab219", borderRadius: 4, ...pct(box) }} />}
      </div>
      <button className="btn primary block" disabled={!roi} onClick={save}>{saved ? "✓ " : ""}{t("Save")}</button>
    </div>
  );
}
