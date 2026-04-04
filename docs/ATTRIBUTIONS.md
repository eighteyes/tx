# TX Attributions

Prior art, borrowed techniques, and novel contributions.

TX is a synthesis. Most individual components draw from well-established patterns
in distributed systems, reliability engineering, and workflow orchestration. The
original work is in the combinations, the adaptations to agentic AI, and a handful
of genuinely new ideas that emerged from the problem space.

---

**Borrowed Techniques**

These are patterns with clear lineage. Cited so the ancestors get their due.

```
Technique                     Source                                    Where in TX
────────────────────────────  ────────────────────────────────────────  ──────────────────────────────
Actor Model                   Carl Hewitt (1973), Erlang/OTP,           dispatcher.ts, sdk-runner.ts
  message-driven isolation    Joe Armstrong's thesis, Akka

File System Watcher IPC       inotify (Linux), FSEvents (macOS),        consumer.ts via chokidar
  event-driven file detection chokidar (npm)

SQLite WAL Message Queue      Write-Ahead Logging (SQLite docs),        queue/index.ts
  durable persistent queue    message broker patterns (RabbitMQ,
                              Kafka, SQS)

Finite State Machines         David Harel's Statecharts (1987),         state-machine/, mesh/fsm.ts
  guards, entry/exit actions  UML state diagrams, XState

Fan-Out / Fan-In              MapReduce (Dean & Ghemawat 2004),         dispatcher.ts fan-out groups
  parallel dispatch + join    Go sync.WaitGroup, fork/join pools

Dead Letter Queue             RabbitMQ Dead Letter Exchange,             reliability/dead-letter-queue.ts
  failed message isolation    AWS SQS DLQ pattern

Circuit Breaker               Michael Nygard, Release It! (2007),       reliability/circuit-breaker.ts
  closed → open → half-open   Netflix Hystrix

Heartbeat / Liveness Probe    Kubernetes liveness probes,               reliability/heartbeat-monitor.ts
                              systemd watchdog timers

Deadlock Detection            Tarjan's SCC algorithm,                   queue/deadlock-detector.ts
  DFS 3-color cycle finding   wait-for graphs (database theory),
                              Chandy-Misra-Haas concepts

Middleware / Hook Chain        Express.js middleware, Django,            state-machine/middleware/,
  pre/post interceptors       Aspect-Oriented Programming               worker/hooks.ts
                              (Kiczales 1997)

Fibonacci Backoff             Exponential backoff (Ethernet CSMA/CD),   shared/fib.ts
                              Fibonacci variant for smoother curves

Structured JSONL Logging      Bunyan (Node.js), ELK stack,             shared/logger.ts
                              structured logging best practices

tmux Session Management       tmux project (Nicholas Marriott),         core/tmux.ts
                              GNU Screen lineage

Capability-Based Security     Dennis & Van Horn (1966),                 write-gate.ts, read-gate.ts,
  manifest-declared perms     E-lang object capabilities,               bash-guard.ts
                              Docker seccomp, AppArmor

Ensemble / Hedging            "The Tail at Scale"                       ensemble-coordinator.ts,
  redundant parallel exec     (Dean & Barroso, 2013, Google)            mesh/aggregation.ts

Supervisor Trees              Erlang/OTP supervisor pattern,            worker-lifecycle.ts,
  process lifecycle tracking  systemd service management                process-discovery.ts

EventEmitter Pub/Sub          Node.js core EventEmitter,               consumer.ts, dispatcher.ts
                              Observer pattern (GoF 1994)

Dependency Injection          Spring Framework, Guice,                  message-router.ts (deps interface)
  constructor-based DI        functional composition

Session Persistence           HTTP session middleware,                  session/session-store.ts
  suspend / resume            Redis session stores,
                              Kubernetes pod checkpointing

WebSocket Bidirectional       Socket.IO, GraphQL Subscriptions         core-websocket.ts

Violation Gradient            Progressive penalty models,               bash-guard.ts
  warn → warn → kill          (adapted from access control theory)
```

**Explicitly Referenced**

```
Source                                   Concept Borrowed
───────────────────────────────────────  ──────────────────────────────
Karpathy's "March of Nines"              Reliability tiers by order of magnitude
Karpathy's "LLM Council"                Ensemble execution, multiple agents on same problem
Anthropic Claude Code SDK                Agent session management, tool use, conversation persistence
Google SRE Book (Beyer et al. 2016)      Error budgets, SLI thresholds, progressive restriction
```

See `docs/COMPARISON.md` for positioning against other agent frameworks.

---

**Novel Contributions**

These emerged from building TX and don't have direct precedents.

**File-as-Protocol for Agentic Systems**

Agents communicate through immutable markdown files in a watched directory.
Every interaction is `ls` + `cat` away. This is the foundational architectural
bet — observability and debuggability over latency.

Draws from Maildir format (filesystem message storage) and Git's
content-addressable object store, but the application to multi-agent AI
orchestration is new. The closest existing pattern is Plan 9's "everything
is a file" philosophy applied to agent communication.

```
Files     consumer.ts, system-message-writer.ts, .ai/tx/msgs/
Bet       Human debuggability beats machine efficiency for AI orchestration
Tradeoff  Higher latency than in-process messaging; total observability in return
```

**Rearmatter**

Structured self-assessment metadata appended AFTER message body, delimited by
a second `---` fence. The inverse of frontmatter: frontmatter is routing,
rearmatter is reflection.

Borrows the `---` delimiter convention from Jekyll/Hugo frontmatter and the
concept of post-body metadata from HTTP Trailers (RFC 7230 §4.1). The rest
is original: mandatory transparency fields (confidence, gaps, assumptions,
sources), quality gate integration, and dual-source accountability where
agent testimony is cross-checked against an independent summarizer audit.

```
Files     consumer.ts (parsing), hooks/utils/rearmatter.ts (extraction),
          quality/types.ts (schema), workspace/injector.ts (prompt assembly)
Fields    grade, confidence, status, gaps, assumptions, sources, limitations
Pipeline  Agent testimony → extraction → independent audit (assay) → human
```

**Dynaprompt**

Mid-session prompt mutation via the message queue with checkpoint-aware
branching. Prompts evolve while the agent is already thinking.

Template systems (Jinja2, LangChain PromptTemplate) fill blanks at spawn
time. Dynaprompt injects fragments as messages during an active conversation.
The agent sees new guidance as contextual input — closer to a human advisor
walking into a meeting than a config file reloading.

The checkpoint-and-fork mechanism enables parallel exploration: save state,
branch N times with different cognitive framings (analytical, contrarian,
user-focused), then synthesize via a judge agent. Includes explicit replay
token cost tracking since each branch replays full conversation history.

```
Files     prompt/fragment-registry.ts, cli/dynaprompt.ts,
          reliability/checkpoint-log.ts
Concepts  Message-driven fragment injection, runtime fragment authoring,
          priority cascade (mesh > agent > runtime), fork-and-evaluate
```

**Lint Ladder**

Sequential cascade of specialized LLM agents that accumulate prose violations
in a shared manifest before a single editor agent applies holistic fixes.

Not a linter in the ESLint sense — those are deterministic pattern matchers
with binary pass/fail and auto-fix. The lint ladder is 12 domain-specific
literary critics (forbidden-words, ai-tells, cadence, metaphor, body-first,
temporal, etc.) building a shared diagnosis for one skilled editor.

The core insight is separating detection (cheap, specialized, distributable)
from correction (expensive, holistic, voice-aware). The ordering encodes a
literary judgment hierarchy: mechanical signals first, creative patterns
second, editorial synthesis last. By the time the editor receives the
violation manifest, it has 11 analytical perspectives on the same prose.

A parallel-star variant (narrative-engine-router) trades the accumulative
benefit for latency — all linters fork simultaneously, editor aggregates.
The existence of both variants demonstrates the architectural tradeoff is
understood, not accidental.

```
Files     meshes/narrative-engine/linters/*.md (12 agents),
          meshes/narrative-engine/config.yaml (routing),
          meshes/narrative-engine/editor/prompt.md
Chain     forbidden-words → patterns → ai-tells → cadence → metrics →
          dialogue → litotes → metaphor → body-first → factoids →
          temporal → editor
Insight   Detection is separable. Correction is holistic.
```

**Boundary-Based Message Inference**

Message type is inferred from the recipient's position in the routing
topology, not from an explicit `type` field. Messages to `core/core`
automatically trigger HITL suspension. Messages between agents in the
same mesh are collaboration. Messages to completion agents are task
handoffs.

The routing table becomes the implicit type system. Agents cannot
accidentally bypass the suspension protocol by mistyping a field.

```
Files     consumer.ts, docs/message-format.md
Rule      Routing topology determines message semantics
Benefit   Fewer fields to get wrong, protocol enforcement via structure
```

**Parity Gate**

Blocks task-complete messages if the completing agent has unresolved asks
pending. Prevents premature completion signaling when human input or
inter-agent responses are still outstanding.

Borrows the coordination concept from Two-Phase Commit but applies it
to a fundamentally different problem: ensuring an AI agent doesn't
declare "done" while questions to humans remain unanswered.

```
Files     consumer.ts, dispatcher.ts, queue/ (pending_asks table)
Rule      No completion while asks are outstanding
Failure   Deletes offending file, emits parity-reminder, agent retries
```

**Manifest Routing**

Agents declare file reads/writes upfront. The dispatcher infers execution
order from file dependencies — no routing table needed. If agent A writes
`analysis.md` and agent B reads it, B waits for A.

Borrows dependency-graph concepts from Make/Bazel but applies them to
runtime agent orchestration rather than build-time compilation. The
manifest also doubles as the security boundary: undeclared file access
is blocked by write-gate and read-gate.

```
Files     workspace/index.ts, manifest-validator.ts, manifest-resolver.ts
Example   meshes/narrative-engine/ has 150+ manifest entries
Dual use  Execution ordering + security enforcement from one declaration
```

---

**Summary**

The borrowed pieces are commodity plumbing — durable queues, state machines,
circuit breakers, supervision trees. They're battle-tested patterns applied
faithfully. The original work is in the protocol layer: how agents talk
(file-as-protocol), how they reflect (rearmatter), how they adapt mid-thought
(dynaprompt), how they critique creative work (lint ladder), and how the
system infers intent from structure rather than explicit declaration
(boundary inference, parity gate, manifest routing).
