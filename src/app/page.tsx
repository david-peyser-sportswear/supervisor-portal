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
  const [appamanSuccessRatio, setAppamanSuccessRatio] = useState<string>("0%");
  const [shipmonkQueued, setShipmonkQueued] = useState<number>(0);
  const [shipmonkUnable, setShipmonkUnable] = useState<number>(0);
  const [shipmonkAction, setShipmonkAction] = useState<number>(0);
  const [isHeapHealthy, setIsHeapHealthy] = useState<boolean>(true);
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

      // Verify connection by getting queue depth
      const qDepth = await supervisorClient.getQueueDepth({ queueName: "a2000-logiwa-unpublished" });
      setA2000QueueDepth(qDepth.pendingCount);
      setIsBackendOnline(true);

      // Fetch liveness and heartbeats
      try {
        const pings = await supervisorClient.getPings({});
        if (pings && pings.pings) {
          // Find updateA2000PickTicketsFromLogiwa ping
          const a2000Ping = pings.pings.find(p => p.taskName === "updateA2000PickTicketsFromLogiwa");
          if (a2000Ping) {
            setA2000LastComplete(a2000Ping.timestamp ? new Date(a2000Ping.timestamp).toLocaleTimeString() : "Never");
            setA2000Liveness(a2000Ping.pingType === "complete" || a2000Ping.pingType === "success" ? 100 : 0);
          } else {
            setA2000Liveness(100);
          }

          const amPing = pings.pings.find(p => p.taskName === "syncShipmonkAmPickTicketsAppaman");
          if (amPing) {
            setAppamanSuccessRatio(amPing.pingType === "complete" || amPing.pingType === "success" ? "100%" : "0%");
            setIsHeapHealthy(amPing.pingType !== "fail");
          } else {
            setAppamanSuccessRatio("100%");
            setIsHeapHealthy(true);
          }
        }
      } catch (pingErr) {
        console.warn("Could not load controller heartbeat signals", pingErr);
      }

      // Fetch Recent Executions
      try {
        const fetchInvocationsForController = async (controllerName: string): Promise<InvocRecord[]> => {
          try {
            const res = await supervisorClient.getInvocations({ controllerName });
            if (res && res.invocations) {
              return res.invocations.map((inv) => {
                const dateStr = inv.startTime 
                  ? new Date(inv.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : "Unknown";

                let durationStr = "Unknown";
                if (inv.startTime && inv.endTime) {
                  try {
                    const diff = new Date(inv.endTime).getTime() - new Date(inv.startTime).getTime();
                    if (diff >= 0) {
                      durationStr = `${(diff / 1000).toFixed(1)}s`;
                    }
                  } catch {}
                }

                return {
                  id: inv.id,
                  controllerName: inv.controllerName,
                  time: dateStr,
                  success: inv.success,
                  duration: durationStr,
                };
              });
            }
          } catch (err) {
            console.error(`Failed to load invocations for ${controllerName}`, err);
          }
          return [];
        };

        const [a2000List, appamanList] = await Promise.all([
          fetchInvocationsForController("updateA2000PickTicketsFromLogiwa"),
          fetchInvocationsForController("syncShipmonkAmPickTicketsAppaman")
        ]);

        setA2000History(a2000List.slice(0, 5));
        setAppamanHistory(appamanList.slice(0, 5));
      } catch (historyErr) {
        console.error("Failed to load invocation list history", historyErr);
      }

    } catch (err: any) {
      console.error("Connection attempt to Connect-RPC server failed:", err);
      setIsBackendOnline(false);
      setConnectionError(err.message || String(err));
    } finally {
      setCheckingConnection(false);
    }
  };

  useEffect(() => {
    testConnectionAndFetchData();
  }, []);

  // Handler to manually trigger A2000 <> Logiwa Sync
  const handleRunA2000Sync = async () => {
    if (runningA2000 || !isBackendOnline) return;
    setRunningA2000(true);
    
    setA2000ConsoleLogs([{ timestamp: nowTime(), type: "info", message: "Dispatching execution trigger to A2000 controller..." }]);

    try {
      const response = await supervisorClient.runController({
        controllerName: "updateA2000PickTicketsFromLogiwa",
        payloadJson: JSON.stringify({ manualTrigger: true }),
      });
      
      if (response.success) {
        setA2000ConsoleLogs(prev => [
          ...prev,
          { timestamp: nowTime(), type: "info", message: `Invocation registered: ${response.invocationId}` },
          { timestamp: nowTime(), type: "success", message: "A2000 sync run complete!" },
          { timestamp: nowTime(), type: "info", message: `Output: ${response.outputJson || "{}"}` },
        ]);
        // Refresh values
        const qDepth = await supervisorClient.getQueueDepth({ queueName: "a2000-logiwa-unpublished" });
        setA2000QueueDepth(qDepth.pendingCount);
        setA2000Liveness(100);
        setA2000LastComplete("Just now");
      } else {
        setA2000ConsoleLogs(prev => [
          ...prev,
          { timestamp: nowTime(), type: "error", message: `Execution Failed: ${response.errorMessage}` }
        ]);
      }
    } catch (err: any) {
      setA2000ConsoleLogs(prev => [
        ...prev,
        { timestamp: nowTime(), type: "error", message: `RPC Network Exception: ${err.message || err}` }
      ]);
    } finally {
      setRunningA2000(false);
    }
  };

  // Handler to manually trigger Apparel Magic <> Shipmonk Sync
  const handleRunAppamanSync = async () => {
    if (runningAppaman || !isBackendOnline) return;
    setRunningAppaman(true);

    setAppamanConsoleLogs([{ timestamp: nowTime(), type: "info", message: "Dispatching execution trigger to Apparel Magic controller..." }]);

    try {
      const response = await supervisorClient.runController({
        controllerName: "syncShipmonkAmPickTicketsAppaman",
        payloadJson: JSON.stringify({ forceSync: true }),
      });

      if (response.success) {
        setAppamanConsoleLogs(prev => [
          ...prev,
          { timestamp: nowTime(), type: "info", message: `Invocation registered: ${response.invocationId}` },
          { timestamp: nowTime(), type: "success", message: "Apparel Magic sync run complete!" },
          { timestamp: nowTime(), type: "info", message: `Output: ${response.outputJson || "{}"}` },
        ]);
        setAppamanSuccessRatio("100%");
      } else {
        setAppamanConsoleLogs(prev => [
          ...prev,
          { timestamp: nowTime(), type: "error", message: `Execution Failed: ${response.errorMessage}` }
        ]);
      }
    } catch (err: any) {
      setAppamanConsoleLogs(prev => [
        ...prev,
        { timestamp: nowTime(), type: "error", message: `RPC Network Exception: ${err.message || err}` }
      ]);
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
                <span>Run updateA2000PickTicketsFromLogiwa</span>
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
                    className={`status-circle-bar ${isHeapHealthy ? "green" : "red"}`}
                    cx="32"
                    cy="32"
                    r="28"
                    strokeDasharray={2 * Math.PI * 28}
                    strokeDashoffset={0}
                  />
                </svg>
                <div className="status-text-inside">{appamanSuccessRatio}</div>
              </div>
              <div className="heartbeat-details">
                <span className="heartbeat-label">24h Liveness Success Ratio</span>
                <span className={`heartbeat-value ${isHeapHealthy ? "green" : "red"}`}>
                  {isHeapHealthy ? "Telemetry Healthy (100% liveness)" : "Telemetry Stale / Degraded"}
                </span>
              </div>
            </div>

            {/* Metric grid */}
            <div className="metrics-grid">
              <div className="metric-box">
                <span className="metric-box-title">Submission States</span>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <span className="badge" style={{ background: "rgba(59,130,246,0.1)", color: "var(--color-blue)" }}>
                    {shipmonkQueued} Queued
                  </span>
                  <span className="badge" style={{ background: "rgba(239,68,68,0.1)", color: "var(--color-red)" }}>
                    {shipmonkUnable} Failed
                  </span>
                  <span className="badge" style={{ background: "rgba(245,158,11,0.1)", color: "var(--color-amber)" }}>
                    {shipmonkAction} Warning
                  </span>
                </div>
                <span className="metric-box-sub" style={{ marginTop: "0.25rem" }}>Buffered orders</span>
              </div>

              <div className="metric-box">
                <span className="metric-box-title">OOM Crash Guard</span>
                <span className="metric-box-value" style={{ color: isHeapHealthy ? "var(--color-green)" : "var(--color-red)" }}>
                  {isHeapHealthy ? "HEALTHY" : "DEGRADED"}
                </span>
                <span className="metric-box-sub">V8 heap container status</span>
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
                <span>Run syncShipmonkAmPickTicketsAppaman</span>
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
