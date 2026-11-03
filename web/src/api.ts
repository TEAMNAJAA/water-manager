import { enqueue } from "./outbox";

export const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export class ApiError extends Error {
  constructor(public status: number, public detail: unknown) {
    super(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
}

export const token = {
  get: () => localStorage.getItem("namjai.token"),
  set: (t: string | null) => (t ? localStorage.setItem("namjai.token", t) : localStorage.removeItem("namjai.token")),
};

type Opts = { method?: string; json?: unknown; form?: FormData; queue?: string };

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const t = token.get();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (opts.json !== undefined) headers["Content-Type"] = "application/json";
  const method = opts.method ?? (opts.json !== undefined || opts.form ? "POST" : "GET");
  const body = opts.form ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined);
  if (opts.queue && !navigator.onLine) {
    await enqueue({ path, method, json: opts.json, form: opts.form, label: opts.queue });
    return { queued: true } as T;
  }
  let res: Response;
  try {
    res = await fetch(BASE + path, { method, headers, body });
  } catch (e) {
    if (opts.queue) {
      await enqueue({ path, method, json: opts.json, form: opts.form, label: opts.queue });
      return { queued: true } as T;
    }
    throw new ApiError(0, "offline");
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data as any)?.detail ?? data);
  return data as T;
}

export const photoUrl = (path: string | null | undefined) => (path ? BASE + path : undefined);
