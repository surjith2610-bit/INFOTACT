import { useEffect, useState, useCallback, useMemo } from "react";
import NetworkGraph from "../components/NetworkGraph.jsx";
import InvestigationPanel from "../components/InvestigationPanel.jsx";
import AuthModal from "../components/AuthModal.jsx";
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
  const [activeTab, setActiveTab] = useState("analytics"); // "analytics" | "transactions" | "alerts" | "investigate"
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
  const [txLimit, setTxLimit] = useState(30);

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
      setToastNotification(`🚨 Real-time Fraud Alert: ${newAlert.type || "Syndicate Pattern"} detected!`);
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
    setStatusMessage("Ingesting transaction CSV dataset into Neo4j graph & streaming engine…");

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
      const { data } = await generateData({ normal_accounts: 40, normal_transactions: 150, inject_smurfing_ring: true });
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

  // Node selection handler from Force Graph
  const handleGraphNodeClick = (accId) => {
    setInvestigationAccountId(accId);
    setInvestigationAlertId(null);
  };

  // Open alert details in Investigation Panel
  const handleInspectAlert = (alert) => {
    setInvestigationAlertId(alert.id || alert.alert_id);
    setInvestigationAccountId(null);
  };

  // Extract all involved account IDs across active alerts for graph highlight
  const flaggedIds = useMemo(() => {
    const ids = new Set();
    alerts.forEach((a) => {
      if (Array.isArray(a.account_ids)) {
        a.account_ids.forEach((id) => ids.add(id));
      }
    });
    return ids;
  }, [alerts]);

  // Filtered alerts logic
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

  // Filtered transactions logic
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

  // Top Suspicious Accounts List (sorted by highest risk)
  const topSuspiciousAccounts = useMemo(() => {
    if (!graphData || !graphData.nodes) return [];
    return [...graphData.nodes]
      .map((n) => ({
        id: n.id,
        risk: n.risk !== undefined ? (n.risk > 1 ? n.risk : n.risk * 100) : 0,
      }))
      .sort((a, b) => b.risk - a.risk)
      .slice(0, 6);
  }, [graphData]);

  // Fraud Distribution metrics
  const fraudDistribution = stats?.fraud_type_distribution || {};
  const totalDistributionAlerts = Object.values(fraudDistribution).reduce((a, b) => a + b, 0) || 1;

  const isDark = themeMode === "dark";

  return (
    <div className={`min-h-screen font-sans flex flex-col transition-colors duration-300 ${isDark ? "bg-slate-950 text-slate-100" : "bg-slate-50 text-slate-900"}`}>
      {/* Real-time Toast Alert Notification */}
      {toastNotification && (
        <div className="fixed top-20 right-6 z-50 animate-bounce bg-red-600 text-white px-5 py-3 rounded-xl shadow-2xl border border-red-400 font-mono text-xs flex items-center gap-3">
          <span className="text-lg">🚨</span>
          <div>
            <div className="font-bold">{toastNotification}</div>
            <div className="text-red-200 text-[10px]">Click alerts tab to investigate full sub-graph</div>
          </div>
          <button onClick={() => setToastNotification(null)} className="ml-3 font-bold text-red-200 hover:text-white">✕</button>
        </div>
      )}

      {/* Top Header Navigation Bar */}
      <header className={`border-b sticky top-0 z-30 shadow-md backdrop-blur ${isDark ? "border-slate-800 bg-slate-900/90" : "border-slate-200 bg-white/90"}`}>
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <span className={`w-3 h-3 rounded-full ${wsConnected ? "bg-emerald-400 shadow-[0_0_12px_2px_rgba(52,211,153,0.8)] animate-pulse" : "bg-amber-400"}`} />
              <div>
                <span className="font-bold tracking-tight text-xl">FinGraph</span>
                <span className="text-teal-400 text-xs font-mono ml-2.5 uppercase tracking-widest px-2 py-0.5 bg-teal-500/10 border border-teal-500/30 rounded">
                  Enterprise AI Fraud Engine
                </span>
              </div>
            </div>

            {/* Navigation Bar Tabs */}
            <nav className={`flex items-center border rounded-lg p-1 text-xs font-mono ${isDark ? "bg-slate-950 border-slate-800" : "bg-slate-100 border-slate-300"}`}>
              <button
                onClick={() => setActiveTab("analytics")}
                className={`px-3.5 py-1.5 rounded-md font-semibold transition ${
                  activeTab === "analytics"
                    ? isDark ? "bg-teal-500 text-slate-950 shadow" : "bg-teal-600 text-white shadow"
                    : isDark ? "text-slate-400 hover:text-white" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Analytics & Topology
              </button>
              <button
                onClick={() => setActiveTab("alerts")}
                className={`px-3.5 py-1.5 rounded-md font-semibold transition flex items-center gap-1.5 ${
                  activeTab === "alerts"
                    ? isDark ? "bg-teal-500 text-slate-950 shadow" : "bg-teal-600 text-white shadow"
                    : isDark ? "text-slate-400 hover:text-white" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Syndicate Alerts
                {alerts.length > 0 && (
                  <span className="px-1.5 py-0.2 bg-red-500 text-white font-bold text-[10px] rounded-full">
                    {alerts.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab("transactions")}
                className={`px-3.5 py-1.5 rounded-md font-semibold transition ${
                  activeTab === "transactions"
                    ? isDark ? "bg-teal-500 text-slate-950 shadow" : "bg-teal-600 text-white shadow"
                    : isDark ? "text-slate-400 hover:text-white" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Live Ledger Feed
              </button>
            </nav>
          </div>

          {/* Right Status & User Profile Actions */}
          <div className="flex items-center gap-3">
            {/* Live Streaming Indicator Pill */}
            <div className={`px-2.5 py-1 rounded-full border text-[11px] font-mono flex items-center gap-1.5 ${
              wsConnected
                ? isDark ? "bg-emerald-950/60 text-emerald-400 border-emerald-500/40" : "bg-emerald-50 text-emerald-700 border-emerald-300"
                : isDark ? "bg-amber-950/60 text-amber-400 border-amber-500/40" : "bg-amber-50 text-amber-700 border-amber-300"
            }`}>
              <span className={`w-2 h-2 rounded-full ${wsConnected ? "bg-emerald-400 animate-ping" : "bg-amber-400"}`} />
              {wsConnected ? "⚡ WebSocket Live" : "Polling Mode (5s)"}
            </div>

            {/* Dark / Light Mode Switcher */}
            <button
              onClick={() => setThemeMode(isDark ? "light" : "dark")}
              className={`p-1.5 rounded-lg border text-xs font-mono transition ${
                isDark ? "bg-slate-800 border-slate-700 text-amber-300 hover:bg-slate-700" : "bg-slate-200 border-slate-300 text-slate-700 hover:bg-slate-300"
              }`}
              title="Toggle Dark/Light Mode"
            >
              {isDark ? "☀️ Light" : "🌙 Dark"}
            </button>

            {/* User Profile / Auth Action */}
            <button
              onClick={() => setIsAuthOpen(true)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-semibold transition flex items-center gap-2 ${
                currentUser
                  ? "bg-slate-800 border-teal-500/50 text-teal-300 hover:border-teal-400"
                  : "bg-teal-500 text-slate-950 border-teal-400 hover:bg-teal-400"
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-teal-400" />
              {currentUser ? currentUser.name : "Sign In Portal"}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6 space-y-6">
        {/* Status Notification Banner */}
        {statusMessage && (
          <div
            className={`p-4 rounded-xl border text-xs font-mono flex items-center justify-between shadow-sm ${
              isErrorStatus
                ? "bg-red-500/10 text-red-400 border-red-500/30"
                : "bg-teal-500/10 text-teal-300 border-teal-500/30"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-base">{isErrorStatus ? "⚠️" : "ℹ️"}</span>
              <span>{statusMessage}</span>
            </div>
            <button onClick={() => setStatusMessage("")} className="hover:opacity-75 font-bold">
              ✕
            </button>
          </div>
        )}

        {/* Global Action Bar */}
        <div className={`p-4 rounded-xl border flex flex-wrap items-center justify-between gap-4 shadow-sm ${isDark ? "bg-slate-900/80 border-slate-800" : "bg-white border-slate-200"}`}>
          <div className="flex items-center gap-3">
            <label className={`px-4 py-2 rounded-lg font-mono text-xs font-bold cursor-pointer transition shadow border ${
              isDark ? "bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700" : "bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300"
            }`}>
              <span>📁 Upload CSV Dataset</span>
              <input type="file" accept=".csv" onChange={handleCsvUpload} disabled={busy} className="hidden" />
            </label>

            <button
              onClick={handleGenerateData}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-teal-500 hover:bg-teal-400 text-slate-950 font-mono text-xs font-bold transition shadow disabled:opacity-50 flex items-center gap-1.5"
            >
              <span>⚡</span> Generate Synthetic Stream
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleRunDetection}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-mono text-xs font-bold transition shadow-lg disabled:opacity-50 flex items-center gap-1.5"
            >
              <span>🤖</span> Run AI Fraud Detection Engine
            </button>
          </div>
        </div>

        {/* Executive KPI Metrics Cards Row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className={`p-5 rounded-xl border shadow-sm ${isDark ? "bg-slate-900/80 border-slate-800" : "bg-white border-slate-200"}`}>
            <div className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-1">Total Processed Accounts</div>
            <div className="text-3xl font-extrabold font-mono text-teal-400">
              {stats?.total_accounts !== undefined ? stats.total_accounts.toLocaleString() : "--"}
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-1">Stored in Neo4j Graph DB</div>
          </div>

          <div className={`p-5 rounded-xl border shadow-sm ${isDark ? "bg-slate-900/80 border-slate-800" : "bg-white border-slate-200"}`}>
            <div className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-1">Total Transactions Logged</div>
            <div className="text-3xl font-extrabold font-mono text-slate-100">
              {stats?.total_transactions !== undefined ? stats.total_transactions.toLocaleString() : "--"}
            </div>
            <div className="text-[11px] font-mono text-emerald-400 mt-1">Real-time Stream Ingested</div>
          </div>

          <div className={`p-5 rounded-xl border shadow-sm ${isDark ? "bg-slate-900/80 border-slate-800" : "bg-white border-slate-200"}`}>
            <div className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-1">Active Fraud Alerts</div>
            <div className="text-3xl font-extrabold font-mono text-amber-400">
              {stats?.fraud_alerts !== undefined ? stats.fraud_alerts : alerts.length}
            </div>
            <div className="text-[11px] font-mono text-amber-400 mt-1">Syndicate Ring Patterns</div>
          </div>

          <div className={`p-5 rounded-xl border shadow-sm ${isDark ? "bg-slate-900/80 border-slate-800" : "bg-white border-slate-200"}`}>
            <div className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-1">Critical / High Severity</div>
            <div className="text-3xl font-extrabold font-mono text-red-500">
              {stats?.high_severity_alerts !== undefined ? stats.high_severity_alerts : alerts.filter(a => a.severity === 'HIGH' || a.severity === 'CRITICAL').length}
            </div>
            <div className="text-[11px] font-mono text-red-400 mt-1">Action Required Immediately</div>
          </div>
        </div>

        {/* TAB 1: Analytics & Interactive Graph Topology */}
        {activeTab === "analytics" && (
          <div className="space-y-6">
            {/* Force-Directed Interactive Graph Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between font-mono text-xs">
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <span>🌐</span> Interactive Real-Time Transaction Graph Topology
                </h2>
                <span className="text-slate-400">
                  Drag nodes, scroll to zoom, hover for account stats, click node to investigate.
                </span>
              </div>

              <NetworkGraph
                data={graphData}
                flaggedIds={flaggedIds}
                height={540}
                onNodeSelect={handleGraphNodeClick}
              />
            </div>

            {/* Analytics Dashboard Grid: Top Suspicious & Fraud Type Distribution */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Top Suspicious Accounts Table */}
              <div className={`p-5 rounded-xl border space-y-4 shadow-sm ${isDark ? "bg-slate-900/80 border-slate-800" : "bg-white border-slate-200"}`}>
                <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-300 flex items-center gap-2">
                  <span>🚨</span> Top Suspicious Accounts (Ranked by Risk Score)
                </h3>
                <div className="space-y-2">
                  {topSuspiciousAccounts.map((acc, idx) => (
                    <div
                      key={acc.id}
                      onClick={() => handleGraphNodeClick(acc.id)}
                      className={`p-3 rounded-lg border flex items-center justify-between font-mono text-xs cursor-pointer transition hover:scale-[1.01] ${
                        isDark ? "bg-slate-950 border-slate-800 hover:border-teal-500/50" : "bg-slate-50 border-slate-200 hover:border-teal-600"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-slate-400">#{idx + 1}</span>
                        <div>
                          <div className="font-bold text-teal-400">{acc.id}</div>
                          <div className="text-[10px] text-slate-400">Click to launch sub-graph inspection</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-red-400">{acc.risk.toFixed(1)} / 100</div>
                        <div className="text-[10px] text-slate-400">AI Risk Rating</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Fraud Pattern Type Breakdown */}
              <div className={`p-5 rounded-xl border space-y-4 shadow-sm ${isDark ? "bg-slate-900/80 border-slate-800" : "bg-white border-slate-200"}`}>
                <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-300 flex items-center gap-2">
                  <span>📊</span> Fraud Syndicate Pattern Distribution
                </h3>
                <div className="space-y-3 font-mono text-xs">
                  {Object.entries(fraudDistribution).length === 0 ? (
                    <div className="text-slate-400 italic">No fraud distribution metrics computed yet.</div>
                  ) : (
                    Object.entries(fraudDistribution).map(([type, count]) => {
                      const pct = Math.round((count / totalDistributionAlerts) * 100);
                      return (
                        <div key={type} className="space-y-1">
                          <div className="flex justify-between text-slate-300">
                            <span>{type.replace(/_/g, " ")}</span>
                            <span className="font-bold text-teal-400">{count} ({pct}%)</span>
                          </div>
                          <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
                            <div
                              className="bg-teal-400 h-full rounded-full transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Syndicate Fraud Alerts List */}
        {activeTab === "alerts" && (
          <div className="space-y-4">
            {/* Filters Bar */}
            <div className={`p-4 rounded-xl border flex flex-wrap items-center justify-between gap-4 font-mono text-xs ${isDark ? "bg-slate-900/80 border-slate-800" : "bg-white border-slate-200"}`}>
              <div className="flex items-center gap-3 flex-1 min-w-[240px]">
                <span className="text-slate-400">Search:</span>
                <input
                  type="text"
                  placeholder="Filter by account ID, description, or pattern..."
                  value={alertSearchQuery}
                  onChange={(e) => setAlertSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-teal-500"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-slate-400">Severity:</span>
                {["ALL", "CRITICAL", "HIGH", "MEDIUM"].map((sev) => (
                  <button
                    key={sev}
                    onClick={() => setAlertSeverityFilter(sev)}
                    className={`px-3 py-1.5 rounded-md font-semibold transition ${
                      alertSeverityFilter === sev
                        ? "bg-teal-500 text-slate-950 font-bold"
                        : "bg-slate-950 text-slate-300 border border-slate-800 hover:bg-slate-800"
                    }`}
                  >
                    {sev}
                  </button>
                ))}
              </div>
            </div>

            {/* Alerts Table */}
            <div className={`border rounded-xl overflow-hidden shadow-sm font-mono text-xs ${isDark ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-white"}`}>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className={`border-b text-slate-400 ${isDark ? "border-slate-800 bg-slate-900/90" : "border-slate-200 bg-slate-100"}`}>
                    <th className="p-3.5">Alert ID</th>
                    <th className="p-3.5">Pattern Type</th>
                    <th className="p-3.5">Severity</th>
                    <th className="p-3.5">AI Risk Score</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5">Description</th>
                    <th className="p-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredAlerts.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400 italic">
                        No fraud alerts matching selected filter criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredAlerts.map((alert) => (
                      <tr key={alert.id || alert.alert_id} className={`hover:bg-slate-900/50 transition`}>
                        <td className="p-3.5 font-bold text-teal-400">{alert.id || alert.alert_id}</td>
                        <td className="p-3.5 font-semibold text-slate-200">{(alert.type || "SYNDICATE").replace(/_/g, " ")}</td>
                        <td className="p-3.5">
                          <span className={`px-2.5 py-1 rounded font-bold text-[10px] uppercase ${
                            alert.severity === "CRITICAL" ? "bg-red-500/20 text-red-400 border border-red-500/40" : "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                          }`}>
                            {alert.severity}
                          </span>
                        </td>
                        <td className="p-3.5 font-bold text-red-400">
                          {alert.risk_score !== undefined ? alert.risk_score.toFixed(1) : "75.0"} / 100
                        </td>
                        <td className="p-3.5">
                          <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                            alert.status === "CONFIRMED_FRAUD" ? "bg-red-500/20 text-red-400" : alert.status === "FALSE_POSITIVE" ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"
                          }`}>
                            {alert.status || "PENDING"}
                          </span>
                        </td>
                        <td className="p-3.5 text-slate-300 max-w-md truncate">{alert.description}</td>
                        <td className="p-3.5 text-right">
                          <button
                            onClick={() => handleInspectAlert(alert)}
                            className="px-3 py-1.5 bg-teal-500/20 hover:bg-teal-500 text-teal-300 hover:text-slate-950 font-bold rounded transition border border-teal-500/40"
                          >
                            Investigate 🔍
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: Live Transactions Feed */}
        {activeTab === "transactions" && (
          <div className="space-y-4 font-mono text-xs">
            <div className={`p-4 rounded-xl border flex items-center justify-between ${isDark ? "bg-slate-900/80 border-slate-800" : "bg-white border-slate-200"}`}>
              <div className="flex items-center gap-3 flex-1 max-w-md">
                <span className="text-slate-400">Search Ledger:</span>
                <input
                  type="text"
                  placeholder="Filter by tx ID or account..."
                  value={txSearchQuery}
                  onChange={(e) => setTxSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-teal-500"
                />
              </div>
              <div className="text-slate-400">
                Showing top <span className="text-teal-400 font-bold">{filteredTransactions.length}</span> live transactions
              </div>
            </div>

            <div className={`border rounded-xl overflow-hidden shadow-sm ${isDark ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-white"}`}>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className={`border-b text-slate-400 ${isDark ? "border-slate-800 bg-slate-900/90" : "border-slate-200 bg-slate-100"}`}>
                    <th className="p-3.5">Transaction ID</th>
                    <th className="p-3.5">Sender Account</th>
                    <th className="p-3.5">Receiver Account</th>
                    <th className="p-3.5">Amount ($)</th>
                    <th className="p-3.5">Timestamp</th>
                    <th className="p-3.5 text-right">Inspect</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-400 italic">
                        No transactions ingested yet. Run synthetic stream generator or upload a CSV file.
                      </td>
                    </tr>
                  ) : (
                    filteredTransactions.map((tx) => (
                      <tr key={tx.id || tx.txId} className="hover:bg-slate-900/50 transition">
                        <td className="p-3.5 font-bold text-teal-400">{tx.id || tx.txId}</td>
                        <td className="p-3.5 font-semibold text-slate-200">{tx.sender}</td>
                        <td className="p-3.5 font-semibold text-slate-200">{tx.receiver}</td>
                        <td className={`p-3.5 font-bold ${Number(tx.amount) >= 10000 ? "text-red-400" : "text-emerald-400"}`}>
                          ${Number(tx.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="p-3.5 text-slate-400">{new Date(tx.timestamp).toLocaleTimeString()}</td>
                        <td className="p-3.5 text-right">
                          <button
                            onClick={() => handleGraphNodeClick(tx.sender)}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700"
                          >
                            Inspect Node
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Investigation Panel Modal */}
      {(investigationAlertId || investigationAccountId) && (
        <InvestigationPanel
          alertId={investigationAlertId}
          accountId={investigationAccountId}
          onClose={() => {
            setInvestigationAlertId(null);
            setInvestigationAccountId(null);
          }}
          onStatusUpdated={() => loadData()}
        />
      )}

      {/* Auth Portal Modal */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onAuthSuccess={(user) => setCurrentUser(user)}
      />
    </div>
  );
}
