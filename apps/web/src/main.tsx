import React, { useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import "./styles.css";

type ApprovalMode = "suggest" | "workspace-write" | "full-access";

type AgentEvent =
  | { type: "session_started"; sessionId: string; workspace: string; model: string }
  | { type: "assistant_message"; content: string }
  | { type: "tool_started"; name: string; input: unknown }
  | { type: "tool_finished"; name: string; output: string; ok: boolean }
  | { type: "step"; index: number; maxSteps: number }
  | { type: "final"; content: string }
  | { type: "error"; message: string };

type LogKind = "Session" | "Step" | "Assistant" | "Tool" | "Final" | "Error";
type LogTone = "plain" | "muted" | "good" | "bad" | "accent";
type MemoryState = "idle" | "loading" | "ready" | "error";
type LoadState = "idle" | "loading" | "ready" | "error";

type LogItem = {
  id: string;
  tone: LogTone;
  kind: LogKind;
  title: string;
  meta?: string;
  body?: string;
  timestamp: string;
};

type SessionSummary = {
  sessionId: string;
  workspace: string;
  model?: string;
  status: "running" | "completed" | "errored";
  createdAt: string;
  updatedAt: string;
  eventCount: number;
  lastEventType?: AgentEvent["type"];
  finalContent?: string;
  errorMessage?: string;
};

const defaultWorkspace = localStorage.getItem("deepcodex.workspace") ?? "";
const serverUrl = import.meta.env.VITE_DEEPCODEX_SERVER_URL ?? "http://127.0.0.1:17361";
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

const modeOptions: Array<{ value: ApprovalMode; label: string; detail: string }> = [
  { value: "suggest", label: "Suggest", detail: "Read-only planning and recommendations" },
  { value: "workspace-write", label: "Workspace write", detail: "Edits and commands inside the workspace" },
  { value: "full-access", label: "Full access", detail: "Unrestricted local execution for trusted runs" }
];

const taskPresets = [
  {
    label: "Review the current app",
    detail: "Find the highest-risk gaps and next fixes.",
    prompt: "Inspect this repository and identify the highest-risk implementation gaps with concrete next steps."
  },
  {
    label: "Plan a focused change",
    detail: "Turn a feature idea into an implementation plan.",
    prompt: "Inspect the codebase and propose a focused implementation plan for the next useful feature."
  },
  {
    label: "Verify recent work",
    detail: "Run the smallest relevant checks and summarize risk.",
    prompt: "Inspect the repository, run the relevant checks, and summarize what is verified and what remains risky."
  }
];

const memoryStateLabels: Record<MemoryState, string> = {
  idle: "Idle",
  loading: "Loading",
  ready: "Ready",
  error: "Error"
};

function App() {
  const [workspace, setWorkspace] = useState(defaultWorkspace);
  const [prompt, setPrompt] = useState("Inspect this repository and propose the safest next implementation step.");
  const [mode, setMode] = useState<ApprovalMode>("workspace-write");
  const [isRunning, setIsRunning] = useState(false);
  const [items, setItems] = useState<LogItem[]>([]);
  const [finalText, setFinalText] = useState("");
  const [memory, setMemory] = useState("");
  const [memoryPath, setMemoryPath] = useState("");
  const [memoryState, setMemoryState] = useState<MemoryState>("idle");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionState, setSessionState] = useState<LoadState>("idle");

  const status = useMemo(() => {
    if (isRunning) {
      return "Running";
    }
    if (finalText) {
      return "Ready";
    }
    return "Idle";
  }, [finalText, isRunning]);

  const counts = useMemo(
    () => ({
      errors: items.filter((item) => item.kind === "Error" || item.tone === "bad").length,
      finals: items.filter((item) => item.kind === "Final").length,
      tools: items.filter((item) => item.kind === "Tool").length
    }),
    [items]
  );

  const latestItem = items.length > 0 ? items[items.length - 1] : undefined;
  const canRun = prompt.trim().length > 0 && !isRunning;
  const statusTone = isRunning ? "running" : finalText ? "ready" : "idle";
  const memoryLabel = memoryStateLabels[memoryState];

  async function runAgent() {
    if (!prompt.trim()) {
      return;
    }

    setIsRunning(true);
    setFinalText("");
    setItems([]);
    localStorage.setItem("deepcodex.workspace", workspace);

    try {
      const response = await fetch(`${serverUrl}/api/agent/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, workspace, mode, maxSteps: 12 })
      });

      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }

      if (!response.body) {
        throw new Error("The server did not return a stream.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          applyEventChunk(chunk);
        }
      }

      if (buffer.trim()) {
        applyEventChunk(buffer);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushItem({ kind: "Error", tone: "bad", title: "Run failed", meta: "Client", body: message });
    } finally {
      setIsRunning(false);
    }
  }

  async function loadMemory() {
    const params = new URLSearchParams();
    if (workspace) {
      params.set("workspace", workspace);
    }
    setMemoryState("loading");
    try {
      const response = await fetch(`${serverUrl}/api/memory?${params.toString()}`);
      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }
      const body = (await response.json()) as { memory: string; path?: string };
      setMemory(body.memory);
      setMemoryPath(body.path ?? "");
      setMemoryState("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMemory(message);
      setMemoryPath("");
      setMemoryState("error");
    }
  }

  async function loadSessions() {
    const params = new URLSearchParams();
    if (workspace) {
      params.set("workspace", workspace);
    }
    setSessionState("loading");
    try {
      const response = await fetch(`${serverUrl}/api/sessions?${params.toString()}`);
      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }
      const body = (await response.json()) as { sessions: SessionSummary[] };
      setSessions(body.sessions);
      setSessionState("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSessions([
        {
          sessionId: "load-error",
          workspace: workspace || "default",
          status: "errored",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          eventCount: 0,
          errorMessage: message
        }
      ]);
      setSessionState("error");
    }
  }

  function applyEventChunk(chunk: string) {
    const dataLines = chunk.split("\n").filter((entry) => entry.startsWith("data: "));
    for (const line of dataLines) {
      try {
        applyEvent(JSON.parse(line.slice(6)) as AgentEvent);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushItem({ kind: "Error", tone: "bad", title: "Malformed stream event", meta: "Parser", body: message });
      }
    }
  }

  function applyEvent(event: AgentEvent) {
    switch (event.type) {
      case "session_started":
        pushItem({
          kind: "Session",
          tone: "muted",
          title: "Session started",
          meta: `${event.sessionId.slice(0, 8)} / ${event.model}`,
          body: event.workspace
        });
        break;
      case "step":
        pushItem({
          kind: "Step",
          tone: "accent",
          title: "Step in progress",
          meta: `${event.index} of ${event.maxSteps}`
        });
        break;
      case "assistant_message":
        pushItem({
          kind: "Assistant",
          tone: "plain",
          title: "Assistant message",
          meta: `${event.content.length} chars`,
          body: event.content
        });
        break;
      case "tool_started":
        pushItem({
          kind: "Tool",
          tone: "muted",
          title: event.name,
          meta: "Tool started",
          body: formatBody(event.input)
        });
        break;
      case "tool_finished":
        pushItem({
          kind: "Tool",
          tone: event.ok ? "good" : "bad",
          title: event.name,
          meta: event.ok ? "Tool completed" : "Tool failed",
          body: event.output
        });
        break;
      case "final":
        setFinalText(event.content);
        pushItem({
          kind: "Final",
          tone: "good",
          title: "Final response",
          meta: `${event.content.length} chars`,
          body: event.content
        });
        break;
      case "error":
        pushItem({ kind: "Error", tone: "bad", title: "Error", meta: "Agent", body: event.message });
        break;
    }
  }

  function pushItem(item: Omit<LogItem, "id" | "timestamp">) {
    setItems((current) => [...current, { ...item, id: crypto.randomUUID(), timestamp: formatTimestamp() }]);
  }

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="Agent controls">
        <div className="brand">
          <div>
            <div className="brandName">DeepCodex</div>
            <div className="brandMeta">Agent control console</div>
          </div>
        </div>

        <section className="panel">
          <div className="panelHeading">
            <label htmlFor="workspace">Workspace</label>
            <span className="fieldStatus">{workspace.trim() ? "Set" : "Default"}</span>
          </div>
          <input
            id="workspace"
            value={workspace}
            onChange={(event) => setWorkspace(event.target.value)}
            placeholder="D:\\Coding\\DeepCodex"
            spellCheck={false}
          />
        </section>

        <section className="panel">
          <div className="panelHeading">
            <label>Execution</label>
            <span className="fieldStatus">{mode}</span>
          </div>
          <div className="segmented" role="group" aria-label="Execution mode">
            {modeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`modeOption ${mode === option.value ? "active" : ""}`}
                onClick={() => setMode(option.value)}
                aria-pressed={mode === option.value}
              >
                <span>{option.label}</span>
                <small>{option.detail}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="panel metrics" aria-label="Session metrics">
          <div className="metric">
            <span>Status</span>
            <strong>{status}</strong>
          </div>
          <div className="metric">
            <span>Events</span>
            <strong>{items.length}</strong>
          </div>
          <div className="metric">
            <span>Tools</span>
            <strong>{counts.tools}</strong>
          </div>
          <div className="metric">
            <span>Errors</span>
            <strong>{counts.errors}</strong>
          </div>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="titleBlock">
            <span className="eyebrow">Agent Session</span>
            <h1>DeepCodex Console</h1>
            <p>Plan, edit, run, and remember across local repositories.</p>
          </div>
          <div className="topActions">
            <div className={`runState ${statusTone}`} aria-live="polite">
              {status}
            </div>
            <button className="secondary" type="button" onClick={loadMemory} disabled={memoryState === "loading"}>
              {memoryState === "loading" ? "Loading memory" : "Load memory"}
            </button>
            <button className="secondary" type="button" onClick={loadSessions} disabled={sessionState === "loading"}>
              {sessionState === "loading" ? "Loading sessions" : "Load sessions"}
            </button>
          </div>
        </header>

        <section className="sessionBoard">
          <section className="streamSurface" aria-labelledby="stream-title">
            <div className="sectionHeader">
              <div>
                <span className="eyebrow">Live trace</span>
                <h2 id="stream-title">Event stream</h2>
              </div>
              <div className="streamMeta" aria-label="Event summary">
                <span>{items.length} events</span>
                <span>{counts.tools} tools</span>
                <span>{counts.errors} errors</span>
              </div>
            </div>

            <div className="conversation" aria-live="polite">
              {items.length === 0 ? (
                <div className="emptyState">
                  <div className="emptyText">
                    <span className="eyebrow">No events yet</span>
                    <h2>Ready for a focused repository task</h2>
                    <p>Scoped prompts, visible tool output, and final responses stay together in this workspace view.</p>
                  </div>
                  <div className="presetGrid" aria-label="Prompt presets">
                    {taskPresets.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        className="presetButton"
                        onClick={() => setPrompt(preset.prompt)}
                      >
                        <span>{preset.label}</span>
                        <small>{preset.detail}</small>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="eventList">
                  {items.map((item) => (
                    <article key={item.id} className={`event ${item.tone}`}>
                      <div className="eventHeader">
                        <div className="eventIdentity">
                          <span className="eventKind">{item.kind}</span>
                          <div className="eventTitle">{item.title}</div>
                        </div>
                        <div className="eventAside">
                          {item.meta ? <span>{item.meta}</span> : null}
                          <time>{item.timestamp}</time>
                        </div>
                      </div>
                      {item.body ? <pre className="eventBody">{item.body}</pre> : null}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        </section>

        <footer className="composer">
          <div className="composerField">
            <label htmlFor="prompt">Task prompt</label>
            <textarea id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} />
          </div>
          <div className="composerActions">
            <div className="promptMeta">
              {prompt.trim().length} chars
              {latestItem ? ` / latest: ${latestItem.kind}` : ""}
            </div>
            <button type="button" onClick={runAgent} disabled={!canRun}>
              {isRunning ? "Running" : "Run agent"}
            </button>
          </div>
        </footer>
      </section>

      <aside className="rightRail" aria-label="Memory and final output">
        <section className="railPanel finalPanel">
          <div className="sectionHeader compact">
            <div>
              <span className="eyebrow">Final output</span>
              <h2>Response</h2>
            </div>
            <span className={`outputStatus ${finalText ? "ready" : ""}`}>{finalText ? "Ready" : "Waiting"}</span>
          </div>
          <pre className={finalText ? "railText outputText" : "railText placeholderText"}>
            {finalText || "No final response yet."}
          </pre>
        </section>
        <section className="railPanel">
          <div className="sectionHeader compact">
            <div>
              <span className="eyebrow">Workspace memory</span>
              <h2>Memory</h2>
            </div>
            <span className={`outputStatus ${memoryState}`}>{memoryLabel}</span>
          </div>
          <pre className={memory ? "railText" : "railText placeholderText"}>{memory || "No memory loaded."}</pre>
          {memoryPath ? <div className="railFoot">{memoryPath}</div> : null}
        </section>
        <section className="railPanel">
          <div className="sectionHeader compact">
            <div>
              <span className="eyebrow">Audit trail</span>
              <h2>Recent sessions</h2>
            </div>
            <span className={`outputStatus ${sessionState}`}>{sessionState === "idle" ? "Idle" : sessionState}</span>
          </div>
          <div className="sessionList">
            {sessions.length === 0 ? (
              <p className="sessionEmpty">No sessions loaded.</p>
            ) : (
              sessions.slice(0, 8).map((session) => (
                <article key={session.sessionId} className={`sessionRow ${session.status}`}>
                  <div className="sessionRowHead">
                    <strong>{session.sessionId.slice(0, 8)}</strong>
                    <span>{session.status}</span>
                  </div>
                  <div className="sessionRowMeta">
                    {session.eventCount} events / {session.lastEventType ?? "none"}
                  </div>
                  <div className="sessionRowText">{session.errorMessage ?? session.finalContent ?? session.workspace}</div>
                </article>
              ))
            )}
          </div>
        </section>
      </aside>
    </main>
  );
}

async function readResponseError(response: Response) {
  const fallback = `${response.status} ${response.statusText}`.trim();
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { error?: string; message?: string };
    return payload.error ?? payload.message ?? fallback;
  }
  const text = await response.text();
  return text || fallback;
}

function formatBody(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  const serialized = JSON.stringify(value, null, 2);
  return serialized ?? String(value);
}

function formatTimestamp() {
  return timeFormatter.format(new Date());
}

type RootElement = HTMLElement & { __deepcodexRoot?: Root };

const rootElement = document.getElementById("root") as RootElement;
const root = rootElement.__deepcodexRoot ?? createRoot(rootElement);
rootElement.__deepcodexRoot = root;
root.render(<App />);
