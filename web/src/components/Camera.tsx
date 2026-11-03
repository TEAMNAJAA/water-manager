import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";

export type Shot = { blob: Blob; roi: number[] | null; url: string };

const MAX_W = 1600;

export function Camera({ onShot, aspect = 3.2 }: { onShot: (s: Shot) => void; aspect?: number }) {
  const { t } = useT();
  const video = useRef<HTMLVideoElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        setSize({ w: v.videoWidth, h: v.videoHeight });
      } catch {
        setFailed(true);
      }
    })();
    return () => stream?.getTracks().forEach((tr) => tr.stop());
  }, []);

  const box = size && (() => {
    const w = size.w * 0.84;
    const h = Math.min(w / aspect, size.h * 0.5);
    return { x: (size.w - w) / 2, y: (size.h - h) / 2, w, h };
  })();

  const capture = () => {
    if (!size || !box) return;
    const k = Math.min(1, MAX_W / size.w);
    const c = document.createElement("canvas");
    c.width = Math.round(size.w * k);
    c.height = Math.round(size.h * k);
    c.getContext("2d")!.drawImage(video.current!, 0, 0, c.width, c.height);
    c.toBlob((blob) => blob && onShot({ blob, url: URL.createObjectURL(blob), roi: [box.x, box.y, box.x + box.w, box.y + box.h].map((v) => Math.round(v * k)) }), "image/jpeg", 0.9);
  };

  const pick = (f: File | undefined) => f && onShot({ blob: f, url: URL.createObjectURL(f), roi: null });

  return (
    <div className="stack">
      {!failed && (
        <div className="camera" style={{ aspectRatio: size ? `${size.w} / ${size.h}` : "4 / 3" }}>
          <video ref={video} playsInline muted />
          {box && size && (
            <div className="guide" style={{ left: `${(box.x / size.w) * 100}%`, top: `${(box.y / size.h) * 100}%`, width: `${(box.w / size.w) * 100}%`, height: `${(box.h / size.h) * 100}%` }} />
          )}
          <div className="hint">{t("Put the numbers inside the box")}</div>
        </div>
      )}
      {failed && <div className="notice warning">{t("Camera not available – choose a photo instead.")}</div>}
      {!failed && <button className="btn primary block" onClick={capture} disabled={!size} style={{ minHeight: 64, fontSize: "1.2rem" }}>📷 {t("Take photo")}</button>}
      <button className="btn block" onClick={() => file.current?.click()}>🖼️ {t("Use a photo from the phone")}</button>
      <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files?.[0])} />
    </div>
  );
}
