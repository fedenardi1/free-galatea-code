#!/usr/bin/env node
// MCP server: invio messaggi WhatsApp via Cloud API ufficiale Meta, zero dipendenze.
// MCP server: send WhatsApp messages via Meta's official Cloud API, zero dependencies.
//
// Env richieste / required env:
//   WHATSAPP_TOKEN     token della Cloud API (Meta for Developers > la tua app)
//   WHATSAPP_PHONE_ID  l'ID del numero mittente (Phone number ID)
//   GRAPH_VERSION      facoltativa, default v20.0
//
// Nota: fuori dalla finestra di 24 ore dall'ultimo messaggio del destinatario,
// WhatsApp accetta solo template approvati. / Outside the 24h customer window,
// WhatsApp only accepts approved templates.

import { createInterface } from "node:readline";

const TOKEN = process.env.WHATSAPP_TOKEN || "";
const PHONE_ID = process.env.WHATSAPP_PHONE_ID || "";
const VERSIONE = process.env.GRAPH_VERSION || "v20.0";

async function inviaWhatsApp({ a, testo }) {
  if (!TOKEN || !PHONE_ID) throw new Error("WHATSAPP_TOKEN / WHATSAPP_PHONE_ID not set");
  const r = await fetch(`https://graph.facebook.com/${VERSIONE}/${PHONE_ID}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: String(a).replace(/[^\d+]/g, ""),
      type: "text",
      text: { body: String(testo).slice(0, 4096) },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`WhatsApp API ${r.status}: ${d?.error?.message || JSON.stringify(d).slice(0, 300)}`);
  return `whatsapp message sent to ${a} (id ${d?.messages?.[0]?.id || "?"})`;
}

/* ------------------------------ protocollo MCP ------------------------------ */

const TOOLS = [
  {
    name: "invia_whatsapp",
    description: "Sends a WhatsApp text message via the official Meta Cloud API. Args: a (recipient number in international format, e.g. +393331234567), testo (message text). Note: outside the 24h window only approved templates work.",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "string", description: "recipient phone number, international format" },
        testo: { type: "string", description: "message text" },
      },
      required: ["a", "testo"],
    },
  },
];

const rispondi = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
const rifiutaRPC = (id, messaggio) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: messaggio } }) + "\n");

const righe = createInterface({ input: process.stdin });
righe.on("line", async (riga) => {
  let m; try { m = JSON.parse(riga); } catch { return; }
  if (m.id === undefined || m.id === null) return;
  try {
    if (m.method === "initialize") {
      return rispondi(m.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "galatea-whatsapp-cloud", version: "1.0.0" } });
    }
    if (m.method === "tools/list") return rispondi(m.id, { tools: TOOLS });
    if (m.method === "tools/call") {
      const { name, arguments: args } = m.params || {};
      if (name !== "invia_whatsapp") return rifiutaRPC(m.id, "unknown tool");
      const esito = await inviaWhatsApp(args || {});
      return rispondi(m.id, { content: [{ type: "text", text: esito }] });
    }
    return rifiutaRPC(m.id, "method not supported: " + m.method);
  } catch (e) {
    return rispondi(m.id, { content: [{ type: "text", text: "ERROR: " + (e.message || e) }], isError: true });
  }
});
