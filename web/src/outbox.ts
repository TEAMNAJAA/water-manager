import { createStore, del, entries, set } from "idb-keyval";

const store = createStore("namjai", "outbox");
type Saved = { path: string; method: string; json?: unknown; fields?: [string, string][]; file?: { name: string; blob: Blob; field: string }; label: string; created: number };
const listeners = new Set<(n: number) => void>();

async function notify() {
  const n = (await entries(store)).length;
  listeners.forEach((f) => f(n));
}

export function onOutbox(f: (n: number) => void) {
  listeners.add(f);
  notify();
  return () => listeners.delete(f);
}

export async function enqueue(item: { path: string; method: string; json?: unknown; form?: FormData; label: string }) {
  const saved: Saved = { path: item.path, method: item.method, json: item.json, label: item.label, created: Date.now(), fields: [] };
  item.form?.forEach((v, k) => {
    if (v instanceof Blob) saved.file = { name: (v as File).name ?? "photo.jpg", blob: v, field: k };
    else saved.fields!.push([k, String(v)]);
  });
  await set(`${saved.created}-${Math.random().toString(36).slice(2)}`, saved, store);
  notify();
}

let flushing = false;

export async function flush(base: string, authHeader: () => string | null) {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    for (const [key, item] of (await entries<string, Saved>(store)).sort((a, b) => a[1].created - b[1].created)) {
      const headers: Record<string, string> = {};
      const a = authHeader();
      if (a) headers.Authorization = `Bearer ${a}`;
      let body: BodyInit | undefined;
      if (item.file) {
        const f = new FormData();
        item.fields?.forEach(([k, v]) => f.append(k, v));
        f.append(item.file.field, item.file.blob, item.file.name);
        body = f;
      } else if (item.json !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(item.json);
      }
      try {
        const res = await fetch(base + item.path, { method: item.method, headers, body });
        if (res.ok || (res.status >= 400 && res.status < 500)) await del(key, store);
      } catch {
        break;
      }
    }
  } finally {
    flushing = false;
    notify();
  }
}
