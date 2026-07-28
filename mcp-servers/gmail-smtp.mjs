#!/usr/bin/env node
// MCP server: invio email da Gmail via SMTP, zero dipendenze.
// MCP server: send email from Gmail via SMTP, zero dependencies.
//
// Env richieste / required env:
//   GMAIL_USER          es. tuonome@gmail.com
//   GMAIL_APP_PASSWORD  una "password per le app" (Account Google > Sicurezza >
//                       verifica in due passaggi > Password per le app).
//                       NON la password normale. / An "app password", not your real one.
//
// Solo INVIO. Per leggere la posta usa un server MCP Gmail completo (OAuth).
// Send only. For reading mail use a full OAuth Gmail MCP server.

import { connect } from "node:tls";
import { createInterface } from "node:readline";

const UTENTE = process.env.GMAIL_USER || "";
const PASSWORD = process.env.GMAIL_APP_PASSWORD || "";

/* ------------------------------ SMTP minimale ------------------------------ */

function inviaSMTP({ a, oggetto, testo }) {
  return new Promise((risolvi, rifiuta) => {
    if (!UTENTE || !PASSWORD) return rifiuta(new Error("GMAIL_USER / GMAIL_APP_PASSWORD not set"));
    const presa = connect(465, "smtp.gmail.com", { servername: "smtp.gmail.com" });
    let buf = "";
    let passi = [];
    let attesa = null;

    const fallisci = (e) => { try { presa.destroy(); } catch {} rifiuta(e); };
    presa.on("error", fallisci);
    presa.setTimeout(30_000, () => fallisci(new Error("SMTP timeout")));

    const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
    const corpo64 = b64(testo).replace(/(.{76})/g, "$1\r\n");
    const messaggio = [
      `From: <${UTENTE}>`,
      `To: <${a}>`,
      `Subject: =?UTF-8?B?${b64(oggetto)}?=`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: base64",
      "",
      corpo64,
      ".",
    ].join("\r\n");

    // sequenza: [attendi codice, poi manda]
    passi = [
      [220, `EHLO galatea.local`],
      [250, `AUTH LOGIN`],
      [334, b64(UTENTE)],
      [334, b64(PASSWORD)],
      [235, `MAIL FROM:<${UTENTE}>`],
      [250, `RCPT TO:<${a}>`],
      [250, `DATA`],
      [354, messaggio],
      [250, `QUIT`],
      [221, null],
    ];

    presa.on("data", (d) => {
      buf += d.toString("utf8");
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const riga = buf.slice(0, i); buf = buf.slice(i + 2);
        if (!/^\d{3} /.test(riga)) continue; // le righe "250-..." sono continuazioni
        const codice = Number(riga.slice(0, 3));
        const [atteso, prossimo] = passi.shift() || [];
        if (atteso === undefined) return;
        if (codice !== atteso) return fallisci(new Error(`SMTP ${codice} (expected ${atteso}): ${riga.slice(4, 200)}`));
        if (prossimo === null) { try { presa.end(); } catch {} return risolvi(`email sent to ${a}`); }
        presa.write(prossimo + "\r\n");
      }
    });
  });
}

/* ------------------------------ protocollo MCP ------------------------------ */

const TOOLS = [
  {
    name: "invia_email",
    description: "Sends a plain-text email from the configured Gmail account (SMTP). Args: a (recipient address), oggetto (subject), testo (body).",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "string", description: "recipient email address" },
        oggetto: { type: "string", description: "subject" },
        testo: { type: "string", description: "plain text body" },
      },
      required: ["a", "oggetto", "testo"],
    },
  },
];

const rispondi = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
const rifiutaRPC = (id, messaggio) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: messaggio } }) + "\n");

const righe = createInterface({ input: process.stdin });
righe.on("line", async (riga) => {
  let m; try { m = JSON.parse(riga); } catch { return; }
  if (m.id === undefined || m.id === null) return; // notifiche: nessuna risposta
  try {
    if (m.method === "initialize") {
      return rispondi(m.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "galatea-gmail-smtp", version: "1.0.0" } });
    }
    if (m.method === "tools/list") return rispondi(m.id, { tools: TOOLS });
    if (m.method === "tools/call") {
      const { name, arguments: args } = m.params || {};
      if (name !== "invia_email") return rifiutaRPC(m.id, "unknown tool");
      const esito = await inviaSMTP(args || {});
      return rispondi(m.id, { content: [{ type: "text", text: esito }] });
    }
    return rifiutaRPC(m.id, "method not supported: " + m.method);
  } catch (e) {
    return rispondi(m.id, { content: [{ type: "text", text: "ERROR: " + (e.message || e) }], isError: true });
  }
});
