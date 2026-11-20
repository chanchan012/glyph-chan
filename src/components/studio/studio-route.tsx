"use client";

import { useEffect, useState } from "react";
import { hc } from "hono/client";
import type { AppType } from "@/server/api";
import type { StudioSource } from "@/lib/foundry/studio-source";
import { Arrow, Brand } from "../marks";
import { Studio } from "./studio";

const api = hc<AppType>("").api.collections[":id"].studio;
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function StudioRoute({ id, guest }: { id: string; guest: StudioSource | null }) {
  const [source, setSource] = useState(guest);
  const [status, setStatus] = useState<"loading" | "missing" | "signin" | "error">(uuid.test(id) ? "loading" : "missing");

  useEffect(() => {
    if (guest || !uuid.test(id)) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await api.$get({ param: { id } }, { init: { signal: controller.signal } });
        if (controller.signal.aborted) return;
        if (response.status === 401) return setStatus("signin");
        if (response.status === 404) return setStatus("missing");
        if (!response.ok) return setStatus("error");
        const { studio } = await response.json();
        if (!controller.signal.aborted) setSource(studio);
      } catch {
        if (!controller.signal.aborted) setStatus("error");
      }
    }
    void load();
    return () => controller.abort();
  }, [id, guest]);

  if (source) return <Studio source={source} />;
  const title = { loading: "Opening studio…", missing: "Collection unavailable", signin: "Sign in to open this collection", error: "Studio temporarily unavailable" }[status];
  return <div className="shell">
    <header className="mast"><div className="wrap mast-inner"><Brand /><a className="back-link" href="/dashboard"><Arrow back /> Collections</a></div></header>
    <main className="wrap studio-fallback">
      <h1>{title}</h1>
      {status === "signin" && <a className="primary" href="/sign-in">Sign in <Arrow diagonal /></a>}
      {status !== "loading" && <a className="text-link" href="/studio/demo">Open a sample in Studio</a>}
    </main>
  </div>;
}
