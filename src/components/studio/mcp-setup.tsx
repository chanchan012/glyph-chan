"use client";

import { useRef, useState, type FormEvent } from "react";
import type { AgentInfo } from "@/lib/foundry/mcp-contract";

export function McpSetup({ collectionId }: { collectionId: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const operation = useRef(0);
  const [endpoint, setEndpoint] = useState("");
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const route = "/api/collections/" + encodeURIComponent(collectionId) + "/mcp-token";

  async function update(method: "GET" | "POST" | "DELETE") {
    const current = ++operation.current;
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch(route, {
        method, cache: "no-store",
        ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label }) } : {}),
      });
      if (current !== operation.current) return;
      if (response.status === 401) throw Error("Sign in again to manage agent access.");
      if (response.status === 429) throw Error("The request limit was reached. Try again in a minute.");
      if (!response.ok) throw Error("Agent access could not be updated.");
      if (method === "DELETE") {
        setToken("");
        setAgent(null);
        setStatus({ text: "Agent access revoked." });
      } else {
        const data = await response.json() as { agent: AgentInfo | null; token?: string };
        if (current !== operation.current) return;
        setAgent(data.agent);
        if (method === "GET") setLabel(data.agent?.label ?? "");
        if (data.token) {
          setToken(data.token);
          setStatus({ text: "Copy this token before closing. It is shown once." });
        }
      }
    } catch (error) {
      if (current === operation.current) setStatus({
        error: true, text: error instanceof Error ? error.message : "Agent access could not be updated.",
      });
    } finally {
      if (current === operation.current) setBusy(false);
    }
  }

  function open() {
    setEndpoint(location.origin + "/api/mcp");
    setToken("");
    dialog.current?.showModal();
    void update("GET");
  }

  async function copy(value: string, text: string) {
    try {
      await navigator.clipboard.writeText(value);
      setStatus({ text });
    } catch {
      setStatus({ text: "Clipboard access is unavailable. You can select and copy the field.", error: true });
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy) void update("POST");
  }

  return <>
    <button onClick={open}>Agent access</button>
    <dialog className="index-dialog collection-dialog export-dialog mcp-dialog" ref={dialog} aria-labelledby="mcp-title"
      onClose={() => { operation.current++; setToken(""); setBusy(false); }}>
      <div className="dialog-head">
        <h2 id="mcp-title">Connect an agent</h2>
        <button type="button" aria-label="Close agent access" onClick={() => dialog.current?.close()}>×</button>
      </div>
      <p>The token lets one agent read, edit, and export this collection for seven days. Creating a new token revokes the previous one.</p>
      {agent && <p>Active token for <strong>{agent.label}</strong> until {new Date(agent.expiresAt).toLocaleDateString()}.</p>}
      <form onSubmit={submit}>
        <label>Agent name
          <input required maxLength={40} value={label} disabled={busy} onChange={event => setLabel(event.target.value)}
            placeholder="e.g. Type assistant" />
        </label>
        <div className="dialog-actions">
          <button className="primary" disabled={busy || !label.trim()}>{agent ? "Rotate token" : "Create token"}</button>
          {agent && <button type="button" disabled={busy} onClick={() => void update("DELETE")}>Revoke access</button>}
        </div>
      </form>
      <label>Streamable HTTP endpoint
        <span className="mcp-copy"><input readOnly value={endpoint} /><button onClick={() => void copy(endpoint, "Endpoint copied.")}>Copy URL</button></span>
      </label>
      {token && <label>Bearer token
        <span className="mcp-copy"><input readOnly value={token} /><button onClick={() => void copy(token, "Token copied.")}>Copy token</button></span>
      </label>}
      <details>
        <summary>stdio setup</summary>
        <p>Run <code>node scripts/glyph-mcp.mjs</code> from a local checkout after installing dependencies. Set
          <code> GLYPH_MCP_URL</code> to the endpoint above and <code>GLYPH_MCP_TOKEN</code> to the bearer token in your MCP client configuration.</p>
      </details>
      {status && <p className={status.error ? "form-error" : "export-status"} role={status.error ? "alert" : "status"}>{status.text}</p>}
    </dialog>
  </>;
}
