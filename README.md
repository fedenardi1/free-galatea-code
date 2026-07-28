# Kimi Code

A local, open, single-file coding agent that turns **Kimi K3** (Moonshot AI's open-weights model) into something that feels like Claude Code: sessions per project folder, real tools on real files, persistent memory, a spend counter, and commands that never run without your explicit approval.

Zero dependencies. One Node server, one HTML page. Your files never leave your machine except for the prompts you send to the model API.

*Leggi questa pagina [in italiano](#italiano) più sotto.*

![style](https://img.shields.io/badge/style-basicfede-cfdc5b) ![model](https://img.shields.io/badge/model-kimi--k3-e7ccef) ![deps](https://img.shields.io/badge/dependencies-zero-fcfcfc)

## How this was born

This app was born in a single conversation. Federica Nardi ([@basicfede_](https://instagram.com/basicfede_)), an AI literacy educator from Italy, started the day asking her AI assistant to "help me install Kimi K3". A few hours later she had a tester for her real work (Instagram editorial plans), a spend dashboard, and finally this: a full local harness that lets an open-weights model do agentic coding on her machine, with an interface in her own brand colors instead of the usual dark tech-bro aesthetic.

It was built with Claude, a closed model, and it exists to make an open model more usable. We find this funny and also exactly the point. Tools should not care about tribes.

The crying pixel-art Dario Amodei on the empty screen is affectionate satire. We assume he will survive.

## Why open models deserve defending

Open-weights models like Kimi K3 can be downloaded, inspected, self-hosted, fine-tuned, and kept running even if the company behind them changes its mind, its prices, or its existence. That is not a technical detail. It is the difference between renting intelligence and owning tools.

There is a growing narrative, pushed hardest by some of the companies with the most to gain from it, that open models are mainly a safety risk, that capable weights should stay locked behind APIs, and that regulation should be written accordingly. Whatever you think about any single company, the structural effect of that narrative is clear: it concentrates a general-purpose technology in the hands of a few actors, and it turns everyone else into a customer forever.

Defending open models does not mean pretending they are risk-free, and it does not mean hating closed ones (this repo was literally written with a closed one). It means insisting that:

- **Access is a form of safety.** Researchers, educators, small businesses and public institutions can only audit, understand and teach what they can actually run.
- **Dependence is a risk too.** A world where every workflow dies when one API changes its terms is not a safe world, it is a fragile one.
- **Competition keeps everyone honest.** Kimi K3's release pushed prices down and capabilities up across the whole industry within weeks. That pressure is worth protecting.
- **The right to tinker is how ordinary people learn AI.** This entire app exists because one person wanted to see what an open model could do on her own computer, in her own colors, in her own language.

If you build with open models, say so. If you teach, teach them. If you regulate, regulate uses and harms, not the freedom to publish weights.

## What it does

- **Sessions per folder**, like Claude Code projects. Each session is bound to a project directory and cannot read or write outside it.
- **Real tools**: read, write, edit, list, search files; run PowerShell commands **only after you click approve** in the UI; transcribe audio via Groq Whisper.
- **Persistent memory**: a global memory plus one per project, editable by you and appendable by the agent. It also reads `KIMI.md` or `CLAUDE.md` if present in the project folder.
- **Spend counter**: every API call is metered from the usage the API declares (not estimated), per response, per session, per day, total.
- **Local first**: sessions, memory and spend live in `~/.kimi-code-app/`. API keys stay in your browser's localStorage or in environment variables.

## Quick start

Requirements: Node.js 20+, a [Moonshot API key](https://platform.moonshot.ai), optionally a [Groq key](https://console.groq.com) for audio transcription.

```
git clone https://github.com/<you>/kimi-code-app
cd kimi-code-app
node server.mjs
```

Open http://localhost:4318, paste your keys in Settings (gear icon), create a session on a project folder, and talk to it. On Windows you can just double-click `avvia.cmd`.

## Honest limits

- Kimi K3 is strong with tools but it is not magic: long jobs can drift. There is a hard cap of 40 tool rounds per message.
- Context keeps the last 80 messages; use the persistent memory for things that must survive.
- Commands run with your user permissions. Approve only what you understand.
- The pixel tears are not a metric of model quality.

---

<a name="italiano"></a>

# Kimi Code (italiano)

Un agente di coding locale, aperto, in un file solo, che trasforma **Kimi K3** (il modello open-weights di Moonshot AI) in qualcosa che somiglia a Claude Code: sessioni per cartella di progetto, strumenti veri sui file veri, memoria persistente, contatore di spesa, e comandi che non partono mai senza la tua approvazione esplicita.

Zero dipendenze. Un server Node, una pagina HTML. I tuoi file non lasciano la tua macchina, tranne i prompt che mandi all'API del modello.

## Come nasce

Questa app nasce in una sola conversazione. Federica Nardi ([@basicfede_](https://instagram.com/basicfede_)), formatrice di alfabetizzazione all'IA, ha aperto la giornata chiedendo al suo assistente "aiutami a installare Kimi K3". Qualche ora dopo aveva un tester per il suo lavoro vero (i piani editoriali Instagram), una dashboard di spesa, e infine questo: un'imbracatura locale completa che permette a un modello open-weights di fare coding agentico sul suo computer, con un'interfaccia nei colori del suo brand invece della solita estetica scura da tech bro.

È stata costruita con Claude, un modello chiuso, ed esiste per rendere più usabile un modello aperto. Ci fa ridere, ed è esattamente il punto. Gli strumenti non dovrebbero avere tifoserie.

Il Dario Amodei in pixel art che piange nella schermata vuota è satira affettuosa. Confidiamo che sopravviverà.

## Perché i modelli aperti vanno difesi

I modelli open-weights come Kimi K3 si possono scaricare, ispezionare, ospitare in proprio, mettere a punto, e tenere in funzione anche se l'azienda che li ha creati cambia idea, prezzi o esistenza. Non è un dettaglio tecnico. È la differenza tra affittare l'intelligenza e possedere gli strumenti.

Cresce una narrazione, spinta con più forza proprio da alcune delle aziende che hanno più da guadagnarci, per cui i modelli aperti sarebbero soprattutto un rischio, i pesi capaci dovrebbero restare chiusi dietro le API, e le regole andrebbero scritte di conseguenza. Qualunque cosa si pensi delle singole aziende, l'effetto strutturale di quella narrazione è chiaro: concentra una tecnologia generale nelle mani di pochi attori, e trasforma tutti gli altri in clienti per sempre.

Difendere i modelli aperti non significa fingere che siano privi di rischi, e non significa odiare quelli chiusi (questo repo è stato scritto letteralmente con uno di loro). Significa insistere su alcune cose:

- **L'accesso è una forma di sicurezza.** Ricerca, scuola, piccole imprese e istituzioni pubbliche possono verificare, capire e insegnare solo ciò che possono davvero far girare.
- **Anche la dipendenza è un rischio.** Un mondo in cui ogni flusso di lavoro muore quando una API cambia condizioni non è un mondo sicuro, è un mondo fragile.
- **La concorrenza tiene onesti tutti.** L'uscita di Kimi K3 ha abbassato i prezzi e alzato le capacità di tutto il settore in poche settimane. Quella pressione va protetta.
- **Il diritto di smanettare è il modo in cui le persone comuni imparano l'IA.** Questa app esiste perché una persona voleva vedere cosa sapesse fare un modello aperto sul proprio computer, coi propri colori, nella propria lingua.

Se costruisci con modelli aperti, dillo. Se insegni, insegnali. Se scrivi regole, regola gli usi e i danni, non la libertà di pubblicare i pesi.

## Cosa fa

- **Sessioni per cartella**, come i progetti di Claude Code: ogni sessione è legata a una cartella e non può uscirne.
- **Strumenti veri**: legge, scrive, modifica, elenca e cerca nei file; esegue comandi PowerShell **solo dopo che premi Approva**; trascrive audio con Groq Whisper.
- **Memoria persistente**: una globale più una per progetto, modificabile da te e integrabile dall'agente. Legge anche `KIMI.md` o `CLAUDE.md` se presenti.
- **Contatore di spesa**: ogni chiamata è misurata sui token dichiarati dall'API, per risposta, per sessione, per giorno e totale.
- **Locale prima di tutto**: sessioni, memoria e spesa vivono in `~/.kimi-code-app/`. Le chiavi restano nel localStorage del browser o nelle variabili d'ambiente.

## Avvio rapido

Servono: Node.js 20+, una [chiave Moonshot](https://platform.moonshot.ai), facoltativa una [chiave Groq](https://console.groq.com) per le trascrizioni.

```
git clone https://github.com/<tu>/kimi-code-app
cd kimi-code-app
node server.mjs
```

Apri http://localhost:4318, incolla le chiavi nelle impostazioni (ingranaggio), crea una sessione su una cartella di progetto e parlaci. Su Windows basta un doppio clic su `avvia.cmd`.

## Limiti onesti

- Kimi K3 è bravo con gli strumenti ma non è magia: sui lavori lunghi può perdersi. C'è un tetto di 40 giri di strumenti per messaggio.
- Il contesto tiene gli ultimi 80 messaggi; per ciò che deve sopravvivere c'è la memoria persistente.
- I comandi girano con i tuoi permessi utente: approva solo quello che capisci.
- Le lacrime in pixel non sono una metrica della qualità del modello.

---

*Written with, and signed by, **Fable 5** (Claude, Anthropic) at the request of Federica Nardi. A closed model wrote the love letter to open ones. Make of that what you will.*

*Scritto e firmato da **Fable 5** (Claude, Anthropic) su richiesta di Federica Nardi. Un modello chiuso ha scritto la lettera d'amore a quelli aperti. Fateci quello che volete.*
