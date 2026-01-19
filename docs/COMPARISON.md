# TX vs Configuration-Driven Agentic Frameworks

Comprehensive comparison of TX against LangGraph, AutoGen, CrewAI, Semantic Kernel, OpenAI Agents SDK, LlamaIndex Workflows, Langroid, and Agency Swarm.

---

## Executive Summary

| Framework | Config Format | Agent Model | Orchestration | Observability |
|-----------|--------------|-------------|---------------|---------------|
| **TX** | YAML routing tables | Ephemeral per-message | Status-based lookup | Immutable file log |
| LangGraph | Python DSL | Graph nodes | Conditional edges | LangSmith traces |
| AutoGen | Python/JSON | Conversational | Event-driven | OpenTelemetry |
| CrewAI | YAML + Python | Role-based | Sequential/Hierarchical | Verbose logging |
| Semantic Kernel | Python/.NET | Plugin-based | Orchestration patterns | Azure Monitor |
| OpenAI Agents SDK | Python | Function-equipped | Handoffs | Built-in tracing |
| LlamaIndex Workflows | Python DSL | Event-driven steps | Event routing | Callbacks |
| Langroid | Python/Pydantic | Actor-inspired | Task delegation | Logging |
| Agency Swarm | Python | Role-based swarms | Topology operators | Inherited |

---

## Architectural Philosophy

### TX: File-as-Protocol

TX exploits LLM-native behavior: models already think in terms of reading and writing files. Rather than building RPC layers, TX uses the filesystem as the message bus.

```
User → writes .md file → Consumer detects → Queue → Dispatcher → Ephemeral Worker → writes response .md
```

**Core bet**: Observability and debuggability over latency. Every message is an immutable file. Debugging is `ls` and `cat`.

### Others: Process-Centric

Most frameworks treat agents as persistent processes or graph nodes that communicate through in-memory channels, function calls, or API requests.

| Framework | Communication Model |
|-----------|-------------------|
| LangGraph | State object passed through graph |
| AutoGen | In-memory conversation threads |
| CrewAI | Task output chaining |
| Semantic Kernel | Kernel context object |
| OpenAI Agents SDK | Handoff function calls |
| LlamaIndex | Event objects between steps |
| Langroid | Task delegation tree |
| Agency Swarm | Agent-to-agent messaging |

---

## Agent Lifecycle

### TX: Ephemeral Workers

```
Message arrives → Worker spawns → Processes message → Writes response → Worker dies
```

- No state accumulation across messages
- No zombie processes
- No memory bloat
- Session resume for multi-turn continuity (optional)

### Others: Persistent Agents

| Framework | Lifecycle | Persistence Mechanism |
|-----------|-----------|----------------------|
| LangGraph | Graph invocation | Checkpointers (Postgres, Redis, SQLite) |
| AutoGen | Conversation session | Thread-based state |
| CrewAI | Crew execution | Memory stores |
| Semantic Kernel | Request/Thread | Thread state objects |
| OpenAI Agents SDK | Ephemeral | External (bring your own) |
| LlamaIndex | Workflow run | Context API |
| Langroid | Task execution | Optional stores |
| Agency Swarm | Agency session | Conversation state |

**TX tradeoff**: Ephemeral workers avoid state drift but require explicit session management for multi-turn tasks.

---

## Routing & Orchestration

### TX: Status-Based Routing Tables

Routing is a lookup, not a graph traversal:

```yaml
routing:
  implementer:
    complete:
      tester: "Code complete, ready for tests"
    blocked:
      core: "Cannot proceed - need clarification"

  tester:
    complete:
      reviewer: "Tests pass"
    blocked:
      implementer: "Tests fail - needs fixes"
```

Agent sets `status` in message frontmatter → Dispatcher looks up next recipient.

**Differentiator**: Simpler mental model than graph edges. Status is semantic, not structural.

### LangGraph: Conditional Graph Edges

```python
builder.add_conditional_edges(
    "agent",
    should_continue,
    {"tools": "tools", "end": END}
)
```

Control flow encoded in graph structure with conditional edge functions.

### AutoGen: Conversation-Driven

Speaker selection in group chats. Agents respond based on conversation context, not explicit routing.

### CrewAI: Task Dependencies

```yaml
reporting_task:
  context:
    - research_task  # Depends on research completing first
```

Sequential or hierarchical process types determine execution order.

### Semantic Kernel: Orchestration Patterns

Pre-built patterns: Sequential, Concurrent, Handoff, Group Chat, Magentic.

### OpenAI Agents SDK: Handoffs

```python
tools=[handoff(weather_agent), handoff(support_agent)]
```

Handoffs appear as tools the agent can invoke.

---

## State & Memory

### TX: Session Resume + Rearmatter

**Session Resume**: Store session_id, resume Claude session for multi-turn continuity.

**Rearmatter**: Optional self-assessment metadata in message footer:

```markdown
---
grade: A
confidence: 0.95
status: complete
gaps: []
assumptions: ["API available"]
---
```

**Distinction**: Rearmatter is metadata *about* work, not context *for* next agent. Summaries as first-class handoff context is a potential enhancement.

### LangGraph: Reducer-Driven State

```python
class State(TypedDict):
    messages: Annotated[list, add_messages]
    context: str
```

State accumulates through reducers. Checkpointers persist across invocations.

### AutoGen: Conversation History

Maintains full conversation history per chat session. Thread-based in Microsoft Agent Framework.

### CrewAI: Task Outputs + Memory

Task outputs flow to dependent tasks. Optional short-term, long-term, and entity memory.

### OpenAI Agents SDK: Stateless

Client-side state management. Framework provides no persistence.

---

## Human-in-the-Loop

### TX: First-Class Ask Protocol

```yaml
type: ask
to: core/core
---
What authentication method should we use?
```

- Worker enters `awaiting` state
- Human responds with `ask-response`
- Worker resumes with context
- **Parity gate**: Completion blocked until all pending asks resolved

### LangGraph: Interrupt Points

```python
graph = builder.compile(interrupt_before=["human_review"])
```

Node-level pauses with time-travel capability.

### AutoGen: UserProxyAgent

```python
user_proxy = UserProxyAgent(human_input_mode="ALWAYS")
```

Human as agent in conversation.

### CrewAI: HumanTool

```python
human_tool = HumanTool()
```

Explicit tool for human consultation.

### Others

| Framework | HITL Mechanism |
|-----------|---------------|
| Semantic Kernel | Request/response patterns |
| OpenAI Agents SDK | Guardrails, custom handlers |
| LlamaIndex | Event handlers |
| Langroid | User responder method |

---

## Observability

### TX: Immutable File Log

Every message is a timestamped file in `.ai/tx/msgs/`:

```
2025-01-17T10-30-00-000Z-task-abc123.md
2025-01-17T10-30-15-000Z-complete-def456.md
```

**Debugging**: `ls -la`, `cat`, `grep`. No special tooling required.

### LangGraph: LangSmith

Native integration with zero-overhead async tracing. Time-travel debugging: replay from any checkpoint.

### AutoGen / Semantic Kernel: OpenTelemetry

Enterprise-grade distributed tracing. Azure Monitor integration.

### CrewAI: Verbose Mode

Step-by-step console logging. Third-party integrations for production.

### OpenAI Agents SDK: Built-in Tracing

Automatic trace collection for debugging.

---

## Tool Integration

### TX: MCP Servers Per-Agent

```yaml
agents:
  - name: researcher
    mcpServers:
      search:
        command: npx
        args: ["-y", "@anthropic/mcp-search"]
```

Per-agent or mesh-level MCP configuration. Tool restriction modes: `unrestricted` or `mcp-only`.

**Gap**: No global MCP registry across meshes.

### LangGraph: Function Tools + MCP

Decorator-based tools with automatic schema generation. MCP support.

### CrewAI: Built-in + Custom Tools

Pre-built tools (search, file ops) plus custom Python functions.

### Semantic Kernel: Plugin Architecture

Native functions decorated as kernel functions. Semantic functions from prompt templates.

### OpenAI Agents SDK: @function_tool

```python
@function_tool
def get_weather(city: str) -> str:
    return weather_api(city)
```

---

## Configuration Complexity

| Framework | Learning Curve | Config Style | Best For |
|-----------|---------------|--------------|----------|
| TX | Low-Medium | YAML + Markdown prompts | File-native workflows |
| LangGraph | High | Python DSL | Complex control flow |
| AutoGen | Medium | Python/JSON | Conversational agents |
| CrewAI | Low | YAML + Python | Rapid prototyping |
| Semantic Kernel | Medium | Python/.NET | Enterprise integration |
| OpenAI Agents SDK | Low | Python | Minimal abstraction |
| LlamaIndex | Medium | Python DSL | Document processing |
| Langroid | Medium | Python/Pydantic | RAG applications |
| Agency Swarm | Low | Python | Swarm patterns |

---

## Unique TX Concepts

### Mesh

Named collection of agents with shared routing table. Not just a graph—a deployment unit with:

- Entry point agent
- Completion agent
- Routing table
- Workspace configuration
- Lifecycle hooks

### Parity Gate

Completion agent cannot signal `complete` until all pending inter-agent asks are resolved. Prevents premature completion when agents have outstanding questions.

### Entry Point ≠ Completion Agent

Task entry and task completion are decoupled:

```yaml
entry_point: interviewer      # First agent to receive work
completion_agent: writer      # Agent that signals completion to user
```

### Ask/Ask-Response

Inter-agent queries without control transfer:

```
Agent A sends ask → A enters awaiting state → Agent B responds → A resumes
```

Lateral coordination without losing context.

### Rearmatter

Optional transparency metadata for self-assessment:

```yaml
grade: B
confidence: 0.82
gaps: ["Missing edge case coverage"]
```

### Workspace Templating

Dynamic path resolution:

```yaml
workspace:
  basePath: .ai/research/{topic}/
  expectedOutputFiles:
    - report.md
    - sources.json
```

---

## Convergent Patterns

TX converges with other frameworks on these fundamental problems:

### 1. Control Flow

| Framework | Mechanism |
|-----------|-----------|
| TX | Status-based routing tables |
| LangGraph | Graph edges (conditional/static) |
| AutoGen | Speaker selection |
| CrewAI | Task dependencies |
| Others | Various orchestration patterns |

### 2. State Threading

| Framework | Mechanism |
|-----------|-----------|
| TX | Session resume + workspace files |
| LangGraph | Reducer-driven state + checkpoints |
| AutoGen | Conversation history |
| CrewAI | Task outputs |
| Others | Context objects, memory stores |

### 3. Quality Gates

| Framework | Mechanism |
|-----------|-----------|
| TX | External LLM gates (checklist, rubric, adversarial) |
| LangGraph | Conditional nodes with validation |
| AutoGen | Evaluation patterns |
| CrewAI | Task guardrails |

**TX distinction**: Quality gates are *external* to the solving agent. Self-assessment without external validation is sophisticated rationalization.

### 4. Termination

| Framework | Mechanism |
|-----------|-----------|
| TX | Parity gate + completion_agent |
| LangGraph | END node + conditional edges |
| AutoGen | Termination conditions |
| CrewAI | Final task completion |

---

## Tradeoffs

### TX Advantages

| Advantage | Why It Matters |
|-----------|---------------|
| **File-based observability** | Debug with `ls`, `cat`, `grep`. No special tooling. |
| **Ephemeral workers** | No state drift, zombie processes, or memory bloat. |
| **LLM-native protocol** | Models already think in files. No API gymnastics. |
| **External critique** | Quality gates avoid confirmation bias. |
| **Status semantics** | Routing based on meaning, not structure. |
| **Parity gate** | Prevents premature completion. |

### TX Disadvantages

| Disadvantage | Mitigation |
|--------------|------------|
| **Filesystem latency** | Acceptable for async workflows, not real-time |
| **No time-travel debug** | Session resume exists; replay not implemented |
| **No global MCP registry** | Per-mesh config; could add central registry |
| **Manual state handoff** | Summaries as first-class citizens (future) |

---

## When to Choose TX

**Choose TX when:**

- Observability and auditability are critical
- You want to debug with standard Unix tools
- Ephemeral, stateless workers fit your mental model
- File-based workflows are natural for your use case
- External quality validation matters
- Human-in-the-loop is a first-class requirement

**Choose something else when:**

- Real-time latency is critical
- You need time-travel debugging today
- You prefer graph-based visual tooling
- Your team is already deep in LangChain/LangGraph ecosystem
- Enterprise Microsoft integration is required (Semantic Kernel)
- Document processing is the primary focus (LlamaIndex)

---

## References

### TX
- [Mesh Reference](./meshes.md)
- [Mesh Configuration](./mesh-config.md)
- [Message Format](./message-format.md)

### External Frameworks
- [LangGraph Documentation](https://docs.langchain.com/oss/python/langgraph/overview)
- [AutoGen Documentation](https://microsoft.github.io/autogen/)
- [CrewAI Documentation](https://docs.crewai.com/)
- [Semantic Kernel Documentation](https://learn.microsoft.com/semantic-kernel/)
- [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/)
- [LlamaIndex Workflows](https://www.llamaindex.ai/workflows)
- [Langroid Documentation](https://langroid.github.io/langroid/)
- [Agency Swarm](https://github.com/VRSEN/agency-swarm)
