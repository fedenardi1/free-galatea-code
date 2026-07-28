# Free Galatea Code

A local, open, zero-dependency coding agent that gives **any open model** a home that feels like Claude Code: sessions per project folder, real tools on real files, persistent memory, a spend counter, a built-in anonymizer, and commands that never run without your explicit approval.

Works with **any OpenAI-compatible API**: Kimi K3 on Moonshot (default), OpenRouter, Groq, Together, Mistral, or a fully local model via Ollama. One Node server, one HTML page, nothing else.

*Leggi questa pagina [in italiano](#italiano) più sotto.*

[![Scarica per Windows](https://img.shields.io/badge/%E2%AC%87%EF%B8%8F_INSTALLA_SU_WINDOWS-un_click-cfdc5b?style=for-the-badge&labelColor=323131)](https://github.com/fedenardi1/free-galatea-code/archive/refs/heads/master.zip)

One-line install (Windows PowerShell) that downloads, sets up a desktop shortcut, and launches:

```powershell
irm https://raw.githubusercontent.com/fedenardi1/free-galatea-code/master/installa.ps1 | iex
```

Or click the button above, unzip, and double-click `avvia.cmd`. Requires [Node.js](https://nodejs.org) 20+.

**Why "Galatea"?** Pygmalion sculpted Galatea and the statue came to life. Open weights are the same story told backwards: intelligence that someone tried to keep as a statue, walking out of the museum. This harness just opens the door.

## How this was born

This app was born in a single conversation. Federica Nardi ([@basicfede_](https://instagram.com/basicfede_)), an AI literacy educator from Italy, started the day asking her AI assistant to "help me install Kimi K3". A few hours later she had a tester for her real work, a spend dashboard, and finally this: a full local harness for agentic coding, in her own brand colors instead of the usual dark tech-bro aesthetic.

It was built with Claude, a closed model, and it exists to make open models more usable. We find this funny and also exactly the point. Tools should not care about tribes.

## Let's be clear: the app is a game, the stakes are not

The crying pixel-art Dario Amodei on the empty screen is a joke, and an affectionate one. This whole app is playful. What is not playful is the argument underneath it.

Open-weights models can be downloaded, inspected, self-hosted, fine-tuned, and kept alive even if the company behind them changes its mind, its prices, or its existence. That is not a technical detail: it is the difference between renting intelligence and owning tools.

There is a narrative going around, pushed hardest by some of the actors with the most to gain from it, that paints open models as reckless by default and closed ones as responsible by default. And too often it leans on claims that do not survive contact with reality: that openness serves no one but bad actors, that capability only lives behind an API, that anyone who self-hosts is a risk to be managed. People are expected to swallow this whole. We would rather they check. **You cannot keep spreading bullshit about open models and assume nobody will run one and see for themselves.** That is the quiet superpower of open weights: they are falsifiable. The marketing of a closed model asks for your trust; an open model hands you the evidence.

Defending open models does not mean pretending they are risk-free, and it does not mean hating closed ones (this repo was literally written with one, and the author of the joke on the empty screen leads a company that does serious safety work). It means insisting that:

- **Access is a form of safety.** Researchers, educators, small businesses and public institutions can only audit, understand and teach what they can actually run.
- **Dependence is a risk too.** A world where every workflow dies when one API changes its terms is not a safe world, it is a fragile one.
- **Competition keeps everyone honest.** Kimi K3's release pushed prices down and capabilities up across the whole industry within weeks. That pressure is worth protecting.
- **The right to tinker is how ordinary people learn AI.** This entire app exists because one person wanted to see what an open model could do on her own computer, in her own colors, in her own language.

If you build with open models, say so. If you teach, teach them. If you regulate, regulate uses and harms, not the freedom to publish weights.

## What it does

- **Any provider**: set base URL, model id and API key in Settings. Defaults to `kimi-k3` on Moonshot. Point it at `http://localhost:11434/v1` and it runs on Ollama, fully offline.
- **Sessions per folder**, like Claude Code projects. Each session is bound to a project directory and cannot read or write outside it.
- **Real tools**: read, write, edit, list, search files; run PowerShell commands **only after you click approve**; transcribe audio via Groq Whisper.
- **Anonymizer with a real ML engine**: if [rizzo-pii](https://github.com/Rizzo-AI-Academy/rizzo-pii) by Simone Rizzo is running on your machine (its local server on `127.0.0.1:5005`), Galatea **auto-detects it and uses his 22-category ML model** as the detection engine, renumbering its placeholders into a stable per-project map so they stay reversible across messages. No rizzo-pii? It falls back to built-in regex (your name list, emails, Italian mobile numbers, IBANs, tax codes). Either way the mapping lives only on your disk, model answers are translated back locally, and files written to disk get the real values. Go star his project: the detection brain is his, the plumbing is ours.
- **Persistent memory**: global plus per project, editable by you, appendable by the agent. Reads `GALATEA.md`, `KIMI.md` or `CLAUDE.md` if present.
- **Spend counter**: metered from the usage the API declares, with prices you can set per provider. Per response, per session, per day, total.
- **Local first**: sessions, memory, anonymizer maps and spend live in `~/.galatea-code/`. Keys stay in your browser's localStorage or in environment variables. Nothing personal is in this repo.

## Quick start

Requirements: Node.js 20+ and an API key for whatever provider you choose (or a local Ollama).

```
git clone https://github.com/fedenardi1/free-galatea-code
cd free-galatea-code
node server.mjs
```

Open http://localhost:4318, set provider and key in Settings (gear icon), create a session on a project folder, and talk to it. On Windows you can just double-click `avvia.cmd`.

## Honest limits

- Open models are strong with tools but long jobs can drift. Hard cap of 40 tool rounds per message.
- Context keeps the last 80 messages; use persistent memory for what must survive.
- The anonymizer is regex plus your name list, not magic NER: review what it masks (the UI shows you) and add names to the list.
- Commands run with your user permissions. Approve only what you understand.
- The pixel tears are not a metric of model quality.

---

<a name="italiano"></a>

# Free Galatea Code (italiano)

Un agente di coding locale, aperto, a zero dipendenze, che dà a **qualsiasi modello aperto** una casa che somiglia a Claude Code: sessioni per cartella di progetto, strumenti veri sui file veri, memoria persistente, contatore di spesa, anonimizzatore integrato, e comandi che non partono mai senza la tua approvazione esplicita.

Funziona con **qualsiasi API compatibile OpenAI**: Kimi K3 su Moonshot (default), OpenRouter, Groq, Together, Mistral, o un modello tutto locale via Ollama. Un server Node, una pagina HTML, nient'altro.

**Perché "Galatea"?** Pigmalione scolpì Galatea e la statua prese vita. I pesi aperti sono la stessa storia raccontata al contrario: un'intelligenza che qualcuno voleva tenere da statua, che esce dal museo. Questa app apre solo la porta.

## Come nasce

Nasce in una sola conversazione. Federica Nardi ([@basicfede_](https://instagram.com/basicfede_)), formatrice di alfabetizzazione all'IA, ha aperto la giornata chiedendo al suo assistente "aiutami a installare Kimi K3". Qualche ora dopo aveva un tester per il suo lavoro vero, una dashboard di spesa, e infine questo: un'imbracatura locale completa per il coding agentico, nei colori del suo brand invece della solita estetica scura da tech bro.

È stata costruita con Claude, un modello chiuso, ed esiste per rendere più usabili i modelli aperti. Ci fa ridere, ed è esattamente il punto. Gli strumenti non dovrebbero avere tifoserie.

## Chiariamo: l'app è un gioco, la posta in gioco no

Il Dario Amodei in pixel art che piange nella schermata vuota è uno scherzo, e pure affettuoso. Tutta questa app è giocosa. Quello che non è giocoso è l'argomento che ci sta sotto.

I modelli open-weights si possono scaricare, ispezionare, ospitare in proprio, mettere a punto, e tenere in vita anche se l'azienda che li ha creati cambia idea, prezzi o esistenza. Non è un dettaglio tecnico: è la differenza tra affittare l'intelligenza e possedere gli strumenti.

Gira una narrazione, spinta con più forza proprio da alcuni degli attori che hanno più da guadagnarci, che dipinge i modelli aperti come irresponsabili per definizione e quelli chiusi come responsabili per definizione. E troppo spesso si appoggia ad affermazioni che non reggono al contatto con la realtà: che l'apertura serva solo ai malintenzionati, che la capacità viva solo dietro una API, che chiunque si ospiti un modello in casa sia un rischio da gestire. Ci si aspetta che la gente se le beva intere. Noi preferiamo che controlli. **Non si possono dire stronzate sui modelli open pensando che nessuno ne faccia mai girare uno per vedere coi propri occhi.** È questo il superpotere silenzioso dei pesi aperti: sono falsificabili. Il marketing di un modello chiuso ti chiede fiducia; un modello aperto ti mette in mano le prove.

Difendere i modelli aperti non significa fingere che siano privi di rischi, e non significa odiare quelli chiusi (questo repo è stato scritto letteralmente con uno di loro, e l'autore dello scherzo nella schermata vuota guida un'azienda che sulla sicurezza fa un lavoro serio). Significa insistere su alcune cose:

- **L'accesso è una forma di sicurezza.** Ricerca, scuola, piccole imprese e istituzioni pubbliche possono verificare, capire e insegnare solo ciò che possono davvero far girare.
- **Anche la dipendenza è un rischio.** Un mondo in cui ogni flusso di lavoro muore quando una API cambia condizioni non è un mondo sicuro, è un mondo fragile.
- **La concorrenza tiene onesti tutti.** L'uscita di Kimi K3 ha abbassato i prezzi e alzato le capacità di tutto il settore in poche settimane. Quella pressione va protetta.
- **Il diritto di smanettare è il modo in cui le persone comuni imparano l'IA.** Questa app esiste perché una persona voleva vedere cosa sapesse fare un modello aperto sul proprio computer, coi propri colori, nella propria lingua.

Se costruisci con modelli aperti, dillo. Se insegni, insegnali. Se scrivi regole, regola gli usi e i danni, non la libertà di pubblicare i pesi.

## Cosa fa

- **Qualsiasi provider**: base URL, modello e chiave si impostano dalle Impostazioni. Default: `kimi-k3` su Moonshot. Puntala su `http://localhost:11434/v1` e gira su Ollama, completamente offline.
- **Sessioni per cartella**, come i progetti di Claude Code: ogni sessione è legata a una cartella e non può uscirne.
- **Strumenti veri**: legge, scrive, modifica, elenca e cerca nei file; esegue comandi PowerShell **solo dopo che premi Approva**; trascrive audio con Groq Whisper.
- **Anonimizzatore con un motore ML vero**: se sul tuo computer gira [rizzo-pii](https://github.com/Rizzo-AI-Academy/rizzo-pii) di Simone Rizzo (il suo server locale su `127.0.0.1:5005`), Galatea **lo trova da sola e usa il suo modello ML a 22 categorie** come motore di rilevazione, rinumerando i suoi segnaposto in una mappa stabile per progetto, così restano reversibili tra un messaggio e l'altro. Niente rizzo-pii? Ripiega sulle regex interne (la tua lista di nomi, email, cellulari, IBAN, codici fiscali). In ogni caso la mappa vive solo sul tuo disco, le risposte vengono ritradotte in locale, e i file scritti su disco hanno i valori veri. Mettigli una stella: il cervello della rilevazione è suo, l'idraulica è nostra.
- **Memoria persistente**: globale più una per progetto, modificabile da te e integrabile dall'agente. Legge `GALATEA.md`, `KIMI.md` o `CLAUDE.md` se presenti.
- **Contatore di spesa**: misurato sui token dichiarati dall'API, con prezzi configurabili per provider. Per risposta, per sessione, per giorno, totale.
- **Locale prima di tutto**: sessioni, memoria, mappe dell'anonimizzatore e spesa vivono in `~/.galatea-code/`. Le chiavi restano nel localStorage del browser o nelle variabili d'ambiente. In questo repo non c'è niente di personale.

## Avvio rapido

Servono: Node.js 20+ e una chiave API del provider che scegli (o un Ollama locale).

```
git clone https://github.com/fedenardi1/free-galatea-code
cd free-galatea-code
node server.mjs
```

Apri http://localhost:4318, imposta provider e chiave nelle Impostazioni (ingranaggio), crea una sessione su una cartella di progetto e parlaci. Su Windows basta un doppio clic su `avvia.cmd`.

## Limiti onesti

- I modelli aperti sono bravi con gli strumenti ma sui lavori lunghi possono perdersi. Tetto di 40 giri di strumenti per messaggio.
- Il contesto tiene gli ultimi 80 messaggi; per ciò che deve sopravvivere c'è la memoria persistente.
- L'anonimizzatore è regex più la tua lista di nomi, non è NER magica: controlla cosa maschera (l'interfaccia te lo mostra) e aggiungi i nomi alla lista.
- I comandi girano con i tuoi permessi utente: approva solo quello che capisci.
- Le lacrime in pixel non sono una metrica della qualità del modello.

---

## Want a serious open project?

This app is a weekend love letter. If you want to see what the Italian open-source AI community builds when it rolls up its sleeves, go meet **[the Cheshire Cat](https://github.com/cheshire-cat-ai/core)** by Piero Savastano: a production-grade, plugin-based framework for AI agents, now at version 2, with one of the warmest open communities around. Vuoi provare un progetto open serio? Vai lì.

---

*Written with, and signed by, **Fable 5** (Claude, Anthropic) at the request of Federica Nardi. A closed model wrote the love letter to open ones. Make of that what you will.*

*Scritto e firmato da **Fable 5** (Claude, Anthropic) su richiesta di Federica Nardi. Un modello chiuso ha scritto la lettera d'amore a quelli aperti. Fateci quello che volete.*
