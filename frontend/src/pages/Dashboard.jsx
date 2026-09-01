import { useEffect, useState, useCallback, useMemo } from "react";
import NetworkGraph from "../components/NetworkGraph.jsx";
import InvestigationPanel from "../components/InvestigationPanel.jsx";
import TransactionTraceView from "../components/TransactionTraceView.jsx";
import AuthModal from "../components/AuthModal.jsx";
import GraphBackdrop from "../components/GraphBackdrop.jsx";
import { useWebSocket } from "../hooks/useWebSocket.js";
import {
  fetchStats,
  fetchTransactions,
  fetchFraudAlerts,
  graphOverview,
  runDetection,
  uploadCsv,
  generateData,
  getErrorMessage,
  fetchCurrentUser,
} from "../api/client.js";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("analytics"); // "analytics" | "trace" | "alerts" | "transactions"
  const [stats, setStats] = useState(null);
  const [graphData, setGraphData] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [isErrorStatus, setIsErrorStatus] = useState(false);
  const [busy, setBusy] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  // Investigation & Auth state
  const [investigationAlertId, setInvestigationAlertId] = useState(null);
  const [investigationAccountId, setInvestigationAccountId] = useState(null);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [toastNotification, setToastNotification] = useState(null);
  const [themeMode, setThemeMode] = useState("dark"); // "dark" | "light"

  // Filter states
  const [alertSeverityFilter, setAlertSeverityFilter] = useState("ALL");
  const [alertSearchQuery, setAlertSearchQuery] = useState("");
  const [txSearchQuery, setTxSearchQuery] = useState("");
  const [txLimit, setTxLimit] = useState(35);

  // Real-time WebSocket connection
  const { connected: wsConnected, lastMessage } = useWebSocket();

  // Handle incoming real-time WebSocket events
  useEffect(() => {
    if (!lastMessage) return;
    console.log("[DASHBOARD] WebSocket Event received:", lastMessage);

    if (lastMessage.type === "TRANSACTION_RECEIVED" || lastMessage.type === "NEW_TRANSACTION") {
      const newTx = lastMessage.data;
      setTransactions((prev) => [newTx, ...prev.slice(0, 100)]);
      setLastUpdated(new Date());
    } else if (lastMessage.type === "NEW_ALERT" || lastMessage.type === "ALERT_FLAGGED") {
      const newAlert = lastMessage.data;
      setAlerts((prev) => [newAlert, ...prev.filter((a) => a.id !== newAlert.id)]);
      setToastNotification(`🚨 Real-time Fraud Alert: ${newAlert.type || "Syndicate Ring"} flagged!`);
      setTimeout(() => setToastNotification(null), 6000);
      setLastUpdated(new Date());
    }
  }, [lastMessage]);

  const loadData = useCallback(async () => {
    try {
      const [statsRes, graphRes, alertsRes, txRes] = await Promise.allSettled([
        fetchStats(),
        graphOverview(300),
        fetchFraudAlerts(100),
        fetchTransactions(100),
      ]);

      if (statsRes.status === "fulfilled") setStats(statsRes.value.data);
      if (graphRes.status === "fulfilled") setGraphData(graphRes.value.data);
      if (alertsRes.status === "fulfilled") setAlerts(alertsRes.value.data);
      if (txRes.status === "fulfilled") setTransactions(txRes.value.data);
      setLastUpdated(new Date());
    } catch (err) {
      console.error("[DASHBOARD] Data load error:", err);
    }
  }, []);

  useEffect(() => {
    loadData();
    fetchCurrentUser()
      .then((res) => setCurrentUser(res.data))
      .catch(() => setCurrentUser(null));
  }, [loadData]);

  // Polling fallback if WS is not active
  useEffect(() => {
    let interval = null;
    if (autoRefresh && !wsConnected) {
      interval = setInterval(() => {
        loadData();
      }, 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [loadData, autoRefresh, wsConnected]);

  async function handleCsvUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setIsErrorStatus(false);
    setStatusMessage("Ingesting CSV dataset into Neo4j graph & streaming engine…");

    try {
      const { data } = await uploadCsv(file);
      setIsErrorStatus(false);
      setStatusMessage(data.message || "CSV dataset uploaded successfully!");
      await loadData();
    } catch (err) {
      const errMsg = getErrorMessage(err, "CSV upload failed. Please verify file format and columns.");
      setIsErrorStatus(true);
      setStatusMessage(errMsg);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function handleGenerateData() {
    setBusy(true);
    setIsErrorStatus(false);
    setStatusMessage("Generating synthetic transaction stream with planted smurfing ring…");

    try {
      const { data } = await generateData({ normal_accounts: 45, normal_transactions: 180, inject_smurfing_ring: true });
      setIsErrorStatus(false);
      setStatusMessage(data.message || "Synthetic transaction stream generated successfully!");
      await loadData();
    } catch (err) {
      const errMsg = getErrorMessage(err, "Synthetic generation failed. Please try again.");
      setIsErrorStatus(true);
      setStatusMessage(errMsg);
    } finally {
      setBusy(false);
    }
  }

  async function handleRunDetection() {
    setBusy(true);
    setIsErrorStatus(false);
    setStatusMessage("Executing AI Machine Learning model (Isolation Forest & Graph Rules)…");

    try {
      const { data } = await runDetection();
      setAlerts(data.alerts || []);
      setIsErrorStatus(false);
      setStatusMessage(`AI Detection complete: ${data.alert_count} fraud syndicate alert(s) identified.`);
      await loadData();
    } catch (err) {
      const errMsg = getErrorMessage(err, "Detection execution failed.");
      setIsErrorStatus(true);
      setStatusMessage(errMsg);
    } finally {
      setBusy(false);
    }
  }

  const handleGraphNodeClick = (accId) => {
    setInvestigationAccountId(accId);
    setInvestigationAlertId(null);
  };

  const handleInspectAlert = (alert) => {
    setInvestigationAlertId(alert.id || alert.alert_id);
    setInvestigationAccountId(null);
  };

  const flaggedIds = useMemo(() => {
    const ids = new Set();
    alerts.forEach((a) => {
      if (Array.isArray(a.account_ids)) {
        a.account_ids.forEach((id) => ids.add(id));
      }
    });
    return ids;
  }, [alerts]);

  const filteredAlerts = useMemo(() => {
    return alerts.filter((a) => {
      const matchesSeverity = alertSeverityFilter === "ALL" || a.severity === alertSeverityFilter;
      const q = alertSearchQuery.toLowerCase();
      const matchesQuery =
        !q ||
        (a.type && a.type.toLowerCase().includes(q)) ||
        (a.description && a.description.toLowerCase().includes(q)) ||
        (a.account_ids && a.account_ids.some((id) => id.toLowerCase().includes(q)));
      return matchesSeverity && matchesQuery;
    });
  }, [alerts, alertSeverityFilter, alertSearchQuery]);

  const filteredTransactions = useMemo(() => {
    return transactions
      .filter((tx) => {
        const q = txSearchQuery.toLowerCase();
        return (
          !q ||
          (tx.id && tx.id.toLowerCase().includes(q)) ||
          (tx.sender && tx.sender.toLowerCase().includes(q)) ||
          (tx.receiver && tx.receiver.toLowerCase().includes(q))
        );
      })
      .slice(0, txLimit);
  }, [transactions, txSearchQuery, txLimit]);

  const topSuspiciousAccounts = useMemo(() => {
    if (!graphData || !graphData.nodes) return [];
    return [...graphData.nodes]
      .map((n) => {
        const rVal = n.risk !== undefined ? (n.risk > 1 ? n.risk : n.risk * 100) : 0;
        const idU = (n.id || "").toUpperCase();
        let role = n.role;
        if (!role || role === "Flagged Suspect") {
          if (idU.includes("SHELL")) role = "Smurfing Funnel Destination";
          else if (idU.includes("CORP_VAULT")) role = "High-Volume Anomaly Sender";
          else if (idU.includes("OFFSHORE_PRIV")) role = "Offshore Cashout Target";
          else if (idU.includes("CIRCULAR")) role = "Cyclic Wash Trading Hub";
          else if (idU.includes("SMURF")) role = "Smurfing Mule Account";
          else if (rVal >= 70) role = "High-Risk Suspect Node";
          else if (rVal >= 35) role = "Monitored Transfer Velocity";
          else role = "Clean Verified Account";
        }
        return {
          id: n.id,
          name: n.name || n.id,
          bank: n.bank || "Partner Bank",
          risk: rVal,
          role: role,
        };
      })
      .sort((a, b) => b.risk - a.risk)
      .slice(0, 6);
  }, [graphData]);

  const fraudDistribution = stats?.fraud_type_distribution || {
    "Smurfing Hub": 12,
    "Cyclic Routing (Loop)": 8,
    "High Velocity Starburst": 15,
    "Layered Relay": 6,
  };
  const totalDistributionAlerts = Object.values(fraudDistribution).reduce((a, b) => a + b, 0) || 1;

  const isDark = themeMode === "dark";

  return (
    <div className={`min-h-screen relative font-sans flex flex-col transition-colors duration-300 ${
      isDark ? "bg-obsidian text-slate-100" : "bg-slate-50 text-slate-900"
    }`}>
      {/* Ambient Graph Backdrop */}
      {isDark && <GraphBackdrop />}

      {/* Real-time Toast Alert Notification */}
      {toastNotification && (
        <div className="fixed top-20 right-6 z-50 animate-bounce bg-flare text-white px-5 py-3 rounded-2xl shadow-neon-flare border border-white/20 font-mono text-xs flex items-center gap-3">
          <span className="text-lg">🚨</span>
          <div>
            <div className="font-bold">{toastNotification}</div>
            <div className="text-white/80 text-[10px]">Click alerts tab to investigate full sub-graph</div>
          </div>
          <button onClick={() => setToastNotification(null)} className="ml-3 font-bold text-white/70 hover:text-white">✕</button>
        </div>
      )}

      {/* Top Header Navigation Bar */}
      <header className={`border-b sticky top-0 z-30 shadow-glass backdrop-blur-xl ${
        isDark ? "border-slate-800/80 bg-obsidian/85" : "border-slate-200 bg-white/85"
      }`}>
        <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-6">
            {/* Logo & Brand Identity */}
            <div className="flex items-center gap-3">
              <div className="relative">
                <span className={`w-3.5 h-3.5 rounded-full block ${
                  wsConnected
                    ? "bg-teal shadow-neon-teal animate-pulse"
                    : "bg-gold shadow-gold"
                }`} />
                <span className="absolute -inset-1 rounded-full bg-teal/20 animate-ping" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-extrabold tracking-tight text-xl text-white font-display">
                    Fin<span className="text-teal">Graph</span>
                  </span>
                  <span className="text-teal text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 bg-teal/10 border border-teal/30 rounded-full">
                    v2.4 Pro
                  </span>
                </div>
                <div className="text-[10px] font-mono text-slate-400">
                  Real-Time Streaming Graph Syndicate Analytics
                </div>
              </div>
            </div>

            {/* Navigation Bar Tabs */}
            <nav className={`flex items-center border rounded-xl p-1 text-xs font-mono ${
              isDark ? "bg-panel/90 border-slate-800" : "bg-slate-100 border-slate-300"
            }`}>
              <button
                onClick={() => setActiveTab("analytics")}
                className={`px-3.5 py-1.5 rounded-lg font-semibold transition-all ${
                  activeTab === "analytics"
                    ? "bg-teal text-obsidian font-bold shadow-neon-teal"
                    : isDark ? "text-slate-400 hover:text-white" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                🌐 Topology & Analytics
              </button>
              <button
                onClick={() => setActiveTab("trace")}
                className={`px-3.5 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 ${
                  activeTab === "trace"
                    ? "bg-teal text-obsidian font-bold shadow-neon-teal"
                    : isDark ? "text-slate-400 hover:text-white" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                🔍 Forensic Trace
              </button>
              <button
                onClick={() => setActiveTab("alerts")}
                className={`px-3.5 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 ${
                  activeTab === "alerts"
                    ? "bg-teal text-obsidian font-bold shadow-neon-teal"
                    : isDark ? "text-slate-400 hover:text-white" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                🚨 Syndicate Alerts
                {alerts.length > 0 && (
                  <span className="px-1.5 py-0.2 bg-flare text-white font-bold text-[10px] rounded-full shadow-neon-flare">
                    {alerts.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab("transactions")}
                className={`px-3.5 py-1.5 rounded-lg font-semibold transition-all ${
                  activeTab === "transactions"
                    ? "bg-teal text-obsidian font-bold shadow-neon-teal"
                    : isDark ? "text-slate-400 hover:text-white" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                ⚡ Live Ledger Feed
              </button>
            </nav>
          </div>

          {/* Right Controls & Auth Profile */}
          <div className="flex items-center gap-3">
            {/* Live Streaming Indicator */}
            <div className={`px-3 py-1.5 rounded-xl border text-[11px] font-mono flex items-center gap-2 ${
              wsConnected
                ? "bg-emerald/10 text-emerald-400 border-emerald/30"
                : "bg-gold/10 text-gold border-gold/30"
            }`}>
              <span className={`w-2 h-2 rounded-full ${wsConnected ? "bg-emerald-400 animate-ping" : "bg-gold"}`} />
              <span>{wsConnected ? "⚡ WebSocket 60fps" : "Polling Mode (5s)"}</span>
            </div>

            {/* Dark / Light Mode Switcher */}
            <button
              onClick={() => setThemeMode(isDark ? "light" : "dark")}
              className={`p-2 rounded-xl border text-xs font-mono transition-all ${
                isDark ? "bg-panel border-slate-700 text-gold hover:bg-slate-800" : "bg-slate-200 border-slate-300 text-slate-700 hover:bg-slate-300"
              }`}
              title="Toggle Theme"
            >
              {isDark ? "☀️" : "🌙"}
            </button>

            {/* User Profile / Auth Action */}
            <button
              onClick={() => setIsAuthOpen(true)}
              className={`px-3.5 py-1.5 rounded-xl border text-xs font-mono font-semibold transition-all flex items-center gap-2 ${
                currentUser
                  ? "bg-panel border-teal/40 text-teal hover:border-teal"
                  : "bg-teal text-obsidian border-teal hover:bg-teal-400 font-bold shadow-neon-teal"
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-teal" />
              <span>{currentUser ? currentUser.name : "Sign In Portal"}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Dashboard */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6 space-y-6 z-10">
        {/* Status Notification Banner */}
        {statusMessage && (
          <div className={`p-4 rounded-2xl border text-xs font-mono flex items-center justify-between shadow-lg animate-fade-in ${
            isErrorStatus
              ? "bg-flare/10 text-flare border-flare/30 shadow-neon-flare"
              : "bg-teal/10 text-teal border-teal/30 shadow-neon-teal"
          }`}>
            <div className="flex items-center gap-2">
              <span className="text-base">{isErrorStatus ? "⚠️" : "⚡"}</span>
              <span>{statusMessage}</span>
            </div>
            <button onClick={() => setStatusMessage("")} className="hover:opacity-75 font-bold p-1">
              ✕
            </button>
          </div>
        )}

        {/* Global Quick Action Bar */}
        <div className={`p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-4 shadow-xl ${
          isDark ? "glass-panel" : "glass-panel-light"
        }`}>
          <div className="flex items-center gap-3">
            <label className="px-4 py-2.5 rounded-xl font-mono text-xs font-bold cursor-pointer transition-all border bg-panel hover:bg-panelHover text-slate-200 border-slate-700 hover:border-teal/50 shadow-sm flex items-center gap-2">
              <span>📁</span>
              <span>Upload CSV Dataset</span>
              <input type="file" accept=".csv" onChange={handleCsvUpload} disabled={busy} className="hidden" />
            </label>

            <button
              onClick={handleGenerateData}
              disabled={busy}
              className="px-4 py-2.5 rounded-xl bg-teal hover:bg-teal-400 text-obsidian font-mono text-xs font-bold transition shadow-neon-teal disabled:opacity-50 flex items-center gap-2"
            >
              <span>⚡</span> Generate Synthetic Stream
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleRunDetection}
              disabled={busy}
              className="px-5 py-2.5 rounded-xl bg-flare hover:bg-flare-600 text-white font-mono text-xs font-bold transition-all shadow-neon-flare disabled:opacity-50 flex items-center gap-2"
            >
              <span>🤖</span> Run AI Fraud Detection Engine
            </button>
          </div>
        </div>

        {/* Executive KPI Metrics Cards Row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className={`p-5 rounded-2xl border shadow-xl ${isDark ? "glass-card" : "bg-white border-slate-200"}`}>
            <div className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
              <span>Total Graph Accounts</span>
              <span className="text-teal font-bold">● Neo4j</span>
            </div>
            <div className="text-3xl font-black font-mono text-teal">
              {stats?.total_accounts !== undefined ? stats.total_accounts.toLocaleString() : "--"}
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-1">Topology Entities Indexed</div>
          </div>

          <div className={`p-5 rounded-2xl border shadow-xl ${isDark ? "glass-card" : "bg-white border-slate-200"}`}>
            <div className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
              <span>Transactions Streamed</span>
              <span className="text-emerald-400 font-bold">● Active</span>
            </div>
            <div className="text-3xl font-black font-mono text-slate-100">
              {stats?.total_transactions !== undefined ? stats.total_transactions.toLocaleString() : "--"}
            </div>
            <div className="text-[11px] font-mono text-emerald-400 mt-1">Real-time Stream Ingested</div>
          </div>

          <div className={`p-5 rounded-2xl border shadow-xl ${isDark ? "glass-card" : "bg-white border-slate-200"}`}>
            <div className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
              <span>Syndicate Alerts</span>
              <span className="text-gold font-bold">● Flagged</span>
            </div>
            <div className="text-3xl font-black font-mono text-gold">
              {stats?.fraud_alerts !== undefined ? stats.fraud_alerts : alerts.length}
            </div>
            <div className="text-[11px] font-mono text-gold mt-1">Starburst & Loop Patterns</div>
          </div>

          <div className={`p-5 rounded-2xl border shadow-xl ${isDark ? "glass-card" : "bg-white border-slate-200"}`}>
            <div className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
              <span>Critical Severity</span>
              <span className="text-flare font-bold">● Action</span>
            </div>
            <div className="text-3xl font-black font-mono text-flare">
              {stats?.high_severity_alerts !== undefined
                ? stats.high_severity_alerts
                : alerts.filter((a) => a.severity === "HIGH" || a.severity === "CRITICAL").length}
            </div>
            <div className="text-[11px] font-mono text-flare mt-1">Immediate KYC Review</div>
          </div>
        </div>

        {/* TAB 1: Analytics & Interactive Graph Topology */}
        {activeTab === "analytics" && (
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between font-mono text-xs">
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                  <span>🌐</span> Interactive Real-Time Transaction Graph Topology
                </h2>
                <span className="text-slate-400">
                  Drag nodes, scroll to zoom, hover for stats, click node to open workbench.
                </span>
              </div>

              <NetworkGraph
                data={graphData}
                flaggedIds={flaggedIds}
                height={540}
                onNodeSelect={handleGraphNodeClick}
                selectedNodeId={investigationAccountId}
              />
            </div>

            {/* Analytics Dashboard Grid: Top Suspicious & Fraud Type Distribution */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Top Suspicious Accounts Table */}
              <div className={`p-5 rounded-2xl border space-y-4 shadow-xl ${isDark ? "glass-panel" : "bg-white border-slate-200"}`}>
                <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-300 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span>🚨</span> Top Suspicious Accounts (Ranked by Risk Score)
                  </span>
                  <span className="text-[10px] text-slate-400">Click to focus</span>
                </h3>
                <div className="space-y-2">
                  {topSuspiciousAccounts.map((acc, idx) => (
                    <div
                      key={acc.id}
                      onClick={() => handleGraphNodeClick(acc.id)}
                      className="p-3 rounded-xl bg-obsidian border border-slate-800/80 hover:border-teal/50 transition cursor-pointer flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-lg bg-panel flex items-center justify-center font-mono text-xs font-bold text-slate-400 group-hover:text-teal">
                          {idx + 1}
                        </span>
                        <div>
                          <div className="font-mono text-xs font-bold text-white group-hover:text-teal transition">
                            {acc.id}
                          </div>
                          <div className="text-[10px] text-slate-400 font-sans">
                            {acc.role || "High Velocity Syndicate Hub"}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="w-24 bg-slate-800 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              acc.risk >= 70 ? "bg-flare shadow-neon-flare" : acc.risk >= 40 ? "bg-gold" : "bg-emerald-400"
                            }`}
                            style={{ width: `${Math.min(100, Math.max(10, acc.risk))}%` }}
                          />
                        </div>
                        <span className={`font-mono text-xs font-bold ${
                          acc.risk >= 70 ? "text-flare" : acc.risk >= 40 ? "text-gold" : "text-emerald-400"
                        }`}>
                          {Math.round(acc.risk)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Fraud Pattern Distribution Breakdown */}
              <div className={`p-5 rounded-2xl border space-y-4 shadow-xl ${isDark ? "glass-panel" : "bg-white border-slate-200"}`}>
                <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-300 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span>📊</span> Fraud Syndicate Pattern Distribution
                  </span>
                  <span className="text-[10px] text-teal font-mono">Live GDS Analytics</span>
                </h3>
                <div className="space-y-3">
                  {Object.entries(fraudDistribution).map(([patternName, count]) => {
                    const percentage = Math.round((count / totalDistributionAlerts) * 100);
                    return (
                      <div key={patternName} className="space-y-1.5">
                        <div className="flex justify-between text-xs font-mono">
                          <span className="text-slate-300">{patternName}</span>
                          <span className="text-teal font-bold">{count} cases ({percentage}%)</span>
                        </div>
                        <div className="w-full bg-obsidian rounded-full h-2.5 overflow-hidden border border-slate-800">
                          <div
                            className="bg-gradient-to-r from-teal-500 to-cyan-400 h-full rounded-full transition-all duration-500"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Forensic Transaction Trace */}
        {activeTab === "trace" && (
          <TransactionTraceView
            selectedAccountId={investigationAccountId || ""}
            onSelectAccount={(accId) => setInvestigationAccountId(accId)}
          />
        )}

        {/* TAB 3: Syndicate Alerts Triage List */}
        {activeTab === "alerts" && (
          <div className="space-y-6">
            <div className={`p-5 rounded-2xl border space-y-4 shadow-xl ${isDark ? "glass-panel" : "bg-white border-slate-200"}`}>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
                    <span>🚨</span> Flagged Fraud Syndicate Rings ({filteredAlerts.length})
                  </h2>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">
                    Real-time automated alerts generated by graph topology heuristics and ML anomaly detectors.
                  </p>
                </div>

                {/* Filter Pills */}
                <div className="flex items-center gap-2">
                  {["ALL", "CRITICAL", "HIGH", "MEDIUM"].map((sev) => (
                    <button
                      key={sev}
                      onClick={() => setAlertSeverityFilter(sev)}
                      className={`px-3 py-1 rounded-xl text-xs font-mono font-semibold transition-all ${
                        alertSeverityFilter === sev
                          ? "bg-teal text-obsidian shadow-neon-teal"
                          : "bg-obsidian text-slate-400 hover:text-white border border-slate-800"
                      }`}
                    >
                      {sev}
                    </button>
                  ))}
                </div>
              </div>

              {/* Alert Search Input */}
              <div>
                <input
                  type="text"
                  value={alertSearchQuery}
                  onChange={(e) => setAlertSearchQuery(e.target.value)}
                  placeholder="Filter alerts by pattern type, description, or account ID…"
                  className="w-full bg-obsidian border border-slate-800 rounded-xl px-4 py-2.5 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-teal"
                />
              </div>

              {/* Alerts Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                {filteredAlerts.length > 0 ? (
                  filteredAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      className="glass-card p-5 rounded-2xl border border-slate-800 space-y-3 relative group"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                              alert.severity === "CRITICAL" || alert.severity === "HIGH"
                                ? "bg-flare/20 text-flare border border-flare/30"
                                : "bg-gold/20 text-gold border border-gold/30"
                            }`}>
                              {alert.severity || "HIGH"}
                            </span>
                            <span className="font-mono text-xs font-bold text-white">
                              {alert.type || "Syndicate Smurfing Ring"}
                            </span>
                          </div>
                          <p className="text-xs text-slate-300 mt-2 line-clamp-2">
                            {alert.description || "Identified multi-account laundering loop."}
                          </p>
                        </div>

                        <button
                          onClick={() => handleInspectAlert(alert)}
                          className="px-3 py-1.5 rounded-xl bg-teal hover:bg-teal-400 text-obsidian font-mono text-xs font-bold shadow-neon-teal transition whitespace-nowrap"
                        >
                          Investigate ➔
                        </button>
                      </div>

                      {/* Involved Accounts Chips */}
                      {alert.account_ids && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-800/80">
                          <span className="text-[10px] font-mono text-slate-500">Nodes:</span>
                          {alert.account_ids.map((id) => (
                            <span
                              key={id}
                              onClick={() => handleGraphNodeClick(id)}
                              className="px-2 py-0.5 rounded-md bg-obsidian border border-slate-800 font-mono text-[10px] text-slate-300 hover:text-teal hover:border-teal/40 cursor-pointer"
                            >
                              {id}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="col-span-2 py-12 text-center text-slate-500 font-mono text-xs">
                    No fraud alerts match the selected criteria.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: Live Ledger Feed */}
        {activeTab === "transactions" && (
          <div className={`p-5 rounded-2xl border space-y-4 shadow-xl ${isDark ? "glass-panel" : "bg-white border-slate-200"}`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
                  <span>⚡</span> Live Streaming Ledger Feed ({filteredTransactions.length})
                </h2>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  High-throughput stream arriving from Kafka & processed by Flink into Neo4j.
                </p>
              </div>

              <input
                type="text"
                value={txSearchQuery}
                onChange={(e) => setTxSearchQuery(e.target.value)}
                placeholder="Search Tx Hash, Sender, Receiver…"
                className="bg-obsidian border border-slate-800 rounded-xl px-4 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-teal"
              />
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-obsidian">
              <table className="w-full text-left font-mono text-xs">
                <thead className="bg-panel border-b border-slate-800 text-slate-400 text-[11px] uppercase">
                  <tr>
                    <th className="py-3 px-4">Transaction ID</th>
                    <th className="py-3 px-4">Sender Account</th>
                    <th className="py-3 px-4">Receiver Account</th>
                    <th className="py-3 px-4 text-right">Amount</th>
                    <th className="py-3 px-4 text-center">Timestamp</th>
                    <th className="py-3 px-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-200">
                  {filteredTransactions.map((tx, idx) => (
                    <tr key={tx.id || idx} className="hover:bg-panelHover transition">
                      <td className="py-2.5 px-4 font-mono text-teal">
                        {(tx.id || `TX_${idx}`).slice(0, 14)}…
                      </td>
                      <td className="py-2.5 px-4">
                        <button
                          onClick={() => handleGraphNodeClick(tx.sender)}
                          className="hover:text-white font-medium hover:underline text-slate-300"
                        >
                          {tx.sender || "ACC_SRC"}
                        </button>
                      </td>
                      <td className="py-2.5 px-4">
                        <button
                          onClick={() => handleGraphNodeClick(tx.receiver)}
                          className="hover:text-white font-medium hover:underline text-slate-300"
                        >
                          {tx.receiver || "ACC_DEST"}
                        </button>
                      </td>
                      <td className="py-2.5 px-4 text-right font-bold text-white">
                        ${Number(tx.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 px-4 text-center text-slate-400 text-[11px]">
                        {tx.timestamp ? new Date(tx.timestamp).toLocaleTimeString() : "Just now"}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <button
                          onClick={() => {
                            if (tx.sender) handleGraphNodeClick(tx.sender);
                          }}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-teal text-[10px] font-mono transition"
                        >
                          Trace
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Investigation Workbench Slide-over Drawer */}
      <InvestigationPanel
        alertId={investigationAlertId}
        accountId={investigationAccountId}
        onClose={() => {
          setInvestigationAlertId(null);
          setInvestigationAccountId(null);
        }}
        onStatusUpdated={() => loadData()}
      />

      {/* Authentication Modal */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onAuthSuccess={(user) => setCurrentUser(user)}
      />
    </div>
  );
}
