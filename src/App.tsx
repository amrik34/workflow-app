// src/App.tsx
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

/**
 * Complete App.tsx - Real-time DAG demo (TypeScript + React)
 *
 * Usage:
 *  - Create a React + TypeScript project (Vite or CRA).
 *  - Replace src/App.tsx with this file.
 *  - Ensure React & ReactDOM versions are compatible with hooks.
 */

type NodeState = "idle" | "running" | "failed" | "completed";

type WorkflowNode = {
  id: string;
  name: string;
  x: number;
  y: number;
  state: NodeState;
  lastUpdated: number;
  log?: string;
};

type SocketEvent = {
  type: "node_state";
  nodeId: string;
  state: NodeState;
  ts: number;
  log?: string;
  // simulate latency measurement
  sentAt?: number;
};

const NODE_RADIUS = 32;
const FLUSH_MS = 80; // batch flush interval for events

// Colors for states (kept here so it's easy to override)
const STATE_COLORS: Record<NodeState, string> = {
  idle: "#90a4ae",
  running: "#f0a500",
  failed: "#e63946",
  completed: "#2a9d8f",
};

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString();
}

function randomState(prev: NodeState): NodeState {
  if (!prev || prev === "idle") return "running";
  if (prev === "running") {
    const r = Math.random();
    if (r < 0.12) return "failed";
    if (r < 0.5) return "completed";
    return "running";
  }
  // completed/failed -> remain or idle rarely
  return Math.random() < 0.05 ? "idle" : prev;
}

/* -------------------------
   Node (memoized)
   ------------------------- */
const Node: React.FC<{
  node: WorkflowNode;
  selected: boolean;
  onSelect: (id: string) => void;
}> = React.memo(({node, selected, onSelect}) => {
  // Accessible label
  const ariaLabel = `${node.name} — ${node.state}`;

  // circle style with transition for color fade
  const circleStyle: React.CSSProperties = {
    transition: "fill 300ms ease, transform 150ms ease",
    transform: selected ? "scale(1.05)" : "scale(1)",
  };

  return (
    <g
      transform={`translate(${node.x}, ${node.y})`}
      onClick={() => onSelect(node.id)}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      style={{cursor: "pointer", userSelect: "none"}}>
      <defs>
        <filter
          id={`shadow-${node.id}`}
          x="-50%"
          y="-50%"
          width="200%"
          height="200%">
          <feDropShadow
            dx="0"
            dy="2"
            stdDeviation="4"
            floodColor="#000"
            floodOpacity="0.12"
          />
        </filter>
      </defs>

      <circle
        r={NODE_RADIUS}
        fill={STATE_COLORS[node.state]}
        style={circleStyle}
        stroke={selected ? "#0b1726" : "transparent"}
        strokeWidth={selected ? 3 : 0}
        filter={selected ? `url(#shadow-${node.id})` : undefined}
      />
      <text
        x={0}
        y={-6}
        textAnchor="middle"
        fontSize={12}
        style={{pointerEvents: "none", fill: "#ffffff", fontWeight: 600}}>
        {node.name}
      </text>
      <rect
        x={-NODE_RADIUS}
        y={NODE_RADIUS + 8}
        width={NODE_RADIUS * 2}
        height={18}
        rx={8}
        fill="#ffffffcc"
        style={{pointerEvents: "none"}}
      />
      <text
        x={0}
        y={NODE_RADIUS + 22}
        textAnchor="middle"
        fontSize={11}
        style={{pointerEvents: "none", fill: "#111827"}}>
        {node.state}
      </text>
    </g>
  );
});
Node.displayName = "Node";

/* -------------------------
   Main App
   ------------------------- */
export default function App(): React.ReactElement {
  // initial nodes (positions are fixed for demo)
  const initialNodes = useMemo<WorkflowNode[]>(
    () => [
      {
        id: "n1",
        name: "Fetch",
        x: 140,
        y: 120,
        state: "idle",
        lastUpdated: Date.now(),
        log: "",
      },
      {
        id: "n2",
        name: "Validate",
        x: 360,
        y: 120,
        state: "idle",
        lastUpdated: Date.now(),
        log: "",
      },
      {
        id: "n3",
        name: "Transform",
        x: 580,
        y: 120,
        state: "idle",
        lastUpdated: Date.now(),
        log: "",
      },
      {
        id: "n4",
        name: "Store",
        x: 360,
        y: 300,
        state: "idle",
        lastUpdated: Date.now(),
        log: "",
      },
    ],
    []
  );

  const [nodes, setNodes] = useState<WorkflowNode[]>(initialNodes);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // telemetry refs
  const lastRenderRef = useRef<number>(performance.now());
  const socketLatencyRef = useRef<number | null>(null);

  // Event batching
  const eventQueueRef = useRef<SocketEvent[]>([]);
  const flushTimerRef = useRef<number | null>(null);

  // simulate websocket that pushes events into eventQueueRef
  useEffect(() => {
    let mounted = true;
    // random interval generator; this simulates bursts/variable latency
    function scheduleNext() {
      const delay = 350 + Math.random() * 900; // 350 - 1250ms
      return window.setTimeout(() => {
        if (!mounted) return;
        // pick a random node
        const pick = nodes[Math.floor(Math.random() * nodes.length)];
        const newState = randomState(pick.state);
        const event: SocketEvent = {
          type: "node_state",
          nodeId: pick.id,
          state: newState,
          ts: Date.now(),
          log: `${
            pick.name
          } -> ${newState} @ ${new Date().toLocaleTimeString()}`,
          sentAt: Date.now() - Math.floor(Math.random() * 300), // simulate network lag up to 300ms
        };
        eventQueueRef.current.push(event);
        // update simulated latency measure
        if (event.sentAt) {
          socketLatencyRef.current = Date.now() - event.sentAt;
        }
        scheduleNext();
      }, delay);
    }

    const first = scheduleNext();

    return () => {
      mounted = false;
      clearTimeout(first);
    };
    // intentionally depend on nodes for pick randomness; nodes is stable in this demo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  // flush queued events in batches every FLUSH_MS
  useEffect(() => {
    function flushEvents() {
      const q = eventQueueRef.current.splice(0, eventQueueRef.current.length);
      if (q.length > 0) {
        // batch update state in one setState call (functional)
        setNodes((prev) => {
          // create a shallow copy
          const map = new Map(prev.map((n) => [n.id, {...n}]));
          for (const ev of q) {
            const node = map.get(ev.nodeId);
            if (!node) continue;
            // basic dedupe: only apply if ts is newer
            if (ev.ts >= node.lastUpdated) {
              node.state = ev.state;
              node.lastUpdated = ev.ts;
              node.log = ev.log;
            }
          }
          return Array.from(map.values());
        });
      }
    }

    // start timer
    flushTimerRef.current = window.setInterval(flushEvents, FLUSH_MS);
    return () => {
      if (flushTimerRef.current) window.clearInterval(flushTimerRef.current);
    };
  }, []);

  // render telemetry - logs render delta (ms)
  useEffect(() => {
    const now = performance.now();
    const delta = Math.round(now - lastRenderRef.current);
    console.log("render delta ms:", delta);
    lastRenderRef.current = now;
  });

  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  // click handler
  const handleSelect = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  // Retry action: push a synthetic event immediately
  const handleRetry = useCallback(
    (id: string) => {
      const ev: SocketEvent = {
        type: "node_state",
        nodeId: id,
        state: "running",
        ts: Date.now(),
        log: "Manual retry triggered",
        sentAt: Date.now(),
      };
      // push directly and flush immediately (simulate user action)
      eventQueueRef.current.push(ev);
      // immediate flush
      setNodes((prev) =>
        prev.map((n) =>
          n.id === id
            ? {...n, state: ev.state, lastUpdated: ev.ts, log: ev.log}
            : n
        )
      );
    },
    [setNodes]
  );

  // keyboard navigation: left/right/top/bottom move selection
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!selected) {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          setSelectedId(nodes[0]?.id ?? null);
        }
        return;
      }
      const idx = nodes.findIndex((n) => n.id === selected.id);
      if (idx === -1) return;
      if (e.key === "ArrowRight") {
        setSelectedId(nodes[Math.min(nodes.length - 1, idx + 1)].id);
      } else if (e.key === "ArrowLeft") {
        setSelectedId(nodes[Math.max(0, idx - 1)].id);
      } else if (e.key === "Escape") {
        setSelectedId(null);
      } else if (e.key === "Enter") {
        // toggle retry on Enter for convenience
        handleRetry(selected.id);
      }
    },
    [nodes, selected, handleRetry]
  );

  // small metrics display
  const socketLatency = socketLatencyRef.current;

  return (
    <div
      onKeyDown={handleKeyDown}
      tabIndex={0}
      style={{
        display: "flex",
        height: "100vh",
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto",
        background: "#f8fafc",
        color: "#0f172a",
      }}>
      <main style={{flex: 1, padding: 18}}>
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}>
          <div>
            <h2 style={{margin: 0}}>Workflow — Real-time App.tsx Demo</h2>
            <p style={{margin: "6px 0 0", color: "#475569"}}>
              Simulated WebSocket → batched updates → per-node detail panel
            </p>
          </div>
          <div style={{textAlign: "right", color: "#475569"}}>
            <div>
              Socket latency (sim):{" "}
              {socketLatency ? `${socketLatency} ms` : "—"}
            </div>
            <div style={{fontSize: 12, marginTop: 6, color: "#94a3b8"}}>
              Tip: Click a node or use Arrow keys. Press Enter to retry selected
              node.
            </div>
          </div>
        </header>

        <section
          style={{
            marginTop: 16,
            borderRadius: 8,
            padding: 12,
            background: "#ffffff",
            boxShadow: "0 1px 4px rgba(2,6,23,0.06)",
          }}>
          <svg
            width="100%"
            height="520"
            style={{display: "block", borderRadius: 6}}>
            {/* Links between nodes (simple straight lines for demo) */}
            {/* n1 -> n2, n2 -> n3, n2 -> n4 */}
            <line
              x1={140 + NODE_RADIUS}
              y1={120}
              x2={360 - NODE_RADIUS}
              y2={120}
              stroke="#e2e8f0"
              strokeWidth={3}
            />
            <line
              x1={360 + NODE_RADIUS}
              y1={120}
              x2={580 - NODE_RADIUS}
              y2={120}
              stroke="#e2e8f0"
              strokeWidth={3}
            />
            <line
              x1={360}
              y1={120 + NODE_RADIUS}
              x2={360}
              y2={300 - NODE_RADIUS}
              stroke="#e2e8f0"
              strokeWidth={3}
            />

            {nodes.map((n) => (
              <Node
                key={n.id}
                node={n}
                selected={selectedId === n.id}
                onSelect={handleSelect}
              />
            ))}
          </svg>
        </section>

        <footer style={{marginTop: 10, color: "#64748b", fontSize: 13}}>
          <span>
            Render telemetry logged to console. Batched flush interval:{" "}
            {FLUSH_MS} ms.
          </span>
        </footer>
      </main>

      <aside
        style={{
          width: 360,
          borderLeft: "1px solid #e6eef7",
          padding: 16,
          background: "#fbfdff",
          overflowY: "auto",
        }}>
        <h3 style={{marginTop: 0}}>Node Details</h3>
        {selected ? (
          <div>
            <div style={{display: "flex", alignItems: "center", gap: 10}}>
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 4,
                  background: STATE_COLORS[selected.state],
                }}
              />
              <div>
                <div style={{fontWeight: 700}}>{selected.name}</div>
                <div style={{color: "#64748b", fontSize: 12}}>
                  {selected.id}
                </div>
              </div>
            </div>

            <div style={{marginTop: 12}}>
              <div style={{fontSize: 13, marginBottom: 6}}>
                <strong>State:</strong> <code>{selected.state}</code>
              </div>
              <div style={{fontSize: 13, marginBottom: 6}}>
                <strong>Last Updated:</strong>{" "}
                {formatTime(selected.lastUpdated)}
              </div>

              <div style={{marginTop: 8}}>
                <strong style={{display: "block", marginBottom: 6}}>
                  Recent log
                </strong>
                <div
                  style={{
                    background: "#0f172a",
                    color: "#d1fae5",
                    padding: 10,
                    borderRadius: 6,
                    fontFamily: "monospace",
                    fontSize: 13,
                    whiteSpace: "pre-wrap",
                  }}>
                  {selected.log ?? "—"}
                </div>
              </div>

              <div style={{display: "flex", gap: 8, marginTop: 12}}>
                <button
                  onClick={() => handleRetry(selected.id)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "none",
                    background: "#0ea5a4",
                    color: "#fff",
                    cursor: "pointer",
                  }}>
                  Retry
                </button>

                <button
                  onClick={() => {
                    // simulate opening full logs
                    console.log(`[UI] Open full logs for ${selected!.id}`);
                    alert("Pretend to open full logs (console logged).");
                  }}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                    color: "#0f172a",
                    cursor: "pointer",
                  }}>
                  Full logs
                </button>
              </div>

              <div style={{marginTop: 12, color: "#475569", fontSize: 12}}>
                <div>
                  Upstream / Downstream quick actions could appear here.
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{color: "#64748b"}}>
            <p>Select a node on the graph to show details.</p>
            <p>
              Keyboard: <kbd>←</kbd> <kbd>→</kbd> to navigate nodes,{" "}
              <kbd>Enter</kbd> to retry, <kbd>Esc</kbd> to deselect.
            </p>
          </div>
        )}

        <hr style={{margin: "16px 0", borderColor: "#e6eef7"}} />

        <div style={{fontSize: 13, color: "#475569"}}>
          <div>
            <strong>Frontend telemetry (examples)</strong>
          </div>
          <ul>
            <li>Render delta logged to console each render cycle.</li>
            <li>Socket latency simulated in header (ms).</li>
            <li>
              Batch flush interval: {FLUSH_MS} ms — reduces re-renders under
              bursts.
            </li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
