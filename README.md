# Aegis Terminal: Tri-Agent Anti-Hallucination LLM Architecture

Aegis Terminal is a full-stack verification system implementing a novel **Synchronized Tri-Agent Anti-Hallucination LLM Architecture** over two unified interaction modalities: structured text chat (`POST /api/chat/verify`) and full-duplex live voice conversations (`WS /ws/live`).

Every symbol, equation, constant, state transition, and verification test cited in this document corresponds directly to the codebase in this repository. No fabricated statistics, extrapolated accuracy percentages, or unmeasured benchmark figures are included.

---

## 1. Original Contributions & Architectural Thesis

Standard single-pass LLM generation—and even post-hoc self-critique—allows unverified intermediate premises to propagate undetected into the final response. This architecture introduces five core design contributions engineered to eliminate hallucinated facts before any answer reaches the user:

1. **Lockstep Simultaneous Tri-Agent Step Execution**: Rather than checking an entire response only after generation completes, all three agents (**Solver**, **Anti-Hallucination Cross-Referencer**, and **Reasoning & Compatibility Auditor**) operate simultaneously at **every step** of reasoning—including Step 0 (Query Decomposition), every Sub-Part $i \in \{1 \dots P\}$, and Step $P + 1$ (Final Synthesis & Coherence)—and are synchronized in real time across the UI (`AgentSyncBay`, `components/AgentSyncBay.tsx`).
2. **Strict Ordered Solving in Agent 1 (External Retrieval Before Reasoning)**: Each sub-part MUST execute **Stage A** (live web search grounding via `googleSearch` + `urlContext` alongside persistent user-attached documents/media/links) **before** **Stage B** (thinking-enabled synthesis strictly constrained to Stage A findings and user grounding).
3. **Strict Two-Stage Verification in Agent 2 (Lexical Matching Before Reasoning)**: Agent 2 does not rely solely on subjective LLM review. It executes a deterministic lexical keyword and claim-sentence matching pass (`evaluateKeywordOverlap` in `lib/pipeline-rules.ts`) against gathered credible sources and user grounding **first**, and then runs reasoning cross-verification over each claim (`supported` / `partial` / `unsupported`).
4. **Dual-Chain Reasoning Audit & Inter-Agent Compatibility Matching in Agent 3**: Agent 3 independently audits **(a)** every sentence of Agent 1's reasoning, **(b)** every sentence of Agent 2's reasoning, and **(c)** **logical compatibility between Agent 1 and Agent 2 ($A_1 \leftrightarrow A_2$)**, attributing any defect to `faultOwner` $\in \{\text{none}, \text{agent1}, \text{agent2}, \text{both}\}$.
5. **Fault-Attributed Selective Redo, Unforgivable Mistake Memory, & Bounded 4-Attempt Transparency**:
   - Fault attribution governs targeted re-execution (`decideNextStepAction`): an isolated `agent2` fault re-runs **only Agent 2 and Agent 3** (preserving Agent 1's verified step), whereas `agent1` or `both` faults re-run **all 3 agents**.
   - Flagged defects are appended to an **Unforgivable Mistake Context Log** (`formatMistakeContextPrompt`) injected into Agent 1 and Agent 2 on subsequent attempts and steps so errors are not repeated.
   - All 3 agents enforce a binding zero-fabrication invariant: **no false, hallucinated, invented, or fake fact may reach the final answer.** If an anomaly persists at the 4th attempt (`MAX_ATTEMPTS = 4`), the system retains the highest lexical-overlap candidate and mandates explicit disclosure of **(1) the basis used**, **(2) what could not be found/verified**, and **(3) why**.

---

## 2. System Channels & Persistent Conversation Grounding

### 2.1 Unified Dual-Channel Execution (`POST /api/chat/verify` & `WS /ws/live`)

Both text and voice channels route queries through the identical `runTriAgentPipeline` orchestrator (`lib/tri-agent-engine.ts`):

- **Text Verification Channel (`app/api/chat/verify/route.ts`)**: Streams structured `PipelineEvent` records over Server-Sent Events (`text/event-stream`, Node.js runtime) directly to `components/TerminalWorkspace.tsx`.
- **Full-Duplex Live Voice Channel (`server.ts`, `lib/audio-utils.ts`)**: Bridges raw 16-bit little-endian PCM audio (`16,000 Hz` microphone input capture via Web Audio `AudioContext`, `24,000 Hz` gapless scheduled playback via `Pcm24kPlayer` with barge-in `interrupt()`) to the Gemini Live API. Spoken factual, analytical, or document-grounded queries trigger `verify_query_with_agents`, executing `runTriAgentPipeline` while writing both `inputTranscription` and `outputTranscription`—plus the verified structured output and citations—directly into the shared chat console.

### 2.2 Persistent Conversation Grounding (`app/api/grounding/ingest/route.ts`)

User-supplied resources persist across the entire multi-turn text and voice session via `resources[]` (active whenever `enabled === true`):

| Resource Kind | Ingestion & Extraction Pipeline | Code-Enforced Limits (`route.ts` / `tri-agent-engine.ts`) |
| :--- | :--- | :--- |
| Website URL (`http:` / `https:`) | `validateExternalUrl` SSRF guard, `fetch` with redirect re-validation, `stripHtmlToText` HTML sanitization, and Gemini `urlContext` tool | `8,000 ms` fetch timeout, `2 MiB` (`2,097,152` bytes) download cap, `25,000` char extracted text cap |
| Word Documents (`.doc`, `.docx`) | Server-side text extraction via `mammoth.extractRawText` (ASCII fallback if malformed) | `8 MiB` (`8,388,608` bytes) upload cap, `35,000` char extracted text cap |
| Plain Text / Markdown / CSV | UTF-8 decoding | `8 MiB` upload cap, `35,000` char extracted text cap |
| PDF / Image / Video | Base64 `inlineData` multimodal parts attached directly to agent requests | `8 MiB` upload cap |
| Session Context Injection (`buildResourceParts`) | Serialized per pipeline step across Agent 1 and Agent 2 | `12,000` chars per resource text block; last `8` conversation turns (`800` chars max/turn) |

---

## 3. Detailed Logical Flow of the Tri-Agent LLM Architecture

```text
User Query (Text SSE or Full-Duplex Voice) + Persistent Grounding Resources + History
        │
        ▼
[Step 0: Query Decomposition & Premise Audit]
  ├─ Agent 1 (Solver): Breaks query into P ∈ [1, 4] atomic, non-overlapping sub-parts + short concrete reasoning
  ├─ Agent 2 (Cross-Check): Verifies zero invented/unstated premises enter decomposition + short reasoning
  └─ Agent 3 (Auditor): Audits decomposition completeness and Agent 1 reasoning validity + short reasoning
        │
        ▼
For each Sub-Part Step i ∈ {1, ..., P}  ──then──►  Final Synthesis Step P + 1:
  ┌───────────────────────────────────────────────────────────────────────────────────┐
  │ Synchronized Loop: Attempt a = 1 .. 4 (MAX_ATTEMPTS = 4)                          │
  │                                                                                   │
  │  1. AGENT 1 — Grounded Solver  [Skipped iff redo action == 'redo_agent2_and_3']   │
  │     ├─ Stage 1A (Sub-parts): Internet Search (googleSearch + urlContext)          │
  │     │    + Persistent User Grounding -> extracts verbatim facts & SourceCitations │
  │     └─ Stage 1B: Thinking-enabled synthesis constrained strictly to Stage 1A      │
  │          sources + Grounding + Mistake Context Log -> answer, claimKeywords,      │
  │          short concrete reasoning (zero fabricated facts permitted)               │
  │                                                                                   │
  │  2. AGENT 2 — Anti-Hallucination Cross-Referencer                                 │
  │     ├─ Stage 2A (Deterministic): evaluateKeywordOverlap(answer, sourceSnippets)   │
  │     │    -> matchedKeywords, missingKeywords, matchRatio ∈ [0, 1]                 │
  │     ├─ Stage 2B (Claim-Source Match): Checks keywords & claim sentences against   │
  │     │    credibleSources + user grounding resources                               │
  │     └─ Stage 2C (Reasoning Audit): Cross-verifies every claim -> short concrete   │
  │          reasoning + anomalyFlagged (f2 ∈ {true, false}) + anomalyDetail          │
  │                                                                                   │
  │  3. AGENT 3 — Reasoning & Compatibility Auditor  [Always runs]                    │
  │     ├─ Audits every sentence of Agent 1 reasoning (agent1ReasoningValid)          │
  │     ├─ Audits every sentence of Agent 2 reasoning (agent2ReasoningValid)          │
  │     ├─ Matches Agent 1 ↔ Agent 2 compatibility (compatibilityValid)               │
  │     └─ Outputs short concrete reasoning, anomalyFlagged (f3), and                 │
  │          faultOwner o3 ∈ {'none', 'agent1', 'agent2', 'both'}                     │
  │                                                                                   │
  │  4. DETERMINISTIC ROUTER — decideNextStepAction(a, 4, f2, f3, o3)                 │
  │     ├─ (!f2 && !f3) ────────────────────────────► ACCEPT & ADVANCE TO NEXT STEP   │
  │     ├─ (a == 4 && (f2 || f3)) ──────────────────► CAP_WITH_BOTTLENECK (Step 3.2)  │
  │     ├─ (!f2 && f3 && effectiveFault=='agent2') ► REDO AGENT 2 & AGENT 3 ONLY     │
  │     └─ (otherwise) ─────────────────────────────► LOG MISTAKE & REDO ALL (1,2,3)  │
  └───────────────────────────────────────────────────────────────────────────────────┘
        │
        ▼
[Step P + 1: Final Synthesis, Coherence Audit & Disclosure Enforcement]
  ├─ Agent 1 clubs verified part answers (no web search; checks whole-answer coherence)
  ├─ Agent 2 checks compiled output introduces zero ungrounded/fake facts & verifies
  │    all 4-attempt BottleneckReports are explicitly disclosed
  ├─ Agent 3 audits A1/A2 synthesis reasoning, compatibility, & disclosure completeness
  └─ ensureBottleneckDisclosures(finalAnswer, bottleneckReports) deterministically
       appends any missing basis/missing-info/cause section before run_completed
```

### 3.1 Deterministic Step Routing Algebra (`decideNextStepAction`)

Implemented as a pure function in `lib/pipeline-rules.ts`, step transitions are governed strictly by Agent 2's anomaly flag $f_2 \in \{\text{true}, \text{false}\}$, Agent 3's anomaly flag $f_3 \in \{\text{true}, \text{false}\}$, Agent 3's fault attribution $o_3 \in \{\text{none}, \text{agent1}, \text{agent2}, \text{both}\}$, and attempt counter $a \in \{1, 2, 3, 4\}$:

1. **Acceptance**:
   $$(\neg f_2 \land \neg f_3) \implies \text{action} = \texttt{accept},\ \text{faultOwner} = \texttt{none}$$
2. **Effective Fault Attribution ($\text{faultOwner}$)**:
   - $(f_2 \land f_3) \implies \texttt{both}$ if $o_3 \in \{\texttt{agent2}, \texttt{both}\}$, else $\texttt{agent1}$
   - $(f_2 \land \neg f_3) \implies \texttt{agent1}$
   - $(\neg f_2 \land f_3) \implies \texttt{both}$ if $o_3 = \texttt{none}$, else $o_3$
3. **4th-Attempt Cap**:
   $$a \ge 4 \implies \text{action} = \texttt{cap\_with\_bottleneck}$$
4. **Selective vs. Full Redo ($a < 4$)**:
   - $(\neg f_2 \land f_3 \land \text{faultOwner} = \texttt{agent2}) \implies \texttt{redo\_agent2\_and\_3}$ (Agent 1's candidate `lastAgent1` is preserved; only Agent 2 and Agent 3 re-run)
   - $\text{Otherwise} \implies \texttt{redo\_all}$ (Agent 1, Agent 2, and Agent 3 all re-run with updated Mistake Context Log)

### 3.2 Unforgivable Mistake Context Log (`formatMistakeContextPrompt`)

Every anomaly flagged by Agent 2 or Agent 3 appends a `MistakeLogEntry` (`stepId`, `stepLabel`, `attempt`, `flaggedBy`, `faultOwner`, `reason`, `resolutionNote`, `timestamp`) to both the pipeline run state and the session-wide **Mistake Log** view (`components/MistakeLogPanel.tsx`). On every subsequent attempt and step, `formatMistakeContextPrompt(mistakes, currentStepId)` orders entries from the active step first followed by earlier steps in the run, injecting each entry labeled `UNFORGIVABLE MISTAKE: Do NOT repeat this error.` into Agent 1, Agent 2, and Agent 3 prompts.

### 3.3 4-Attempt Unresolved Cap & Mandatory Disclosure (`ensureBottleneckDisclosures`)

When any step reaches attempt $a = 4$ with an unresolved anomaly:
1. **Candidate Selection**: `runTriAgentPipeline` retains `bestSnapshot` (the prior attempt with the highest deterministic `lexicalMatchRatio`).
2. **Structured `BottleneckReport`**: Records `stepId`, `stepLabel`, `basisUsed` (top grounded sources or explicit non-extrapolated boundary), `missingInformation` (the exact discrepancy flagged by Agent 2/Agent 3), and `whyUnresolved` (evidence or verification-depth bottleneck).
3. **Tri-Agent Synthesis Enforcement & Deterministic Guard**: During Step $P + 1$, all three agents explicitly prompt-check that the compiled answer includes `(a)` the basis used, `(b)` what could not be found or verified, and `(c)` why. Afterward, `ensureBottleneckDisclosures` (`lib/pipeline-rules.ts`) deterministically verifies each unresolved `stepLabel` appears in the output and appends a structured `### Unresolved Verification Disclosures (4-Attempt Cap)` block if omitted.

---

## 4. Deterministic Lexical Grounding Metric

Before Agent 2 invokes reasoning, `evaluateKeywordOverlap(claimText, sourceSnippets)` (`lib/pipeline-rules.ts`) computes a reproducible lexical baseline:

1. `extractClaimKeywords(text, maxKeywords = 14)` normalizes text to lowercase, retains characters matching `[a-z0-9.\-%$ ]`, strips leading/trailing `.` and `-`, drops tokens with length $< 3$, filters out a fixed $57$-word stop-word set (`STOP_WORDS`), and returns up to $14$ unique tokens $K$.
2. Each token $k \in K$ is tested for substring presence in the concatenated corpus of Agent 1's `credibleSources` (titles and snippets) plus enabled user grounding text.
3. The exact overlap score is:
   $$\text{matchRatio} = \operatorname{round}_2\!\left(\frac{|K_{\text{matched}}|}{|K|}\right) \quad (\text{or } 1.0 \text{ when } K = \emptyset)$$

---

## 5. Analytical Call-Complexity Bounds

From direct inspection of `runTriAgentPipeline` (`lib/tri-agent-engine.ts`), a query decomposes into $P \in \{1, 2, 3, 4\}$ sub-parts alongside Step $0$ (Decomposition) and Step $P + 1$ (Final Synthesis):

- **Step 0 (Decomposition)**: $3$ model invocations (`decompRes`, `decompA2Res`, `decompA3Res`).
- **Each Sub-Part Step $i \in \{1 \dots P\}$**:
  - Attempt 1: $4$ invocations (Stage 1A Web Search, Stage 1B Grounded Solver, Agent 2, Agent 3).
  - Each retry attempt ($a \in \{2, 3, 4\}$): $4$ invocations under `redo_all`, or $2$ invocations (Agent 2 + Agent 3) under `redo_agent2_and_3`.
- **Step $P + 1$ (Final Synthesis)**:
  - Attempt 1: $3$ invocations (Agent 1 synthesis without web search, Agent 2, Agent 3).
  - Each retry attempt ($a \in \{2, 3, 4\}$): $3$ invocations under `redo_all`, or $2$ invocations under `redo_agent2_and_3`.

For $P \in \{1, 2, 3, 4\}$, total verification invocations $C$ per query satisfy exact closed-form bounds:
- **Best Case (all steps accepted on Attempt 1)**:
  $$C_{\min}(P) = 3 + 4P + 3 = 4P + 6 \quad \Longrightarrow \quad C_{\min} \in \{10, 14, 18, 22\}$$
- **Worst Case (all steps exhaust `MAX_ATTEMPTS = 4` under `redo_all`)**:
  $$C_{\max}(P) = 3 + 4(4P) + 4(3) = 16P + 15 \quad \Longrightarrow \quad C_{\max} \in \{31, 47, 63, 79\}$$

---

## 6. Real-Time UI Transparency & Honest Termination

- **100% Lockstep Step Sync (`components/AgentSyncBay.tsx`)**: All three agent views—available simultaneously side-by-side (`3-Up`) or via `Tabs`—are bound to `runState.activeStepId`, updating live as `agent_output`, `step_active`, `mistake_flagged`, and `step_resolved` events stream in. Toggle **Lockstep Sync On / Manual Step** to either follow live progress automatically or inspect historical steps and attempt outcomes.
- **No False Loading**: If an upstream error occurs (`run_error` or stream interruption), active `running`/`retrying` steps transition immediately to `error` (`Stopped`), spinners clear, input unlocks, and the exact diagnostic message is rendered in both the chat thread and the 3-Agent Sync Bay.

---

## 7. Security & Network Controls

- **Server-Side Credential Isolation**: `GEMINI_API_KEY` is accessed strictly on the server (`lib/gemini-fallback.ts`, `server.ts`) and never exposed to client bundles.
- **SSRF Guard (`validateExternalUrl` in `lib/pipeline-rules.ts`)**: Blocks non-`http:`/`https:` schemes, embedded URL credentials, `localhost`, `.local`/`.internal` suffixes, cloud metadata endpoints (`metadata.google.internal`), IPv6 loopback/link-local/ULA (`::1`, `fe80:`, `fc`, `fd`), and private IPv4 ranges (`127.0.0.0/8`, `10.0.0.0/8`, `0.0.0.0/8`, `169.254.0.0/16`, `192.168.0.0/16`, `172.16.0.0/12`, `100.64.0.0/10`). HTTP redirects during ingestion are re-validated against `validateExternalUrl` in `app/api/grounding/ingest/route.ts`.

---

## 8. Repository Structure

```text
├── app/
│   ├── api/
│   │   ├── chat/verify/route.ts      # SSE streaming endpoint for tri-agent verification
│   │   └── grounding/ingest/route.ts # SSRF-guarded URL & file (PDF/DOCX/TXT/Media) ingestion
│   ├── globals.css                   # Matte obsidian terminal palette & typography variables
│   ├── layout.tsx                    # Root layout & fonts (Plus Jakarta Sans, DM Sans, JetBrains Mono)
│   └── page.tsx                      # Entry page rendering TerminalWorkspace
├── components/
│   ├── AgentSyncBay.tsx              # Lockstep 3-Up & Tabs synchronized agent inspector
│   ├── ChatPanel.tsx                 # Unified Text + Live Voice chat transcript, citations & bottlenecks
│   ├── GroundingBar.tsx              # Persistent URL & file grounding manager
│   ├── MistakeLogPanel.tsx           # Session-wide Mistake Context Log inspector
│   ├── TerminalWorkspace.tsx         # Client coordinator for SSE pipeline & WebSocket Live Voice
│   └── TopHeader.tsx                 # Workspace navigation & hands-free Voice Talk toggle
├── lib/
│   ├── audio-utils.ts                # PCM16 base64 codecs & 24 kHz gapless AudioContext player
│   ├── gemini-fallback.ts            # Server-side @google/genai client utilities
│   ├── pipeline-rules.ts             # Pure SSRF guard, lexical overlap, selective retry router & disclosures
│   ├── pipeline-rules.test.ts        # Deterministic node:test verification suite (6 unit tests)
│   ├── tri-agent-engine.ts           # Lockstep 3-agent orchestration & disclosure enforcement
│   └── types.ts                      # Shared TypeScript contracts & SSE event unions
└── server.ts                         # Custom Next.js + ws WebSocket server (/ws/live)
```

---

## 9. Reproducible Verification & Research Telemetry

### Deterministic Unit Test Suite (6 Tests)

```bash
npx --yes tsx --test lib/pipeline-rules.test.ts
```

Executes 6 deterministic `node:test` assertions over the pure architectural rules:
1. `validateExternalUrl` — public `http`/`https` acceptance and SSRF range rejection.
2. `evaluateKeywordOverlap` — grounded vs. ungrounded lexical overlap ratios.
3. `decideNextStepAction` — clean `accept`, `redo_all`, `redo_agent2_and_3`, and 4th-attempt `cap_with_bottleneck`.
4. `formatMistakeContextPrompt` — current-step prioritization and unforgivable-mistake directives.
5. `stripHtmlToText` — `<script>`/`<style>`/tag sanitization.
6. `ensureBottleneckDisclosures` — deterministic basis/missing-info/cause disclosure appending.

### Empirical Telemetry for Research Paper Evaluation

Every verification run emits typed JSON `PipelineEvent` records (`lib/types.ts`) suitable for logging empirical metrics across evaluation datasets:
- `decomposition_complete`: Sub-part count $P$ (`parts.length`).
- `agent_output` (`agent2`): Per-step deterministic `lexicalMatchRatio`, `keywordChecks`, `claimChecks`, and `anomalyFlagged`.
- `agent_output` (`agent3`): `agent1ReasoningValid`, `agent2ReasoningValid`, `compatibilityValid`, and `faultOwner`.
- `mistake_flagged`: Per-attempt anomaly count, `flaggedBy`, `faultOwner`, and chosen retry transition (`nextAction`).
- `step_resolved`: Terminal step outcome (`verified` vs. `bottleneck`) and structured `BottleneckReport` fields.

### Local Commands

```bash
npm run dev      # Custom Next.js + WebSocket server on port 3000 via tsx server.ts
npm run build    # Production build
npm start        # Production server (node server.ts)
npm run lint     # ESLint verification
```
