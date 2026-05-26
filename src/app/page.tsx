"use client";

import React, { useState, useEffect, useRef } from "react";
import { supervisorClient } from "@/lib/rpc-client";
import { UserButton } from "@clerk/nextjs";

interface ExecutionLog {
  timestamp: string;
  type: "info" | "success" | "warn" | "error";
  message: string;
}

interface InvocRecord {
  id: string;
  controllerName: string;
  time: string;
  success: boolean;
  duration: string;
}

// MVDev distinguishes three names for the same flow:
//   - REGISTER_CONTROLLER name (camelCase) is the runController-RPC registry key.
//   - REGISTER_CRON_JOB name (kebab-case) is what gets written to
//     `invocations.controller_name` (and `pings.cron_name + "-default"`).
// These are NOT the same string. The portal must use each in the right slot.
const A2000 = {
  invocationsControllerName: "update-a2000-pick-tickets-from-logiwa",
  pingTaskName: "update-a2000-pick-tickets-from-logiwa-default",
  runControllerName: "updateA2000PickTicketsFromLogiwa",
  unpublishedQueue: "a2000-logiwa-unpublished",
} as const;
const APPAMAN = {
  invocationsControllerName: "pushAmPickTicketToShipmonk",
  pingTaskName: "shipmonk-sync-default",
  runControllerName: "shipmonk-sync",
} as const;

export default function SupervisorDashboard() {
  // Connection states
  const [isBackendOnline, setIsBackendOnline] = useState<boolean>(false);
  const [checkingConnection, setCheckingConnection] = useState<boolean>(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // A2000 <> Logiwa State
  const [a2000Liveness, setA2000Liveness] = useState<number>(0); 
  const [a2000LastComplete, setA2000LastComplete] = useState<string>("Never");
  const [a2000QueueDepth, setA2000QueueDepth] = useState<number>(0);
  const [runningA2000, setRunningA2000] = useState<boolean>(false);
  const [a2000History, setA2000History] = useState<InvocRecord[]>([]);
  const [a2000ConsoleLogs, setA2000ConsoleLogs] = useState<ExecutionLog[]>([]);

  // Apparel Magic <> Shipmonk State
  // Initial "—" + null heart-health avoids the old 0%-ring / 100%-text mismatch
  // while waiting for the first ping/invocations response.
  const [appamanSuccessRatio, setAppamanSuccessRatio] = useState<string>("—");
  const [appamanLastComplete, setAppamanLastComplete] = useState<string>("Never");
  const [isHeapHealthy, setIsHeapHealthy] = useState<boolean | null>(null);
  const [runningAppaman, setRunningAppaman] = useState<boolean>(false);
  const [appamanHistory, setAppamanHistory] = useState<InvocRecord[]>([]);
  const [appamanConsoleLogs, setAppamanConsoleLogs] = useState<ExecutionLog[]>([]);

  // Refs for consoles
  const a2000ConsoleEndRef = useRef<HTMLDivElement>(null);
  const appamanConsoleEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (a2000ConsoleEndRef.current) {
      a2000ConsoleEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [a2000ConsoleLogs]);

  useEffect(() => {
    if (appamanConsoleEndRef.current) {
      appamanConsoleEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [appamanConsoleLogs]);

  // Load backend telemetry data
  const testConnectionAndFetchData = async () => {
    try {
      setCheckingConnection(true);
      setConnectionError(null);

      const qDepth = await supervisorClient.getQueueDepth({ queueName: A2000.unpublishedQueue });
      setA2000QueueDepth(qDepth.pendingCount);
      setIsBackendOnline(true);

      // GetPings takes a single required task_name — one call per panel.
      const applyPing = (
        ping: { pingType: string; timestamp: string } | undefined,
        setLast: (s: string) => void,
        setHealthy: (b: boolean) => void,
      ) => {
        if (!ping) {
          setLast("Never");
          setHealthy(false);
          return;
        }
        setLast(ping.timestamp ? new Date(ping.timestamp).toLocaleTimeString() : "Never");
        setHealthy(ping.pingType === "complete" || ping.pingType === "success");
      };

      const fetchLatestPing = async (taskName: string) => {
        try {
          const res = await supervisorClient.getPings({ taskName, limit: 1 });
          return res?.pings?.[0];
        } catch (err) {
          console.warn(`Could not load ${taskName} heartbeat`, err);
          return undefined;
        }
      };

      const [a2000Ping, amPing] = await Promise.all([
        fetchLatestPing(A2000.pingTaskName),
        fetchLatestPing(APPAMAN.pingTaskName),
      ]);
      applyPing(a2000Ping, setA2000LastComplete, (h) => setA2000Liveness(h ? 100 : 0));
      applyPing(amPing, setAppamanLastComplete, setIsHeapHealthy);

      // Recent invocations — fetched sequentially per controller (parallel calls
      // were observed to trip Connect validation on the gateway during boot).
      const toInvocRecord = (inv: { id: string; controllerName: string; startTime: string; endTime: string; success: boolean }): InvocRecord => {
        const time = inv.startTime
          ? new Date(inv.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : "Unknown";
        let duration = "Unknown";
        if (inv.startTime && inv.endTime) {
          const diff = new Date(inv.endTime).getTime() - new Date(inv.startTime).getTime();
          if (!Number.isNaN(diff) && diff >= 0) duration = `${(diff / 1000).toFixed(1)}s`;
        }
        return { id: inv.id, controllerName: inv.controllerName, time, success: inv.success, duration };
      };

      const fetchInvocationsForController = async (controllerName: string): Promise<InvocRecord[]> => {
        try {
          const res = await supervisorClient.getInvocations({ controllerName, limit: 10 });
          return (res?.invocations ?? []).map(toInvocRecord);
        } catch (err) {
          console.error(`Failed to load invocations for ${controllerName}`, err);
          return [];
        }
      };

      const a2000List = await fetchInvocationsForController(A2000.invocationsControllerName);
      const appamanList = await fetchInvocationsForController(APPAMAN.invocationsControllerName);
      setA2000History(a2000List.slice(0, 5));
      setAppamanHistory(appamanList.slice(0, 5));

      // 24h success ratio for the AM panel computed from invocations, not a
      // single ping. Falls back to "—" if we have no recent activity.
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const recent = appamanList.filter((i) => {
        const t = new Date(i.time).getTime();
        return Number.isNaN(t) ? true : t >= oneDayAgo;
      });
      if (recent.length > 0) {
        const ok = recent.filter((i) => i.success).length;
        setAppamanSuccessRatio(`${Math.round((ok / recent.length) * 100)}%`);
      } else {
        setAppamanSuccessRatio("—");
      }
    } catch (err: unknown) {
      console.error("Connection attempt to Connect-RPC server failed:", err);
      setIsBackendOnline(false);
      setConnectionError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckingConnection(false);
    }
  };

  useEffect(() => {
    testConnectionAndFetchData();
  }, []);

  // Fire the RunController RPC and watch for completion. The cron-style
  // controllers exposed here (~10 min duration) always exceed the CloudFront
  // origin-response timeout (~30s) in front of foundry, so the browser sees a
  // CORS-style failure even though the controller ran to completion on the
  // server. We race the RPC against that timeout: fast paths (sub-30s success
  // or validation error) settle directly; slow paths fall through to polling
  // GetInvocations, which the supervisor framework writes on controller end.
  //
  // RunController writes the invocations.controller_name as the exact string
  // passed in — so we poll under the same `runControllerName` we dispatched
  // with, not the cron's kebab name.
  const runWithPoll = async (params: {
    runControllerName: string;
    appendLog: (entry: ExecutionLog) => void;
    onComplete?: (success: boolean) => void;
  }) => {
    const { runControllerName, appendLog, onComplete } = params;
    const clickedAt = new Date().toISOString();
    let resolved = false;

    const runPromise = supervisorClient
      .runController({ controllerName: runControllerName, payloadJson: "{}" })
      .then((response) => ({ kind: "ok" as const, response }))
      .catch((err: unknown) => ({ kind: "err" as const, err }));

    // Phase 1: race the RPC against ~25s. CloudFront cuts at 30s, so anything
    // settling under 25s is a real server response.
    const FAST_PATH_MS = 25_000;
    const fastPath = await Promise.race([
      runPromise,
      new Promise<{ kind: "timeout" }>((r) => setTimeout(() => r({ kind: "timeout" }), FAST_PATH_MS)),
    ]);

    if (fastPath.kind === "ok") {
      resolved = true;
      const r = fastPath.response;
      if (r.success) {
        appendLog({ timestamp: nowTime(), type: "info", message: `Invocation registered: ${r.invocationId}` });
        appendLog({ timestamp: nowTime(), type: "success", message: "Run complete." });
        if (r.outputJson) appendLog({ timestamp: nowTime(), type: "info", message: `Output: ${r.outputJson}` });
      } else {
        appendLog({ timestamp: nowTime(), type: "error", message: `Run failed: ${r.errorMessage || "(no error message)"}` });
      }
      onComplete?.(r.success);
      return;
    }

    if (fastPath.kind === "err") {
      // Sub-25s network/validation failure — surface it directly. (Long-running
      // controllers don't reach this branch; their failures arrive via the
      // timeout path below.)
      resolved = true;
      const msg = fastPath.err instanceof Error ? fastPath.err.message : String(fastPath.err);
      appendLog({ timestamp: nowTime(), type: "error", message: `Dispatch failed: ${msg}` });
      onComplete?.(false);
      return;
    }

    // Phase 2: timeout path. The controller is still running on foundry; the
    // browser just can't read the response. Drop the in-flight promise on the
    // floor (its eventual settle is silently ignored) and poll GetInvocations.
    runPromise.then(() => {
      // suppress late settles after we've moved to polling
    });
    appendLog({
      timestamp: nowTime(),
      type: "info",
      message: "Gateway response timed out (expected for long-running crons). Polling supervisor for completion...",
    });

    const POLL_MS = 5_000;
    const MAX_MS = 20 * 60 * 1000;
    const startedAt = Date.now();
    let lastPollLogTimestamp = "";

    while (!resolved && Date.now() - startedAt < MAX_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      try {
        const res = await supervisorClient.getInvocations({
          controllerName: runControllerName,
          startTimeAfter: clickedAt,
          limit: 1,
        });
        if (res.invocations.length > 0) {
          resolved = true;
          const inv = res.invocations[0];
          let duration = "?";
          if (inv.startTime && inv.endTime) {
            const diff = new Date(inv.endTime).getTime() - new Date(inv.startTime).getTime();
            if (!Number.isNaN(diff) && diff >= 0) duration = `${(diff / 1000).toFixed(1)}s`;
          }
          appendLog({
            timestamp: nowTime(),
            type: inv.success ? "success" : "error",
            message: `${inv.success ? "Completed" : "Failed"} ${inv.id} (duration ${duration})`,
          });
          if (!inv.success && inv.errorMessage) {
            appendLog({ timestamp: nowTime(), type: "error", message: inv.errorMessage });
          }
          onComplete?.(inv.success);
          return;
        }
      } catch {
        // poll-side network blip; continue
      }
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      lastPollLogTimestamp = nowTime();
      appendLog({ timestamp: lastPollLogTimestamp, type: "info", message: `Polling for completion... (${elapsed}s elapsed)` });
    }

    if (!resolved) {
      appendLog({
        timestamp: nowTime(),
        type: "warn",
        message: "Stopped polling after 20 min. Run may still be in progress — check Recent Run History later.",
      });
    }
  };

  const handleRunA2000Sync = async () => {
    if (runningA2000 || !isBackendOnline) return;
    setRunningA2000(true);
    setA2000ConsoleLogs([{ timestamp: nowTime(), type: "info", message: "Dispatching execution trigger to A2000 controller..." }]);
    try {
      await runWithPoll({
        runControllerName: A2000.runControllerName,
        appendLog: (e) => setA2000ConsoleLogs((prev) => [...prev, e]),
        onComplete: async (success) => {
          if (success) {
            try {
              const qDepth = await supervisorClient.getQueueDepth({ queueName: A2000.unpublishedQueue });
              setA2000QueueDepth(qDepth.pendingCount);
              setA2000Liveness(100);
              setA2000LastComplete("Just now");
            } catch {
              // ignore refresh failure
            }
          }
        },
      });
    } finally {
      setRunningA2000(false);
    }
  };

  const handleRunAppamanSync = async () => {
    if (runningAppaman || !isBackendOnline) return;
    setRunningAppaman(true);
    setAppamanConsoleLogs([{ timestamp: nowTime(), type: "info", message: "Dispatching execution trigger to Apparel Magic controller..." }]);
    try {
      await runWithPoll({
        runControllerName: APPAMAN.runControllerName,
        appendLog: (e) => setAppamanConsoleLogs((prev) => [...prev, e]),
        onComplete: (success) => {
          if (success) {
            setIsHeapHealthy(true);
            setAppamanLastComplete("Just now");
          }
        },
      });
    } finally {
      setRunningAppaman(false);
    }
  };

  const nowTime = () => {
    const d = new Date();
    return d.toTimeString().split(" ")[0];
  };

  const getLivenessClass = (val: number) => {
    if (val >= 90) return "green";
    if (val >= 60) return "yellow";
    return "red";
  };

  return (
    <div className="container">
      {/* Brand Header Section */}
      <header className="header">
        <div className="brand">
          <div className="logo-icon">S</div>
          <div className="title-section">
            <h1>Supervisor Control Plane</h1>
            <p>Decoupled MVDev Orchestrator & Telemetry Gateway</p>
          </div>
        </div>

        {/* Auth and Server Connection Status */}
        <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
          <div className="connection-pill">
            {checkingConnection ? (
              <>
                <div className="connection-dot pulsing" style={{ backgroundColor: "#94a3b8" }} />
                <span>Verifying Connection...</span>
              </>
            ) : isBackendOnline ? (
              <>
                <div className="connection-dot liveness pulsing" />
                <span style={{ color: "#4ade80" }}>Connect-RPC Backend Online</span>
              </>
            ) : (
              <>
                <div className="connection-dot offline pulsing" style={{ backgroundColor: "#f87171" }} />
                <span style={{ color: "#f87171" }}>Disconnected from Backend</span>
              </>
            )}
          </div>
          <UserButton />
        </div>
      </header>

      {/* Connection Verifying Loading Screen */}
      {checkingConnection && (
        <div className="loading-screen">
          <div className="spinner-large" />
          <p>Connecting to MVDev Control Plane Backend...</p>
        </div>
      )}

      {/* Error / Disconnected Screen */}
      {!checkingConnection && !isBackendOnline && (
        <div className="error-screen">
          <div className="error-card">
            <div className="error-icon-container">
              <div className="error-pulse-ring" />
              <span className="error-icon">!</span>
            </div>
            <h2>Connection Failure</h2>
            <p className="error-description">
              The control plane portal could not connect to the Connect-RPC supervisor backend service.
            </p>
            <div className="error-details-box">
              <div className="details-row">
                <span className="details-label">Target Endpoint:</span>
                <code className="details-value">{process.env.NEXT_PUBLIC_MVDEV_API_URL || "https://foundry.dpeyserapps.com"}</code>
              </div>
              {connectionError && (
                <div className="details-row" style={{ marginTop: "0.75rem" }}>
                  <span className="details-label">Error Details:</span>
                  <code className="details-value error-text">{connectionError}</code>
                </div>
              )}
            </div>
            <button className="btn-primary retry-btn" onClick={testConnectionAndFetchData}>
              <span>Retry Connection</span>
            </button>
          </div>
        </div>
      )}

      {/* Primary Dashboard Grid (Only visible when connected) */}
      {!checkingConnection && isBackendOnline && (
        <div className="dashboard-grid">
          {/* Panel A: A2000 <> Logiwa Sync */}
          <section className="card">
            <div className="card-header">
              <div className="card-title-group">
                <h2 className="card-title">A2000 ⇄ Logiwa Sync</h2>
                <p className="card-subtitle">Pick Ticket submission & warehouse receipts cron channel</p>
              </div>
            </div>

            {/* Heartbeat ring liveness metrics */}
            <div className="heartbeat-section">
              <div className="status-circle-container">
                <svg width="64" height="64" viewBox="0 0 64 64">
                  <circle className="status-circle-bg" cx="32" cy="32" r="28" />
                  <circle
                    className={`status-circle-bar ${getLivenessClass(a2000Liveness)}`}
                    cx="32"
                    cy="32"
                    r="28"
                    strokeDasharray={2 * Math.PI * 28}
                    strokeDashoffset={2 * Math.PI * 28 * (1 - a2000Liveness / 100)}
                  />
                </svg>
                <div className="status-text-inside">{a2000Liveness}%</div>
              </div>
              <div className="heartbeat-details">
                <span className="heartbeat-label">Liveness Pulse</span>
                <span className={`heartbeat-value ${getLivenessClass(a2000Liveness)}`}>
                  {a2000Liveness > 0 ? `Heartbeat Healthy (Last Ping: ${a2000LastComplete})` : "Heartbeat Offline / Stale"}
                </span>
              </div>
            </div>

            {/* Metric parameters */}
            <div className="metrics-grid">
              <div className="metric-box">
                <span className="metric-box-title">Unpublished Queue</span>
                <span className="metric-box-value" style={{ color: a2000QueueDepth > 10 ? "var(--color-amber)" : "var(--color-blue)" }}>
                  {a2000QueueDepth}
                </span>
                <span className="metric-box-sub">Pending pick tickets</span>
              </div>
              <div className="metric-box">
                <span className="metric-box-title">Critical Threshold</span>
                <span className="metric-box-value" style={{ color: "var(--color-red)" }}>20+</span>
                <span className="metric-box-sub">Triggers Cal's phone SMS</span>
              </div>
            </div>

            {/* Control Triggers */}
            <button className="btn-primary" onClick={handleRunA2000Sync} disabled={runningA2000}>
              {runningA2000 ? (
                <>
                  <div className="spinner" />
                  <span>Running Sync Job...</span>
                </>
              ) : (
                <span>Run {A2000.runControllerName}</span>
              )}
            </button>

            {/* Console Log Terminal */}
            <div className="console-logs">
              {a2000ConsoleLogs.length === 0 ? (
                <div className="console-placeholder">Waiting for console events...</div>
              ) : (
                a2000ConsoleLogs.map((log, idx) => (
                  <div key={idx} className="console-row">
                    <span className="console-timestamp">[{log.timestamp}]</span>
                    <span className={`console-msg ${log.type === "error" ? "error" : log.type === "success" ? "success" : ""}`}>
                      {log.message}
                    </span>
                  </div>
                ))
              )}
              <div ref={a2000ConsoleEndRef} />
            </div>

            {/* Recent Runs History */}
            <div className="history-list">
              <span className="heartbeat-label">Recent Run History</span>
              {a2000History.length === 0 ? (
                <div className="history-placeholder">No history found on server</div>
              ) : (
                a2000History.map((item) => (
                  <div key={item.id} className="history-item">
                    <div className="history-left">
                      <span className={`badge ${item.success ? "success" : "failed"}`}>
                        {item.success ? "SUCCESS" : "FAILED"}
                      </span>
                      <span className="history-title">{item.time}</span>
                    </div>
                    <span className="history-time">{item.duration}</span>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Panel B: Apparel Magic <> Shipmonk Sync */}
          <section className="card">
            <div className="card-header">
              <div className="card-title-group">
                <h2 className="card-title">Apparel Magic ⇄ Shipmonk</h2>
                <p className="card-subtitle">Appaman store submission & invoice release controllers</p>
              </div>
            </div>

            {/* Heartbeat ring liveness metrics */}
            <div className="heartbeat-section">
              <div className="status-circle-container">
                <svg width="64" height="64" viewBox="0 0 64 64">
                  <circle className="status-circle-bg" cx="32" cy="32" r="28" />
                  <circle
                    className={`status-circle-bar ${isHeapHealthy === null ? "" : isHeapHealthy ? "green" : "red"}`}
                    cx="32"
                    cy="32"
                    r="28"
                    strokeDasharray={2 * Math.PI * 28}
                    strokeDashoffset={isHeapHealthy === null ? 2 * Math.PI * 28 : 0}
                  />
                </svg>
                <div className="status-text-inside">{appamanSuccessRatio}</div>
              </div>
              <div className="heartbeat-details">
                <span className="heartbeat-label">24h Push Success Ratio</span>
                <span className={`heartbeat-value ${isHeapHealthy === null ? "" : isHeapHealthy ? "green" : "red"}`}>
                  {isHeapHealthy === null
                    ? "Waiting for heartbeat..."
                    : isHeapHealthy
                      ? `Last ping: ${appamanLastComplete}`
                      : `Stale / Degraded (last: ${appamanLastComplete})`}
                </span>
              </div>
            </div>

            {/* Metric grid */}
            <div className="metrics-grid">
              <div className="metric-box">
                <span className="metric-box-title">Push Outcomes (24h)</span>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
                  <span className="badge success">
                    {appamanHistory.filter((i) => i.success).length} Success
                  </span>
                  <span className="badge failed">
                    {appamanHistory.filter((i) => !i.success).length} Failed
                  </span>
                </div>
                <span className="metric-box-sub" style={{ marginTop: "0.25rem" }}>
                  Recent {APPAMAN.invocationsControllerName} invocations
                </span>
              </div>

              <div className="metric-box">
                <span className="metric-box-title">Parent Cron</span>
                <span className="metric-box-value" style={{ fontSize: "1.05rem" }}>
                  {APPAMAN.pingTaskName.replace(/-default$/, "")}
                </span>
                <span className="metric-box-sub">Hourly ETL controller</span>
              </div>
            </div>

            {/* Control Trigger */}
            <button className="btn-primary" onClick={handleRunAppamanSync} disabled={runningAppaman}>
              {runningAppaman ? (
                <>
                  <div className="spinner" />
                  <span>Running Sync Job...</span>
                </>
              ) : (
                <span>Run {APPAMAN.runControllerName}</span>
              )}
            </button>

            {/* Console Log Terminal */}
            <div className="console-logs">
              {appamanConsoleLogs.length === 0 ? (
                <div className="console-placeholder">Waiting for console events...</div>
              ) : (
                appamanConsoleLogs.map((log, idx) => (
                  <div key={idx} className="console-row">
                    <span className="console-timestamp">[{log.timestamp}]</span>
                    <span className={`console-msg ${log.type === "error" ? "error" : log.type === "success" ? "success" : ""}`}>
                      {log.message}
                    </span>
                  </div>
                ))
              )}
              <div ref={appamanConsoleEndRef} />
            </div>

            {/* History */}
            <div className="history-list">
              <span className="heartbeat-label">Recent Run History</span>
              {appamanHistory.length === 0 ? (
                <div className="history-placeholder">No history found on server</div>
              ) : (
                appamanHistory.map((item) => (
                  <div key={item.id} className="history-item">
                    <div className="history-left">
                      <span className={`badge ${item.success ? "success" : "failed"}`}>
                        {item.success ? "SUCCESS" : "FAILED"}
                      </span>
                      <span className="history-title">{item.time}</span>
                    </div>
                    <span className="history-time">{item.duration}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
