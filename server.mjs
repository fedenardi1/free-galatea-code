// FREE GALATEA CODE - agente di coding locale, in stile Claude Code, per QUALSIASI
// modello con API compatibile OpenAI (Moonshot, OpenRouter, Groq, Ollama, Together...).
// Zero dipendenze: gira col Node di sistema. I dati stanno in ~\.galatea-code\
//
// Cosa fa:
//  - sessioni separate per cartella di progetto (come i progetti di Claude Code)
//  - agente con strumenti veri sui file della cartella (leggi, scrivi, modifica, cerca)
//  - comandi PowerShell SOLO dietro conferma esplicita nell'interfaccia
//  - memoria persistente: globale + per progetto, che l'agente puo' aggiornare da solo
//  - contatore di spesa per sessione, per giorno e totale (prezzi configurabili)
//  - ANONIMIZZATORE: pseudonimizzazione reversibile in locale, ispirata all'approccio
//    mostrato da Simone Rizzo (Inferentia). I dati veri restano sul tuo disco, al
//    modello arrivano segnaposto tipo {{PERSONA_1}}; le risposte vengono ritradotte.
//  - trascrizione audio con Groq (se metti la chiave)

import { createServer } from "node:http";
import { readFile, writeFile, mkdir, readdir, stat, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve, dirname, relative } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";

const QUI = dirname(fileURLToPath(import.meta.url));
const PORTA = process.env.PORT || 4318;
const DATI = join(homedir(), ".galatea-code");
const DIR_SESSIONI = join(DATI, "sessioni");
const DIR_MEMORIA = join(DATI, "memoria");
const DIR_ANONIMI = join(DATI, "anonimi");
const FILE_CONSUMI = join(DATI, "consumi.json");

// difetti: Kimi K3 su Moonshot; dall'interfaccia puoi puntare qualunque endpoint
const API_DEFAULT = "https://api.moonshot.ai/v1";
const MODELLO_DEFAULT = "kimi-k3";
const PREZZI_DEFAULT = { inputMiss: 3.0, inputHit: 0.3, output: 15.0 }; // $/M token
const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const MAX_GIRI = 40;
const MAX_MESSAGGI = 80;

await mkdir(DIR_SESSIONI, { recursive: true });
await mkdir(DIR_MEMORIA, { recursive: true });
await mkdir(DIR_ANONIMI, { recursive: true });

/* ------------------------------------------------------------------ utilita */

const slug = (s) => createHash("sha1").update(String(s).toLowerCase()).digest("hex").slice(0, 12);

function json(res, codice, dati) {
  res.writeHead(codice, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(dati));
}
const err = (res, messaggio, codice = 400) => json(res, codice, { errore: messaggio });

async function corpoJSON(req) {
  const pezzi = [];
  for await (const p of req) pezzi.push(p);
  return JSON.parse(Buffer.concat(pezzi).toString("utf8") || "{}");
}

async function leggiJSON(percorso, difetto) {
  try { return JSON.parse(await readFile(percorso, "utf8")); } catch { return difetto; }
}
const salvaJSON = (percorso, dati) => writeFile(percorso, JSON.stringify(dati, null, 2), "utf8");

const oggiIT = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());

/** Configurazione del provider: arriva dall'interfaccia a ogni richiesta. */
function configModello(req) {
  let prezzi = PREZZI_DEFAULT;
  try { prezzi = { ...PREZZI_DEFAULT, ...JSON.parse(req.headers["x-prezzi"] || "{}") }; } catch {}
  return {
    chiave: req.headers["x-api-key"] || process.env.GALATEA_API_KEY || process.env.MOONSHOT_API_KEY || "",
    base: String(req.headers["x-base-url"] || API_DEFAULT).replace(/\/+$/, ""),
    modello: req.headers["x-model"] || MODELLO_DEFAULT,
    prezzi,
  };
}

/* ------------------------------------------------------------------ sessioni */

const fileSessione = (id) => join(DIR_SESSIONI, id + ".json");

async function elencaSessioni() {
  const voci = (await readdir(DIR_SESSIONI)).filter((f) => f.endsWith(".json"));
  const fuori = [];
  for (const v of voci) {
    const s = await leggiJSON(join(DIR_SESSIONI, v), null);
    if (s) fuori.push({ id: s.id, nome: s.nome, cartella: s.cartella, creato: s.creato, ultimoUso: s.ultimoUso, costo: s.costo || 0, nMessaggi: (s.eventi || []).length });
  }
  return fuori.sort((a, b) => (b.ultimoUso || 0) - (a.ultimoUso || 0));
}

/* ------------------------------------------------------------------- memoria */

const fileMemoriaProgetto = (cartella) => join(DIR_MEMORIA, slug(cartella) + ".md");
const FILE_MEMORIA_GLOBALE = join(DATI, "MEMORIA.md");

async function leggiMemoria(cartella) {
  let globale = "", progetto = "";
  try { globale = await readFile(FILE_MEMORIA_GLOBALE, "utf8"); } catch {}
  try { progetto = await readFile(fileMemoriaProgetto(cartella), "utf8"); } catch {}
  return { globale, progetto };
}

/* -------------------------------------------------------------- anonimizzatore */
/* Pseudonimizzazione reversibile per progetto. La mappa segnaposto->valore vero
   vive SOLO in locale (~\.galatea-code\anonimi\). Al modello arrivano i segnaposto;
   quando il modello scrive file o comandi, i segnaposto tornano valori veri. */

// le chat senza cartella condividono una mappa unica "__chat__"
const chiaveAnon = (cartella) => cartella || "__chat__";
const fileAnonimi = (cartella) => join(DIR_ANONIMI, slug(chiaveAnon(cartella)) + ".json");
const caricaAnonimi = (cartella) => leggiJSON(fileAnonimi(cartella), { mappa: {}, contatori: {} });

function segnaposto(stato, tipo, valore) {
  for (const [seg, val] of Object.entries(stato.mappa)) {
    if (val.toLowerCase() === String(valore).toLowerCase()) return seg;
  }
  stato.contatori[tipo] = (stato.contatori[tipo] || 0) + 1;
  const seg = `{{${tipo}_${stato.contatori[tipo]}}}`;
  stato.mappa[seg] = String(valore);
  return seg;
}

/* Se rizzo-pii (github.com/Rizzo-AI-Academy/rizzo-pii) gira in locale, usiamo il SUO
   motore ML per trovare i dati personali: 22 categorie, molto oltre le nostre regex.
   I suoi segnaposto per-chiamata vengono rinumerati nella nostra mappa stabile di
   progetto, cosi' restano reversibili tra un messaggio e l'altro. */
const RIZZO_URL_DEFAULT = "http://127.0.0.1:5005";

async function rizzoVivo(urlBase) {
  try {
    await fetch(urlBase + "/config", { signal: AbortSignal.timeout(1000) });
    return true;
  } catch { return false; }
}

async function anonimizzaConRizzo(urlBase, testo, stato) {
  const r = await fetch(urlBase + "/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: testo }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error("rizzo-pii " + r.status);
  const d = await r.json();
  let anon = d.anonymized_text ?? testo;
  for (const [suo, valore] of Object.entries(d.mapping || {})) {
    const tipo = suo.match(/^\[([A-Z_]+)_\d+\]$/)?.[1] || "DATO";
    const nostro = segnaposto(stato, tipo, valore);
    anon = anon.split(suo).join(nostro);
  }
  return anon;
}

/* L'anonimizzazione E' rizzo-pii: nessuna implementazione nostra di rilevazione.
   Se l'anonimizzatore e' acceso ma rizzo-pii non gira, ci si ferma con un errore
   chiaro invece di fingere una protezione che non c'e'. */
async function anonimizza(testo, stato, rizzoUrl) {
  if (!testo || !stato) return testo;
  if (!rizzoUrl) {
    throw new Error("Anonymizer is ON but rizzo-pii is not running on 127.0.0.1:5005. Start it, install it from github.com/Rizzo-AI-Academy/rizzo-pii, or turn the anonymizer off.");
  }
  return anonimizzaConRizzo(rizzoUrl, String(testo), stato);
}

function deanonimizza(testo, stato) {
  if (!testo || !stato) return testo;
  let t = String(testo);
  for (const [seg, val] of Object.entries(stato.mappa)) t = t.split(seg).join(val);
  return t;
}

/* ------------------------------------------------------------------- consumi */

async function registraConsumo(sessioneId, uso, prezzi) {
  const input = uso?.prompt_tokens || 0;
  const cache = Math.min(input, uso?.prompt_cache_hit_tokens ?? uso?.prompt_tokens_details?.cached_tokens ?? 0);
  const output = uso?.completion_tokens || 0;
  const costo = ((input - cache) / 1e6) * prezzi.inputMiss + (cache / 1e6) * prezzi.inputHit + (output / 1e6) * prezzi.output;

  const c = await leggiJSON(FILE_CONSUMI, { totale: 0, giorni: {}, sessioni: {} });
  c.totale += costo;
  const g = oggiIT();
  c.giorni[g] = (c.giorni[g] || 0) + costo;
  c.sessioni[sessioneId] = (c.sessioni[sessioneId] || 0) + costo;
  await salvaJSON(FILE_CONSUMI, c);
  return { costo, input, cache, output, totale: c.totale, oggi: c.giorni[g], sessione: c.sessioni[sessioneId] };
}

/* ------------------------------------------------- strumenti dentro la cartella */

function percorsoSicuro(cartella, p) {
  const abs = resolve(cartella, p || ".");
  const radice = resolve(cartella);
  if (abs !== radice && !abs.startsWith(radice + "\\") && !abs.startsWith(radice + "/")) {
    throw new Error(`Path outside the project folder: ${p}`);
  }
  return abs;
}

const IGNORA = new Set(["node_modules", ".git", ".wrangler", "__pycache__", "dist", "build", ".venv", "venv"]);

async function albero(base, dir, profondita, righe) {
  if (profondita > 4 || righe.length > 300) return;
  let voci;
  try { voci = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const v of voci.sort((a, b) => a.name.localeCompare(b.name))) {
    if (IGNORA.has(v.name)) continue;
    const rel = relative(base, join(dir, v.name));
    if (v.isDirectory()) { righe.push(rel + "\\"); await albero(base, join(dir, v.name), profondita + 1, righe); }
    else righe.push(rel);
  }
}

async function cercaTesto(base, dir, pattern, righe, profondita = 0) {
  if (profondita > 5 || righe.length >= 60) return;
  let voci;
  try { voci = await readdir(dir, { withFileTypes: true }); } catch { return; }
  const re = new RegExp(pattern, "i");
  for (const v of voci) {
    if (IGNORA.has(v.name)) continue;
    const pieno = join(dir, v.name);
    if (v.isDirectory()) { await cercaTesto(base, pieno, pattern, righe, profondita + 1); continue; }
    const s = await stat(pieno).catch(() => null);
    if (!s || s.size > 1_500_000) continue;
    let testo;
    try { testo = await readFile(pieno, "utf8"); } catch { continue; }
    if (testo.includes(" ")) continue;
    const ll = testo.split("\n");
    for (let i = 0; i < ll.length && righe.length < 60; i++) {
      if (re.test(ll[i])) righe.push(`${relative(base, pieno)}:${i + 1}: ${ll[i].trim().slice(0, 200)}`);
    }
  }
}

function eseguiComando(comando, cwd, segnale) {
  return new Promise((risolvi) => {
    const proc = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", comando], { cwd, signal: segnale });
    let fuori = "";
    const raccogli = (d) => { if (fuori.length < 30000) fuori += d.toString("utf8"); };
    proc.stdout.on("data", raccogli);
    proc.stderr.on("data", raccogli);
    const timer = setTimeout(() => proc.kill(), 120_000);
    proc.on("close", (codice) => { clearTimeout(timer); risolvi(`exit ${codice}\n${fuori.slice(0, 25000)}`); });
    proc.on("error", (e) => { clearTimeout(timer); risolvi(`failed to start: ${e.message}`); });
  });
}

const STRUMENTI = [
  { type: "function", function: { name: "leggi_file", description: "Reads a text file from the project folder. Use da_riga/quante_righe for large files.", parameters: { type: "object", properties: { percorso: { type: "string" }, da_riga: { type: "integer" }, quante_righe: { type: "integer" } }, required: ["percorso"] } } },
  { type: "function", function: { name: "scrivi_file", description: "Creates or overwrites a file in the project folder (creates subfolders too).", parameters: { type: "object", properties: { percorso: { type: "string" }, contenuto: { type: "string" } }, required: ["percorso", "contenuto"] } } },
  { type: "function", function: { name: "modifica_file", description: "Replaces EXACTLY one occurrence of 'cerca' with 'sostituisci' in a file. 'cerca' must be unique in the file.", parameters: { type: "object", properties: { percorso: { type: "string" }, cerca: { type: "string" }, sostituisci: { type: "string" } }, required: ["percorso", "cerca", "sostituisci"] } } },
  { type: "function", function: { name: "elenca_cartella", description: "Lists files and subfolders of the project (max 4 levels).", parameters: { type: "object", properties: { percorso: { type: "string" } } } } },
  { type: "function", function: { name: "cerca_testo", description: "Searches a regex in the project's text files. Returns file:line for the first 60 matches.", parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } } },
  { type: "function", function: { name: "esegui_comando", description: "Runs a PowerShell command in the project folder. The user must APPROVE it in the UI before it runs: propose short commands and explain why in your text.", parameters: { type: "object", properties: { comando: { type: "string" } }, required: ["comando"] } } },
  { type: "function", function: { name: "salva_memoria", description: "Appends a note to persistent memory. ambito 'progetto' = this folder only, 'globale' = all sessions. Use it for stable user preferences and durable project facts, not for current work.", parameters: { type: "object", properties: { testo: { type: "string" }, ambito: { type: "string", enum: ["progetto", "globale"] } }, required: ["testo"] } } },
  { type: "function", function: { name: "trascrivi_audio", description: "Transcribes an audio file from the folder with Groq Whisper (needs the Groq key, max 25 MB).", parameters: { type: "object", properties: { percorso: { type: "string" } }, required: ["percorso"] } } },
];

async function usaStrumento(nome, args, ctx) {
  const { cartella, chiaveGroq, chiediConferma, anon } = ctx;
  // quello che il modello manda puo' contenere segnaposto: sui file e nei comandi
  // devono tornare i valori veri, perche' il disco e' tuo, non del modello
  const vero = (t) => (anon ? deanonimizza(t, anon) : t);
  // quello che torna al modello va invece ri-anonimizzato (Promise: il chiamante attende)
  const mascherato = (t) => (anon ? anonimizza(t, anon, ctx.rizzoUrl) : t);

  switch (nome) {
    case "leggi_file": {
      const p = percorsoSicuro(cartella, args.percorso);
      const testo = await readFile(p, "utf8");
      const righe = testo.split("\n");
      const da = Math.max(0, (args.da_riga || 1) - 1);
      const quante = Math.min(args.quante_righe || 1500, 3000);
      const fetta = righe.slice(da, da + quante);
      const fuori = fetta.map((r, i) => `${da + i + 1}\t${r}`).join("\n").slice(0, 120_000) + (righe.length > da + quante ? `\n... (${righe.length} righe totali)` : "");
      return mascherato(fuori);
    }
    case "scrivi_file": {
      const p = percorsoSicuro(cartella, args.percorso);
      await mkdir(dirname(p), { recursive: true });
      const contenuto = vero(args.contenuto);
      await writeFile(p, contenuto, "utf8");
      return `wrote ${args.percorso} (${contenuto.length} chars)`;
    }
    case "modifica_file": {
      const p = percorsoSicuro(cartella, args.percorso);
      const testo = await readFile(p, "utf8");
      const cerca = vero(args.cerca), sostituisci = vero(args.sostituisci);
      const n = testo.split(cerca).length - 1;
      if (n === 0) return "ERROR: search text not found in file";
      if (n > 1) return `ERROR: search text appears ${n} times, it must be unique`;
      await writeFile(p, testo.replace(cerca, sostituisci), "utf8");
      return "edit applied";
    }
    case "elenca_cartella": {
      const p = percorsoSicuro(cartella, args.percorso || ".");
      const righe = [];
      await albero(p, p, 0, righe);
      return mascherato(righe.join("\n") || "(empty)");
    }
    case "cerca_testo": {
      const righe = [];
      await cercaTesto(cartella, cartella, vero(args.pattern), righe);
      return mascherato(righe.join("\n") || "no results");
    }
    case "esegui_comando": {
      const comandoVero = vero(args.comando);
      const ok = await chiediConferma(comandoVero);
      if (!ok) return "The user DENIED this command. Do not retry the same command: ask what they prefer.";
      return mascherato(await eseguiComando(comandoVero, cartella, ctx.segnale));
    }
    case "salva_memoria": {
      const dest = args.ambito === "globale" ? FILE_MEMORIA_GLOBALE : fileMemoriaProgetto(cartella);
      const prima = existsSync(dest) ? await readFile(dest, "utf8") : "";
      await writeFile(dest, prima + (prima ? "\n" : "") + `- ${vero(args.testo)}  _( ${oggiIT()} )_`, "utf8");
      return "memory updated";
    }
    case "trascrivi_audio": {
      if (!chiaveGroq) return "ERROR: Groq key missing in settings";
      const p = percorsoSicuro(cartella, args.percorso);
      const buf = await readFile(p);
      if (buf.length > 25 * 1024 * 1024) return "ERROR: file over 25 MB, Groq's limit";
      const modulo = new FormData();
      modulo.append("file", new Blob([buf]), args.percorso.split(/[\\/]/).pop());
      modulo.append("model", "whisper-large-v3-turbo");
      modulo.append("language", "it");
      modulo.append("response_format", "text");
      const r = await fetch(GROQ_URL, { method: "POST", headers: { authorization: `Bearer ${chiaveGroq}` }, body: modulo });
      const testo = await r.text();
      return r.ok ? mascherato(testo.slice(0, 100_000)) : `ERROR Groq ${r.status}: ${testo.slice(0, 300)}`;
    }
    default:
      return `unknown tool: ${nome}`;
  }
}

/* -------------------------------------------------------------- prompt sistema */

async function promptSistema(cartella, anonAttivo) {
  const { globale, progetto } = await leggiMemoria(cartella || "");

  const notaAnonChat = anonAttivo ? `

## Anonymizer active
Personal data is pseudonymized with placeholders like {{PERSONA_1}}. Treat them as proper nouns and REPEAT THEM VERBATIM: they are replaced with the real values locally. Never try to guess the real values.` : "";

  // chat pura, senza cartella: niente strumenti, solo conversazione
  if (!cartella) {
    return `You are Galatea (Free Galatea Code), a helpful assistant running locally on the user's computer.
Date: ${oggiIT()}

Rules:
- Reply in the user's language. Be concise and concrete. Never use em dashes.
- This is a plain chat with no project folder: you have no file tools here. If the user asks you to create, read or edit files, explain that chats have no tools by design, and that they should create a session on a folder (left sidebar, folder icon then "New session"): there you get full file tools, limited to that folder.${notaAnonChat}

## Global memory
${globale || "(empty)"}`;
  }

  let istruzioniProgetto = "";
  for (const nome of ["GALATEA.md", "KIMI.md", "CLAUDE.md"]) {
    try { istruzioniProgetto = `\n\n## Istruzioni del progetto (${nome})\n${await readFile(join(cartella, nome), "utf8")}`; break; } catch {}
  }
  const notaAnon = anonAttivo ? `

## Anonymizer active
Personal data in this session is pseudonymized: you will see placeholders like {{PERSONA_1}}, {{EMAIL_2}}, {{TELEFONO_1}}. They are opaque identifiers: treat them as proper nouns and REPEAT THEM VERBATIM, character by character, wherever needed. They are replaced with the real values locally, on the user's computer. Never try to guess the real values and never alter a placeholder.` : "";

  return `You are Galatea (Free Galatea Code), a coding agent working LOCALLY on the user's computer (Windows, PowerShell).
Project folder: ${cartella}
Date: ${oggiIT()}

Rules:
- Reply in the user's language. Be concise and concrete. Never use em dashes.
- Use the tools to look at files BEFORE talking about them: never invent contents you have not read.
- Paths are always relative to the project folder. You cannot leave it.
- Use modifica_file for small edits, scrivi_file for new files or rewrites.
- Commands (esegui_comando) only run if the user approves them: propose them one at a time and explain what they are for.
- When you learn a stable user preference or a durable fact about the project, save it with salva_memoria.
- When you finish a piece of work, summarize in a few lines what you touched.${notaAnon}${istruzioniProgetto}

## Global memory
${globale || "(empty)"}

## Memory for this project
${progetto || "(empty)"}`;
}

/* --------------------------------------------------------------- giro agente */

const attese = new Map();
const inCorso = new Map();

async function giroAgente(req, res, sessione, messaggioUtente) {
  const cfg = configModello(req);
  const chiaveGroq = req.headers["x-groq-key"] || process.env.GROQ_API_KEY || "";
  if (!cfg.chiave) { json(res, 400, { errore: "Missing API key: set it in Settings (gear icon)." }); return; }

  const anonAttivo = req.headers["x-anonimizza"] === "1";
  const anon = anonAttivo ? await caricaAnonimi(sessione.cartella) : null;

  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" });
  const manda = (ev) => { try { res.write(`data: ${JSON.stringify(ev)}\n\n`); } catch {} };

  const controllore = new AbortController();
  inCorso.set(sessione.id, controllore);

  // il motore di anonimizzazione E' rizzo-pii: se manca, ci si ferma subito e chiaro
  const rizzoBase = req.headers["x-rizzo-url"] || process.env.RIZZO_PII_URL || RIZZO_URL_DEFAULT;
  const usaRizzo = anon ? await rizzoVivo(rizzoBase) : false;
  const rizzoUrl = usaRizzo ? rizzoBase : null;
  if (anonAttivo && !usaRizzo) {
    manda({ t: "errore", v: "Anonymizer is ON but rizzo-pii is not running on 127.0.0.1:5005. Start it, install it from github.com/Rizzo-AI-Academy/rizzo-pii, or turn the anonymizer off. Nothing was sent." });
    manda({ t: "fine" });
    inCorso.delete(sessione.id);
    res.end();
    return;
  }

  const eventiNuovi = [{ t: "utente", v: messaggioUtente, ts: Date.now() }];
  const perModello = anon ? await anonimizza(messaggioUtente, anon, rizzoUrl) : messaggioUtente;
  if (anon) {
    manda({ t: "anon", v: `${Object.keys(anon.mappa).length} values masked - engine: rizzo-pii (local)` });
  }
  sessione.messaggi.push({ role: "user", content: perModello });

  const ctx = {
    cartella: sessione.cartella,
    chiaveGroq,
    anon,
    rizzoUrl,
    segnale: controllore.signal,
    chiediConferma: (comando) => new Promise((risolvi) => {
      const id = randomUUID();
      attese.set(id, risolvi);
      manda({ t: "conferma", id, comando });
      setTimeout(() => { if (attese.has(id)) { attese.delete(id); risolvi(false); } }, 300_000);
    }),
  };

  try {
    for (let giro = 0; giro < MAX_GIRI; giro++) {
      const messaggi = [{ role: "system", content: await promptSistema(sessione.cartella, anonAttivo) },
        ...sessione.messaggi.slice(-MAX_MESSAGGI)];

      // nelle chat senza cartella niente strumenti: solo conversazione
      const corpo = { model: cfg.modello, stream: true, stream_options: { include_usage: true }, messages: messaggi };
      if (sessione.cartella) corpo.tools = STRUMENTI;

      const r = await fetch(`${cfg.base}/chat/completions`, {
        method: "POST",
        signal: controllore.signal,
        headers: { authorization: `Bearer ${cfg.chiave}`, "content-type": "application/json" },
        body: JSON.stringify(corpo),
      });
      if (!r.ok) { const t = await r.text(); manda({ t: "errore", v: `API ${r.status}: ${t.slice(0, 500)}` }); break; }

      let testo = "", uso = null, fine = null;
      const chiamate = [];
      const dec = new TextDecoder(); let resto = "";
      for await (const pezzo of r.body) {
        resto += dec.decode(pezzo, { stream: true });
        const righe = resto.split("\n"); resto = righe.pop();
        for (const riga of righe) {
          if (!riga.startsWith("data:")) continue;
          const carico = riga.slice(5).trim();
          if (!carico || carico === "[DONE]") continue;
          let ev; try { ev = JSON.parse(carico); } catch { continue; }
          if (ev.usage) uso = ev.usage;
          const scelta = ev.choices?.[0];
          if (!scelta) continue;
          if (scelta.finish_reason) fine = scelta.finish_reason;
          const d = scelta.delta || {};
          if (d.reasoning_content) manda({ t: "pensiero", v: d.reasoning_content });
          if (d.content) { testo += d.content; manda({ t: "testo", v: d.content }); }
          for (const tc of d.tool_calls || []) {
            const i = tc.index ?? 0;
            chiamate[i] = chiamate[i] || { id: tc.id || randomUUID(), function: { name: "", arguments: "" }, type: "function" };
            if (tc.id) chiamate[i].id = tc.id;
            if (tc.function?.name) chiamate[i].function.name += tc.function.name;
            if (tc.function?.arguments) chiamate[i].function.arguments += tc.function.arguments;
          }
        }
      }

      if (uso) {
        const c = await registraConsumo(sessione.id, uso, cfg.prezzi);
        sessione.costo = c.sessione;
        manda({ t: "uso", ...c });
      }
      if (testo) {
        // al modello restano i segnaposto, a te arriva il testo coi valori veri
        const inChiaro = anon ? deanonimizza(testo, anon) : testo;
        if (anon && inChiaro !== testo) manda({ t: "testo_pieno", v: inChiaro });
        eventiNuovi.push({ t: "assistente", v: inChiaro, ts: Date.now() });
      }

      const vive = chiamate.filter(Boolean);
      if (!vive.length || fine === "stop") {
        sessione.messaggi.push({ role: "assistant", content: testo || "" });
        break;
      }

      sessione.messaggi.push({ role: "assistant", content: testo || null, tool_calls: vive });
      for (const tc of vive) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
        manda({ t: "tool", nome: tc.function.name, input: args });
        let esito;
        try { esito = await usaStrumento(tc.function.name, args, ctx); }
        catch (e) { esito = `ERROR: ${e.message}`; }
        manda({ t: "tool_fine", nome: tc.function.name, output: String(esito).slice(0, 4000) });
        eventiNuovi.push({ t: "tool", nome: tc.function.name, input: args, output: String(esito).slice(0, 4000), ts: Date.now() });
        sessione.messaggi.push({ role: "tool", tool_call_id: tc.id, content: String(esito).slice(0, 60_000) });
      }
    }
  } catch (e) {
    if (e.name !== "AbortError") manda({ t: "errore", v: String(e.message || e) });
    else manda({ t: "errore", v: "stopped by user" });
  } finally {
    inCorso.delete(sessione.id);
    if (anon) await salvaJSON(fileAnonimi(sessione.cartella), anon);
    sessione.eventi.push(...eventiNuovi);
    sessione.ultimoUso = Date.now();
    await salvaJSON(fileSessione(sessione.id), sessione);
    manda({ t: "fine" });
    res.end();
  }
}

/* -------------------------------------------------------------------- routing */

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORTA}`);
  const p = url.pathname;

  try {
    if (p === "/" || p === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(await readFile(join(QUI, "public", "index.html")));
    }

    if (p === "/api/sessioni" && req.method === "GET") return json(res, 200, { sessioni: await elencaSessioni() });

    if (p === "/api/sessioni" && req.method === "POST") {
      const { cartella, nome, chat } = await corpoJSON(req);

      // chat pura: nessuna cartella, nessuno strumento
      if (chat) {
        const sessione = { id: randomUUID(), nome: nome || `Chat ${new Date().toLocaleDateString("en-GB")}`, cartella: null, creato: Date.now(), ultimoUso: Date.now(), costo: 0, messaggi: [], eventi: [] };
        await salvaJSON(fileSessione(sessione.id), sessione);
        return json(res, 200, { sessione: { id: sessione.id, nome: sessione.nome, cartella: null } });
      }

      // Windows "copia come percorso" incolla le virgolette attorno: via
      const abs = resolve(String(cartella || "").trim().replace(/^"+|"+$/g, ""));
      if (!existsSync(abs)) return err(res, `Folder does not exist: ${abs}`);
      const s = await stat(abs);
      if (!s.isDirectory()) return err(res, "Path is not a folder");
      const sessione = { id: randomUUID(), nome: nome || abs.split(/[\\/]/).pop(), cartella: abs, creato: Date.now(), ultimoUso: Date.now(), costo: 0, messaggi: [], eventi: [] };
      await salvaJSON(fileSessione(sessione.id), sessione);
      return json(res, 200, { sessione: { id: sessione.id, nome: sessione.nome, cartella: abs } });
    }

    const mSess = p.match(/^\/api\/sessioni\/([\w-]+)$/);
    if (mSess && req.method === "GET") {
      const s = await leggiJSON(fileSessione(mSess[1]), null);
      if (!s) return err(res, "session not found", 404);
      return json(res, 200, { id: s.id, nome: s.nome, cartella: s.cartella, eventi: s.eventi, costo: s.costo || 0, occupata: inCorso.has(s.id) });
    }
    if (mSess && req.method === "DELETE") {
      const f = fileSessione(mSess[1]);
      if (existsSync(f)) await rename(f, f + ".cestino");
      return json(res, 200, { ok: true });
    }

    if (p === "/api/chat" && req.method === "POST") {
      const { sessioneId, messaggio } = await corpoJSON(req);
      const sessione = await leggiJSON(fileSessione(sessioneId), null);
      if (!sessione) return err(res, "session not found", 404);
      if (inCorso.has(sessioneId)) return err(res, "this session is already working: wait or press Stop", 409);
      if (!messaggio?.trim()) return err(res, "empty message");
      return giroAgente(req, res, sessione, messaggio.trim());
    }

    if (p === "/api/stop" && req.method === "POST") {
      const { sessioneId } = await corpoJSON(req);
      inCorso.get(sessioneId)?.abort();
      return json(res, 200, { ok: true });
    }

    if (p === "/api/conferma" && req.method === "POST") {
      const { id, approvato } = await corpoJSON(req);
      const risolvi = attese.get(id);
      if (!risolvi) return err(res, "request expired or already decided", 404);
      attese.delete(id);
      risolvi(!!approvato);
      return json(res, 200, { ok: true });
    }

    /* sfoglia le cartelle del disco, per il selettore nell'interfaccia */
    if (p === "/api/cartelle" && req.method === "GET") {
      const richiesto = String(url.searchParams.get("path") || homedir()).trim().replace(/^"+|"+$/g, "");
      const abs = resolve(richiesto);
      let sotto = [];
      try {
        sotto = (await readdir(abs, { withFileTypes: true }))
          .filter((v) => v.isDirectory() && !v.name.startsWith(".") && !["node_modules", "$RECYCLE.BIN", "System Volume Information"].includes(v.name))
          .map((v) => v.name)
          .sort((a, b) => a.localeCompare(b));
      } catch (e) {
        return err(res, "Cannot open folder: " + e.message);
      }
      const casa = homedir();
      return json(res, 200, {
        path: abs,
        padre: dirname(abs),
        cartelle: sotto,
        scorciatoie: [
          { nome: "Home", path: casa },
          { nome: "Desktop", path: join(casa, "Desktop") },
          { nome: "Documents", path: join(casa, "Documents") },
          { nome: "Downloads", path: join(casa, "Downloads") },
        ].filter((s) => existsSync(s.path)),
      });
    }

    if (p === "/api/spesa" && req.method === "GET") {
      const c = await leggiJSON(FILE_CONSUMI, { totale: 0, giorni: {}, sessioni: {} });
      return json(res, 200, { totale: c.totale, oggi: c.giorni[oggiIT()] || 0, giorni: c.giorni });
    }

    if (p === "/api/memoria" && req.method === "GET") {
      return json(res, 200, await leggiMemoria(url.searchParams.get("cartella") || ""));
    }
    if (p === "/api/memoria" && req.method === "POST") {
      const { cartella, ambito, testo } = await corpoJSON(req);
      const dest = ambito === "globale" ? FILE_MEMORIA_GLOBALE : fileMemoriaProgetto(cartella);
      await writeFile(dest, testo ?? "", "utf8");
      return json(res, 200, { ok: true });
    }

    /* stato dell'anonimizzatore: rizzo-pii raggiungibile? quanti valori in mappa? */
    if (p === "/api/anonimi" && req.method === "GET") {
      const stato = await caricaAnonimi(url.searchParams.get("cartella") || "");
      const base = process.env.RIZZO_PII_URL || RIZZO_URL_DEFAULT;
      return json(res, 200, { mascherati: Object.keys(stato.mappa).length, rizzo: await rizzoVivo(base), rizzoUrl: base });
    }

    if (p === "/api/verifica" && req.method === "POST") {
      const cfg = configModello(req);
      if (!cfg.chiave) return err(res, "no key");
      const r = await fetch(`${cfg.base}/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${cfg.chiave}`, "content-type": "application/json" }, body: JSON.stringify({ model: cfg.modello, max_tokens: 16, messages: [{ role: "user", content: "di solo: ok" }] }) });
      const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = {}; }
      return json(res, r.ok ? 200 : r.status, r.ok ? { ok: true, modello: d.model || cfg.modello } : { ok: false, messaggio: d?.error?.message || t.slice(0, 200) });
    }

    err(res, "not found", 404);
  } catch (e) {
    if (!res.headersSent) err(res, String(e.message || e), 500);
    else res.end();
  }
});

server.listen(PORTA, "127.0.0.1", () => {
  console.log("");
  console.log("  FREE GALATEA CODE");
  console.log(`  Aperta su   http://localhost:${PORTA}`);
  console.log(`  Difetti     ${MODELLO_DEFAULT} su ${API_DEFAULT}  -  dati in ${DATI}`);
  console.log("  Ferma con Ctrl+C");
  console.log("");
});
