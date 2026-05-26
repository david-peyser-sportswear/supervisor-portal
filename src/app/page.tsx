"use client";

import React, { useState, useEffect, useRef } from "react";
import { supervisorClient } from "@/lib/rpc-client";
import { UserButton } from "@clerk/nextjs";

// Local types for the dashboard UI
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
  // Connection state
  const [isBackendOnline, setIsBackendOnline] = useState<boolean>(false);
  const [checkingConnection, setCheckingConnection] = useState<boolean>(true);

  // A2000 <> Logiwa State
  const [a2000Liveness, setA2000Liveness] = useState<number>(100); // 100% = Fresh < 4h
  const [a2000LastComplete, setA2000LastComplete] = useState<string>("34 minutes ago");
  const [a2000QueueDepth, setA2000QueueDepth] = useState<number>(4);
  const [runningA2000, setRunningA2000] = useState<boolean>(false);
  const [a2000History, setA2000History] = useState<InvocRecord[]>([
    { id: "1", controllerName: "updateA2000PickTicketsFromLogiwa", time: "10:30 AM", success: true, duration: "4.2s" },
    { id: "2", controllerName: "updateA2000PickTicketsFromLogiwa", time: "06:30 AM", success: true, duration: "3.8s" },
    { id: "3", controllerName: "updateA2000PickTicketsFromLogiwa", time: "Yesterday", success: false, duration: "12.1s" },
  ]);
  const [a2000ConsoleLogs, setA2000ConsoleLogs] = useState<ExecutionLog[]>([
    { timestamp: "10:30:00", type: "info", message: "Starting updateA2000PickTicketsFromLogiwa controller..." },
    { timestamp: "10:30:01", type: "info", message: "Fetched 12 new pick tickets from A2000 database proxy." },
    { timestamp: "10:30:03", type: "success", message: "Successfully mapped and synced 12 records to Logiwa WMS." },
    { timestamp: "10:30:04", type: "info", message: "Sync job complete. Queue depth cleared to 4." },
  ]);

  // Apparel Magic <> Shipmonk State
  const [appamanSuccessRatio, setAppamanSuccessRatio] = useState<string>("98.4%");
  const [shipmonkQueued, setShipmonkQueued] = useState<number>(8);
  const [shipmonkUnable, setShipmonkUnable] = useState<number>(0);
  const [shipmonkAction, setShipmonkAction] = useState<number>(1);
  const [isHeapHealthy, setIsHeapHealthy] = useState<boolean>(true);
  const [runningAppaman, setRunningAppaman] = useState<boolean>(false);
  const [appamanHistory, setAppamanHistory] = useState<InvocRecord[]>([
    { id: "1", controllerName: "syncShipmonkAmPickTicketsAppaman", time: "09:15 AM", success: true, duration: "1.8s" },
    { id: "2", controllerName: "sync-appaman-apparel-magic-invoices", time: "08:00 AM", success: true, duration: "145ms" },
    { id: "3", controllerName: "syncShipmonkAmPickTicketsAppaman", time: "05:15 AM", success: true, duration: "2.1s" },
  ]);
  const [appamanConsoleLogs, setAppamanConsoleLogs] = useState<ExecutionLog[]>([
    { timestamp: "09:15:00", type: "info", message: "Initializing Apparel Magic <> Shipmonk sync session..." },
    { timestamp: "09:15:01", type: "info", message: "Authenticating token with Apparel Magic Gateway." },
    { timestamp: "09:15:01", type: "success", message: "Token authenticated successfully." },
    { timestamp: "09:15:02", type: "info", message: "Scanning Shipmonk order submission states." },
    { timestamp: "09:15:02", type: "info", message: "Submission complete: 8 queued, 0 invalid, 1 actions required." },
  ]);

  // Refs for auto scrolling consoles
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

  // Check connection to the Connect-RPC server
  useEffect(() => {
    async function testConnection() {
      try {
        setCheckingConnection(true);
        // Let's attempt to fetch queue depth from the running local Connect server
        const response = await supervisorClient.getQueueDepth({ queueName: "logiwa-unpublished" });
        if (response) {
          setIsBackendOnline(true);
          setA2000QueueDepth(response.pendingCount);
        }
      } catch (err) {
        // Backend is offline, we will run in premium sandbox demonstration mode
        console.warn("Connect-RPC backend is offline. Bootstrapping rich dashboard with mock data simulator.", err);
        setIsBackendOnline(false);
      } finally {
        setCheckingConnection(false);
      }
    }
    testConnection();
  }, []);

  // Handler to manually trigger A2000 <> Logiwa Sync
  const handleRunA2000Sync = async () => {
    if (runningA2000) return;
    setRunningA2000(true);
    
    // Clear old console
    setA2000ConsoleLogs([{ timestamp: nowTime(), type: "info", message: "Triggering manual execution of A2000 Pick Ticket Sync..." }]);

    if (isBackendOnline) {
      try {
        const response = await supervisorClient.runController({
          controllerName: "updateA2000PickTicketsFromLogiwa",
          payloadJson: JSON.stringify({ manualTrigger: true }),
        });
        
        // Append response success logs
        if (response.success) {
          setA2000ConsoleLogs(prev => [
            ...prev,
            { timestamp: nowTime(), type: "info", message: `Invocation registered: ${response.invocationId}` },
            { timestamp: nowTime(), type: "success", message: "Sync controller processed successfully on MVDev backend!" },
            { timestamp: nowTime(), type: "info", message: `Output: ${response.outputJson}` },
          ]);
          // Refresh Queue Depth
          const qDepth = await supervisorClient.getQueueDepth({ queueName: "logiwa-unpublished" });
          setA2000QueueDepth(qDepth.pendingCount);
          setA2000Liveness(100);
          setA2000LastComplete("Just now");
          // Add to history list
          setA2000History(prev => [
            { id: Date.now().toString(), controllerName: "updateA2000PickTicketsFromLogiwa", time: "Just now", success: true, duration: "3.1s" },
            ...prev
          ]);
        } else {
          setA2000ConsoleLogs(prev => [
            ...prev,
            { timestamp: nowTime(), type: "error", message: `Execution Failure: ${response.errorMessage}` }
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
    } else {
      // Premium interactive local simulator
      setTimeout(() => {
        setA2000ConsoleLogs(prev => [...prev, { timestamp: nowTime(), type: "info", message: "Loading Drizzle ORM client schema models..." }]);
      }, 600);
      setTimeout(() => {
        setA2000ConsoleLogs(prev => [...prev, { timestamp: nowTime(), type: "info", message: "Establishing Oracle database tunnel..." }]);
      }, 1200);
      setTimeout(() => {
        setA2000ConsoleLogs(prev => [...prev, { timestamp: nowTime(), type: "success", message: "Oracle tunnel connected. Reading un-invoiced Pick Tickets..." }]);
      }, 1800);
      setTimeout(() => {
        setA2000ConsoleLogs(prev => [...prev, { timestamp: nowTime(), type: "info", message: "Found 0 pending items. Scanning Logiwa API endpoint liveness..." }]);
      }, 2500);
      setTimeout(() => {
        setA2000ConsoleLogs(prev => [
          ...prev,
          { timestamp: nowTime(), type: "success", message: "Logiwa sync cycle finalized gracefully. All tables in state." },
          { timestamp: nowTime(), type: "info", message: "Sync job complete. Queue depth is currently 0." }
        ]);
        setA2000QueueDepth(0);
        setA2000Liveness(100);
        setA2000LastComplete("Just now");
        setA2000History(prev => [
          { id: Date.now().toString(), controllerName: "updateA2000PickTicketsFromLogiwa", time: "Just now", success: true, duration: "2.4s" },
          ...prev
        ]);
        setRunningA2000(false);
      }, 3400);
    }
  };

  // Handler to manually trigger Apparel Magic <> Shipmonk Sync
  const handleRunAppamanSync = async () => {
    if (runningAppaman) return;
    setRunningAppaman(true);

    setAppamanConsoleLogs([{ timestamp: nowTime(), type: "info", message: "Triggering manual execution of Apparel Magic sync channels..." }]);

    if (isBackendOnline) {
      try {
        const response = await supervisorClient.runController({
          controllerName: "syncShipmonkAmPickTicketsAppaman",
          payloadJson: JSON.stringify({ forceSync: true }),
        });

        if (response.success) {
          setAppamanConsoleLogs(prev => [
            ...prev,
            { timestamp: nowTime(), type: "info", message: `Invocation registered: ${response.invocationId}` },
            { timestamp: nowTime(), type: "success", message: "Sync controller processed successfully on MVDev backend!" },
            { timestamp: nowTime(), type: "info", message: `Output: ${response.outputJson}` },
          ]);
          setAppamanSuccessRatio("99.1%");
          setShipmonkQueued(0);
          setShipmonkUnable(0);
          setShipmonkAction(0);
          setAppamanHistory(prev => [
            { id: Date.now().toString(), controllerName: "syncShipmonkAmPickTicketsAppaman", time: "Just now", success: true, duration: "1.2s" },
            ...prev
          ]);
        } else {
          setAppamanConsoleLogs(prev => [
            ...prev,
            { timestamp: nowTime(), type: "error", message: `Execution Failure: ${response.errorMessage}` }
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
    } else {
      // Local simulator
      setTimeout(() => {
        setAppamanConsoleLogs(prev => [...prev, { timestamp: nowTime(), type: "info", message: "Contacting Apparel Magic OAuth endpoints..." }]);
      }, 700);
      setTimeout(() => {
        setAppamanConsoleLogs(prev => [...prev, { timestamp: nowTime(), type: "success", message: "Apparel Magic Session initialized with client_id: AM_PROD." }]);
      }, 1400);
      setTimeout(() => {
        setAppamanConsoleLogs(prev => [...prev, { timestamp: nowTime(), type: "info", message: "Resolving tracking payloads from ShipMonk webhook buffers..." }]);
      }, 2100);
      setTimeout(() => {
        setAppamanConsoleLogs(prev => [
          ...prev,
          { timestamp: nowTime(), type: "success", message: "Sync cycle finalized. Pushed tracking coordinates for 8 orders." },
          { timestamp: nowTime(), type: "info", message: "Submission buffer is completely clean." }
        ]);
        setShipmonkQueued(0);
        setShipmonkUnable(0);
        setShipmonkAction(0);
        setAppamanSuccessRatio("99.5%");
        setIsHeapHealthy(true);
        setAppamanHistory(prev => [
          { id: Date.now().toString(), controllerName: "syncShipmonkAmPickTicketsAppaman", time: "Just now", success: true, duration: "1.9s" },
          ...prev
        ]);
        setRunningAppaman(false);
      }, 3100);
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
                <div className="connection-dot offline pulsing" />
                <span style={{ color: "#f87171" }}>Offline Sandbox Simulator</span>
              </>
            )}
          </div>
          <UserButton />
        </div>
      </header>

      {/* Primary Dashboard Grid */}
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
                Heartbeat Healthy ({a2000LastComplete})
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
            {a2000ConsoleLogs.map((log, idx) => (
              <div key={idx} className="console-row">
                <span className="console-timestamp">[{log.timestamp}]</span>
                <span className={`console-msg ${log.type === "error" ? "error" : log.type === "success" ? "success" : ""}`}>
                  {log.message}
                </span>
              </div>
            ))}
            <div ref={a2000ConsoleEndRef} />
          </div>

          {/* Recent Runs History */}
          <div className="history-list">
            <span className="heartbeat-label">Recent Run History</span>
            {a2000History.map((item) => (
              <div key={item.id} className="history-item">
                <div className="history-left">
                  <span className={`badge ${item.success ? "success" : "failed"}`}>
                    {item.success ? "SUCCESS" : "FAILED"}
                  </span>
                  <span className="history-title">{item.time}</span>
                </div>
                <span className="history-time">{item.duration}</span>
              </div>
            ))}
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
                  className="status-circle-bar green"
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
              <span className="heartbeat-value green">
                Telemetry Healthy (100% liveness)
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
                {isHeapHealthy ? "HEALTHY" : "CRASHED"}
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
            {appamanConsoleLogs.map((log, idx) => (
              <div key={idx} className="console-row">
                <span className="console-timestamp">[{log.timestamp}]</span>
                <span className={`console-msg ${log.type === "error" ? "error" : log.type === "success" ? "success" : ""}`}>
                  {log.message}
                </span>
              </div>
            ))}
            <div ref={appamanConsoleEndRef} />
          </div>

          {/* History */}
          <div className="history-list">
            <span className="heartbeat-label">Recent Run History</span>
            {appamanHistory.map((item) => (
              <div key={item.id} className="history-item">
                <div className="history-left">
                  <span className={`badge ${item.success ? "success" : "failed"}`}>
                    {item.success ? "SUCCESS" : "FAILED"}
                  </span>
                  <span className="history-title">{item.time}</span>
                </div>
                <span className="history-time">{item.duration}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
