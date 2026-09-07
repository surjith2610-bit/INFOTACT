import { useEffect, useState, useCallback, useMemo } from "react";
import NetworkGraph from "../components/NetworkGraph.jsx";
import InvestigationPanel from "../components/InvestigationPanel.jsx";
import TransactionTraceView from "../components/TransactionTraceView.jsx";
import CaseManagementModal from "../components/CaseManagementModal.jsx";
import TimelinePlayback from "../components/TimelinePlayback.jsx";
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
import { formatCurrency, formatINR, formatCompactINR } from "../utils/currency.js";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("analytics"); // "analytics" | "trace" | "alerts" | "cases" | "transactions"
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
  const [themeMode, setThemeMode] = useState("dark"); // Default luxury Black + Wine Grey palette

  // Case Management Modal state
  const [isCaseModalOpen, setIsCaseModalOpen] = useState(false);
  const [caseSuspectNode, setCaseSuspectNode] = useState(null);

  // Timeline scrubber toggle
  const [showTimelineScrubber, setShowTimelineScrubber] = useState(false);

  // Filter states & Currency selection
  const [currency, setCurrency] = useState("INR"); // "INR" | "USD"
  const [alertSeverityFilter, setAlertSeverityFilter] = useState("ALL");
  const [alertSearchQuery, setAlertSearchQuery] = useState("");
  const [txSearchQuery, setTxSearchQuery] = useState("");
  const [txLimit, setTxLimit] = useState(40);

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

  const handleCreateCaseFromNode = (node) => {
    setCaseSuspectNode(node);
    setIsCaseModalOpen(true);
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
      isDark ? "bg-[#08080A] text-slate-100" : "bg-slate-50 text-slate-900"
    }`}>
      {/* Ambient Graph Particle Backdrop */}
      <GraphBackdrop />

      {/* Real-time Toast Alert Notification */}
      {toastNotification && (
        <div className="fixed top-20 right-6 z-50 animate-bounce bg-[#8B1E3F] text-white px-5 py-3 rounded-2xl shadow-2xl border border-red-500/40 font-mono text-xs flex items-center gap-3 backdrop-blur-xl">
          <span className="text-lg">🚨</span>
          <div>
            <div className="font-bold">{toastNotification}</div>
            <div className="text-white/80 text-[10px]">Click alerts tab to investigate full sub-graph</div>
          </div>
          <button onClick={() => setToastNotification(null)} className="ml-3 font-bold text-white/70 hover:text-white">✕</button>
        </div>
      )}

      {/* Top Header Navigation Bar */}
      <header className={`border-b sticky top-0 z-30 shadow-sm backdrop-blur-xl ${
        isDark ? "border-[#1F1C28] bg-[#0E0C13]/90" : "border-slate-200/90 bg-white/95"
      }`}>
        <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-6">
            {/* Logo & Brand Identity */}
            <div className="flex items-center gap-3">
              <div className="relative">
                <span className={`w-3.5 h-3.5 rounded-full block ${
                  wsConnected
                    ? "bg-[#E63946] shadow-lg animate-pulse"
                    : "bg-amber-500"
                }`} />
                <span className="absolute -inset-1 rounded-full bg-[#8B1E3F]/30 animate-ping" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className={`font-extrabold tracking-tight text-xl font-display ${isDark ? "text-white" : "text-slate-900"}`}>
                    Fin<span className="text-[#E63946]">Graph</span>
                  </span>
                  <span className="text-red-400 text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 bg-[#8B1E3F]/20 border border-[#8B1E3F]/40 rounded-full font-bold">
                    v3.0 Enterprise
                  </span>
                </div>
                <div className="text-[10px] font-mono text-slate-400">
                  Real-Time Streaming Graph Syndicate Analytics
                </div>
              </div>
            </div>

            {/* Navigation Bar Tabs */}
            <nav className={`flex items-center border rounded-xl p-1 text-xs font-mono ${
              isDark ? "bg-[#131118] border-[#252030]" : "bg-slate-100/90 border-slate-200"
            }`}>
              <button
                onClick={() => setActiveTab("analytics")}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                  activeTab === "analytics"
                    ? "bg-gradient-to-r from-[#8B1E3F] to-[#A3284E] text-white font-bold shadow-md"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                🌐 Topology
              </button>
              <button
                onClick={() => setActiveTab("trace")}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 ${
                  activeTab === "trace"
                    ? "bg-gradient-to-r from-[#8B1E3F] to-[#A3284E] text-white font-bold shadow-md"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                🔍 Multi-Hop Trace
              </button>
              <button
                onClick={() => setActiveTab("alerts")}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 ${
                  activeTab === "alerts"
                    ? "bg-gradient-to-r from-[#8B1E3F] to-[#A3284E] text-white font-bold shadow-md"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                🚨 Alerts
                {alerts.length > 0 && (
                  <span className="px-1.5 py-0.2 bg-red-600 text-white font-bold text-[10px] rounded-full">
                    {alerts.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab("cases")}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 ${
                  activeTab === "cases"
                    ? "bg-gradient-to-r from-[#8B1E3F] to-[#A3284E] text-white font-bold shadow-md"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                📁 Cases
              </button>
              <button
                onClick={() => setActiveTab("transactions")}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                  activeTab === "transactions"
                    ? "bg-gradient-to-r from-[#8B1E3F] to-[#A3284E] text-white font-bold shadow-md"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                ⚡ Ledger Feed
              </button>
            </nav>
          </div>

          {/* Right Controls & Auth Profile */}
          <div className="flex items-center gap-3">
            {/* Live Streaming Indicator */}
            <div className={`px-3 py-1.5 rounded-xl border text-[11px] font-mono flex items-center gap-2 ${
              wsConnected
                ? isDark ? "bg-[#1C1824] text-emerald-400 border-emerald-500/30" : "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-amber-500/10 text-amber-400 border-amber-500/30"
            }`}>
              <span className={`w-2 h-2 rounded-full ${wsConnected ? "bg-emerald-500 animate-ping" : "bg-amber-500"}`} />
              <span>{wsConnected ? "⚡ Kafka Live 60fps" : "Polling Mode (5s)"}</span>
            </div>

            {/* Currency Toggle Switch (USD ⇄ INR) */}
            <button
              onClick={() => setCurrency((c) => (c === "INR" ? "USD" : "INR"))}
              className={`px-3 py-1.5 rounded-xl border text-xs font-mono font-bold transition-all flex items-center gap-1.5 shadow-sm ${
                currency === "INR"
                  ? isDark ? "bg-[#181622] text-amber-300 border-amber-500/30 hover:bg-[#231F32]" : "bg-emerald-50 text-emerald-800 border-emerald-300"
                  : isDark ? "bg-[#181622] text-blue-300 border-blue-500/30 hover:bg-[#231F32]" : "bg-blue-50 text-blue-700 border-blue-300"
              }`}
              title="Toggle Display Currency (USD ⇄ INR)"
            >
              <span>{currency === "INR" ? "🇮🇳 ₹ INR" : "🇺🇸 $ USD"}</span>
              <span className="text-[10px] text-slate-400 font-normal ml-0.5">⇄</span>
            </button>

            {/* Dark / Light Mode Switcher */}
            <button
              onClick={() => setThemeMode(isDark ? "light" : "dark")}
              className={`p-2 rounded-xl border text-xs font-mono transition-all ${
                isDark ? "bg-[#181622] border-[#282436] text-amber-400 hover:bg-[#231F32]" : "bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200"
              }`}
              title="Toggle Theme"
            >
              {isDark ? "☀️ Light" : "🍷 Wine Dark"}
            </button>

            {/* User Profile / Auth Action */}
            <button
              onClick={() => setIsAuthOpen(true)}
              className={`px-3.5 py-1.5 rounded-xl border text-xs font-mono font-semibold transition-all flex items-center gap-2 ${
                currentUser
                  ? isDark ? "bg-[#1C1824] border-[#8B1E3F]/40 text-rose-300" : "bg-blue-50 border-blue-200 text-blue-700"
                  : "bg-gradient-to-r from-[#8B1E3F] to-[#A3284E] text-white border-transparent hover:opacity-90 font-bold shadow-md"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${currentUser ? "bg-emerald-400" : "bg-white"}`} />
              <span>{currentUser ? currentUser.name : "Sign In"}</span>
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
              ? "bg-red-950/40 text-red-300 border-red-500/30"
              : isDark ? "bg-[#1C1824] text-rose-300 border-[#8B1E3F]/40" : "bg-blue-50 text-blue-700 border-blue-200"
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
        <div className={`p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-4 shadow-xl backdrop-blur-xl ${
          isDark ? "bg-[#131118]/90 border-[#221E2C]" : "bg-white/90 border-slate-200"
        }`}>
          <div className="flex items-center gap-3">
            <label className={`px-4 py-2.5 rounded-xl font-mono text-xs font-bold cursor-pointer transition-all border shadow-sm flex items-center gap-2 ${
              isDark ? "bg-[#1C1824] hover:bg-[#282334] text-slate-200 border-[#2D283C]" : "bg-white hover:bg-slate-50 text-slate-700 border-slate-300"
            }`}>
              <span>📁</span>
              <span>Upload CSV Dataset</span>
              <input type="file" accept=".csv" onChange={handleCsvUpload} disabled={busy} className="hidden" />
            </label>

            <button
              onClick={handleGenerateData}
              disabled={busy}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-700 to-indigo-600 hover:from-blue-600 hover:to-indigo-500 text-white font-mono text-xs font-bold transition shadow-md disabled:opacity-50 flex items-center gap-2"
            >
              <span>⚡</span> Plant Smurfing Stream
            </button>

            <button
              onClick={() => setShowTimelineScrubber((s) => !s)}
              className={`px-3.5 py-2.5 rounded-xl font-mono text-xs font-bold transition border flex items-center gap-2 ${
                showTimelineScrubber
                  ? "bg-[#8B1E3F] text-white border-[#A3284E] shadow-md"
                  : isDark ? "bg-[#1C1824] text-slate-300 border-[#282436] hover:bg-[#252032]" : "bg-slate-100 text-slate-700 border-slate-200"
              }`}
            >
              <span>⏱️</span> {showTimelineScrubber ? "Hide Timeline Scrubber" : "Show Timeline Scrubber"}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setCaseSuspectNode(null);
                setIsCaseModalOpen(true);
              }}
              className="px-4 py-2.5 rounded-xl bg-[#1C1824] hover:bg-[#2A2437] text-rose-300 border border-[#8B1E3F]/40 font-mono text-xs font-bold transition flex items-center gap-2"
            >
              <span>📋</span> AML Cases Workbench
            </button>

            <button
              onClick={handleRunDetection}
              disabled={busy}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#8B1E3F] to-[#E63946] hover:opacity-95 text-white font-mono text-xs font-bold transition-all shadow-lg disabled:opacity-50 flex items-center gap-2"
            >
              <span>🤖</span> Run AI Ensemble Detection
            </button>
          </div>
        </div>

        {/* Executive KPI Metrics Cards Row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className={`p-5 rounded-2xl border shadow-lg transition ${
            isDark ? "bg-[#131118] border-[#221E2C] hover:border-[#8B1E3F]/40" : "bg-white border-slate-200 hover:shadow-md"
          }`}>
            <div className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
              <span>Total Graph Accounts</span>
              <span className="text-rose-400 font-bold">● Neo4j Community</span>
            </div>
            <div className="text-3xl font-black font-mono text-white">
              {stats?.total_accounts !== undefined ? stats.total_accounts.toLocaleString() : "--"}
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-1">Topology Entities Indexed</div>
          </div>

          <div className={`p-5 rounded-2xl border shadow-lg transition ${
            isDark ? "bg-[#131118] border-[#221E2C] hover:border-[#8B1E3F]/40" : "bg-white border-slate-200 hover:shadow-md"
          }`}>
            <div className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
              <span>Transactions Streamed</span>
              <span className="text-blue-400 font-bold">● Flink Stream</span>
            </div>
            <div className={`text-3xl font-black font-mono ${isDark ? "text-slate-100" : "text-slate-900"}`}>
              {stats?.total_transactions !== undefined ? stats.total_transactions.toLocaleString() : "--"}
            </div>
            <div className="text-[11px] font-mono text-blue-400 mt-1">Continuous Real-Time Ingest</div>
          </div>

          <div className={`p-5 rounded-2xl border shadow-lg transition ${
            isDark ? "bg-[#131118] border-[#221E2C] hover:border-[#8B1E3F]/40" : "bg-white border-slate-200 hover:shadow-md"
          }`}>
            <div className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
              <span>Syndicate Alerts</span>
              <span className="text-amber-400 font-bold">● Flagged</span>
            </div>
            <div className="text-3xl font-black font-mono text-amber-400">
              {stats?.fraud_alerts !== undefined ? stats.fraud_alerts : alerts.length}
            </div>
            <div className="text-[11px] font-mono text-amber-400/80 mt-1">Starburst & Loop Patterns</div>
          </div>

          <div className={`p-5 rounded-2xl border shadow-lg transition ${
            isDark ? "bg-[#131118] border-[#221E2C] hover:border-red-500/40" : "bg-white border-slate-200 hover:shadow-md"
          }`}>
            <div className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
              <span>Critical Severity</span>
              <span className="text-red-500 font-bold">● Action Required</span>
            </div>
            <div className="text-3xl font-black font-mono text-red-500">
              {stats?.high_severity_alerts !== undefined
                ? stats.high_severity_alerts
                : alerts.filter((a) => a.severity === "HIGH" || a.severity === "CRITICAL").length}
            </div>
            <div className="text-[11px] font-mono text-red-400 mt-1">Automated Case Filing SLA &lt; 4h</div>
          </div>
        </div>

        {/* TAB 1: Analytics & Interactive Graph Topology */}
        {activeTab === "analytics" && (
          <div className="space-y-6">
            {/* Optional Timeline Playback Scrubber */}
            {showTimelineScrubber && (
              <div className="animate-fade-in">
                <TimelinePlayback themeMode={themeMode} />
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-center justify-between font-mono text-xs">
                <h2 className={`text-sm font-bold uppercase tracking-wider flex items-center gap-2 ${
                  isDark ? "text-slate-200" : "text-slate-800"
                }`}>
                  <span>🌐</span> Real-Time Graph Topology & Syndicate Clustering
                </h2>
                <span className="text-slate-400">
                  Drag nodes, scroll to zoom, hover for stats, click node to drill down into 360° forensic profile.
                </span>
              </div>

              <NetworkGraph
                data={graphData}
                flaggedIds={flaggedIds}
                height={560}
                onNodeSelect={handleGraphNodeClick}
                selectedNodeId={investigationAccountId}
                themeMode={themeMode}
                onCreateCase={handleCreateCaseFromNode}
              />
            </div>

            {/* Analytics Dashboard Grid: Top Suspicious & Fraud Type Distribution */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Top Suspicious Accounts Table */}
              <div className={`p-5 rounded-2xl border space-y-4 shadow-xl ${
                isDark ? "bg-[#131118] border-[#221E2C]" : "bg-white border-slate-200"
              }`}>
                <h3 className={`text-xs font-bold uppercase tracking-wider font-mono flex items-center justify-between ${
                  isDark ? "text-slate-200" : "text-slate-800"
                }`}>
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
                      className={`p-3 rounded-xl border transition cursor-pointer flex items-center justify-between group ${
                        isDark
                          ? "bg-[#1C1824] border-[#282336] hover:bg-[#252033] hover:border-[#8B1E3F]/50"
                          : "bg-slate-50 border-slate-200 hover:bg-rose-50/50 hover:border-rose-300"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`w-6 h-6 rounded-lg border flex items-center justify-center font-mono text-xs font-bold ${
                          isDark
                            ? "bg-[#131118] border-[#2E293D] text-slate-300 group-hover:text-rose-400 group-hover:border-[#8B1E3F]"
                            : "bg-white border-slate-200 text-slate-600 group-hover:text-blue-600"
                        }`}>
                          {idx + 1}
                        </span>
                        <div>
                          <div className={`font-mono text-xs font-bold transition ${
                            isDark ? "text-white group-hover:text-rose-400" : "text-slate-900 group-hover:text-blue-600"
                          }`}>
                            {acc.id}
                          </div>
                          <div className="text-[10px] text-slate-400 font-sans">
                            {acc.role || "High Velocity Syndicate Hub"}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className={`w-24 rounded-full h-2 overflow-hidden ${isDark ? "bg-[#282436]" : "bg-slate-200"}`}>
                          <div
                            className={`h-full rounded-full ${
                              acc.risk >= 70 ? "bg-red-500" : acc.risk >= 40 ? "bg-amber-500" : "bg-blue-600"
                            }`}
                            style={{ width: `${Math.min(100, Math.max(10, acc.risk))}%` }}
                          />
                        </div>
                        <span className={`font-mono text-xs font-bold ${
                          acc.risk >= 70 ? "text-red-500" : acc.risk >= 40 ? "text-amber-400" : "text-blue-400"
                        }`}>
                          {Math.round(acc.risk)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Fraud Pattern Distribution Breakdown */}
              <div className={`p-5 rounded-2xl border space-y-4 shadow-xl ${
                isDark ? "bg-[#131118] border-[#221E2C]" : "bg-white border-slate-200"
              }`}>
                <h3 className={`text-xs font-bold uppercase tracking-wider font-mono flex items-center justify-between ${
                  isDark ? "text-slate-200" : "text-slate-800"
                }`}>
                  <span className="flex items-center gap-2">
                    <span>📊</span> Fraud Syndicate Pattern Distribution
                  </span>
                  <span className="text-[10px] text-rose-400 font-mono font-bold">Live Graph Analytics</span>
                </h3>
                <div className="space-y-3">
                  {Object.entries(fraudDistribution).map(([patternName, count]) => {
                    const percentage = Math.round((count / totalDistributionAlerts) * 100);
                    return (
                      <div key={patternName} className="space-y-1.5">
                        <div className="flex justify-between text-xs font-mono">
                          <span className={isDark ? "text-slate-300" : "text-slate-700"}>{patternName}</span>
                          <span className="text-rose-400 font-bold">{count} cases ({percentage}%)</span>
                        </div>
                        <div className={`w-full rounded-full h-2.5 overflow-hidden border ${
                          isDark ? "bg-[#1C1824] border-[#282336]" : "bg-slate-100 border-slate-200"
                        }`}>
                          <div
                            className="bg-gradient-to-r from-[#8B1E3F] via-[#A3284E] to-[#E63946] h-full rounded-full transition-all duration-500"
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
            <div className={`p-5 rounded-2xl border space-y-4 shadow-xl ${
              isDark ? "bg-[#131118] border-[#221E2C]" : "bg-white border-slate-200"
            }`}>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className={`text-base font-bold tracking-tight flex items-center gap-2 ${
                    isDark ? "text-white" : "text-slate-900"
                  }`}>
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
                          ? "bg-gradient-to-r from-[#8B1E3F] to-[#A3284E] text-white shadow-md font-bold"
                          : isDark ? "bg-[#1C1824] text-slate-400 hover:text-white border border-[#2D283C]" : "bg-slate-100 text-slate-600 hover:text-slate-900 border border-slate-200"
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
                  className={`w-full border rounded-xl px-4 py-2.5 text-xs font-mono placeholder-slate-500 focus:outline-none focus:border-[#8B1E3F] ${
                    isDark ? "bg-[#1C1824] border-[#282336] text-white focus:bg-[#231F30]" : "bg-slate-50 border-slate-200 text-slate-900 focus:bg-white"
                  }`}
                />
              </div>

              {/* Alerts Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                {filteredAlerts.length > 0 ? (
                  filteredAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`p-5 rounded-2xl border space-y-3 relative group transition ${
                        isDark ? "bg-[#1C1824] border-[#282336] hover:border-[#8B1E3F]/60" : "bg-white border-slate-200 hover:border-rose-300"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                              alert.severity === "CRITICAL" || alert.severity === "HIGH"
                                ? "bg-red-500/20 text-red-400 border border-red-500/40"
                                : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                            }`}>
                              {alert.severity || "HIGH"}
                            </span>
                            <span className={`font-mono text-xs font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
                              {alert.type || "Syndicate Smurfing Ring"}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-2 line-clamp-2">
                            {alert.description || "Identified multi-account laundering loop."}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              const accId = alert.account_ids?.[0] || "SHELL_OFFSHORE_01";
                              handleCreateCaseFromNode({ id: accId, name: accId, bank: "Syndicate Entity", risk: 85 });
                            }}
                            className="px-2.5 py-1.5 rounded-xl bg-[#282334] hover:bg-[#342D45] text-rose-300 border border-[#8B1E3F]/40 font-mono text-[11px] font-semibold transition whitespace-nowrap"
                          >
                            + Case
                          </button>
                          <button
                            onClick={() => handleInspectAlert(alert)}
                            className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#8B1E3F] to-[#A3284E] hover:opacity-90 text-white font-mono text-xs font-bold shadow-md transition whitespace-nowrap"
                          >
                            Investigate ➔
                          </button>
                        </div>
                      </div>

                      {/* Involved Accounts Chips */}
                      {alert.account_ids && (
                        <div className={`flex flex-wrap items-center gap-1.5 pt-2 border-t ${
                          isDark ? "border-[#252030]" : "border-slate-100"
                        }`}>
                          <span className="text-[10px] font-mono text-slate-500">Nodes:</span>
                          {alert.account_ids.map((id) => (
                            <span
                              key={id}
                              onClick={() => handleGraphNodeClick(id)}
                              className={`px-2 py-0.5 rounded-md font-mono text-[10px] cursor-pointer transition ${
                                isDark
                                  ? "bg-[#131118] border border-[#2D283C] text-slate-300 hover:text-rose-400 hover:border-[#8B1E3F]"
                                  : "bg-slate-50 border border-slate-200 text-slate-700 hover:text-blue-600 hover:border-blue-300"
                              }`}
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

        {/* TAB 4: Case Management Full-Page Workbench */}
        {activeTab === "cases" && (
          <div className="space-y-4">
            <div className={`p-4 rounded-2xl border flex items-center justify-between shadow-xl ${
              isDark ? "bg-[#131118] border-[#221E2C]" : "bg-white border-slate-200"
            }`}>
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span>📁</span> AML Case Management Dossier System
                </h2>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  Track investigations, record immutable audit notes, change case dispositions, and generate printable compliance dossiers.
                </p>
              </div>

              <button
                onClick={() => {
                  setCaseSuspectNode(null);
                  setIsCaseModalOpen(true);
                }}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#8B1E3F] to-[#A3284E] text-white font-mono text-xs font-bold shadow-md hover:opacity-90 transition flex items-center gap-2"
              >
                <span>➕</span> Open New AML Case
              </button>
            </div>

            {/* Embed or open the Case Management Workbench */}
            <div className={`p-6 rounded-2xl border shadow-xl text-center space-y-4 ${
              isDark ? "bg-[#131118] border-[#221E2C]" : "bg-white border-slate-200"
            }`}>
              <div className="text-4xl">🗂️</div>
              <h3 className="text-lg font-bold text-white font-display">Active Case Registry & Export Center</h3>
              <p className="text-xs text-slate-400 max-w-lg mx-auto font-sans">
                Review existing AML cases filed across Smurfing rings, Circular wash trading, and High-Velocity Starburst syndicates.
              </p>
              <button
                onClick={() => setIsCaseModalOpen(true)}
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-[#8B1E3F] to-[#E63946] text-white font-mono text-sm font-bold shadow-lg hover:opacity-95 transition"
              >
                Launch Case Management Modal ➔
              </button>
            </div>
          </div>
        )}

        {/* TAB 5: Live Ledger Feed */}
        {activeTab === "transactions" && (
          <div className={`p-5 rounded-2xl border space-y-4 shadow-xl ${
            isDark ? "bg-[#131118] border-[#221E2C]" : "bg-white border-slate-200"
          }`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className={`text-base font-bold tracking-tight flex items-center gap-2 ${
                  isDark ? "text-white" : "text-slate-900"
                }`}>
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
                className={`border rounded-xl px-4 py-2 text-xs font-mono placeholder-slate-500 focus:outline-none focus:border-[#8B1E3F] ${
                  isDark ? "bg-[#1C1824] border-[#282336] text-white focus:bg-[#231F30]" : "bg-slate-50 border-slate-200 text-slate-900 focus:bg-white"
                }`}
              />
            </div>

            <div className={`overflow-x-auto rounded-xl border ${
              isDark ? "border-[#252030] bg-[#131118]" : "border-slate-200 bg-white"
            }`}>
              <table className="w-full text-left font-mono text-xs">
                <thead className={`border-b text-[11px] uppercase ${
                  isDark ? "bg-[#1C1824] border-[#252030] text-slate-300" : "bg-slate-100/80 border-slate-200 text-slate-700"
                }`}>
                  <tr>
                    <th className="py-3 px-4">Transaction ID</th>
                    <th className="py-3 px-4">Sender Account</th>
                    <th className="py-3 px-4">Receiver Account</th>
                    <th className="py-3 px-4 text-right">Amount ({currency === "INR" ? "₹" : "$"})</th>
                    <th className="py-3 px-4 text-center">Timestamp</th>
                    <th className="py-3 px-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDark ? "divide-[#1E1A29] text-slate-300" : "divide-slate-100 text-slate-700"}`}>
                  {filteredTransactions.map((tx, idx) => (
                    <tr key={tx.id || idx} className={`transition ${
                      isDark ? "hover:bg-[#1C1824]/60" : "hover:bg-rose-50/50"
                    }`}>
                      <td className="py-2.5 px-4 font-mono text-rose-400 font-semibold">
                        {(tx.id || `TX_${idx}`).slice(0, 14)}…
                      </td>
                      <td className="py-2.5 px-4">
                        <button
                          onClick={() => handleGraphNodeClick(tx.sender)}
                          className="hover:text-rose-400 font-medium hover:underline"
                        >
                          {tx.sender || "ACC_SRC"}
                        </button>
                      </td>
                      <td className="py-2.5 px-4">
                        <button
                          onClick={() => handleGraphNodeClick(tx.receiver)}
                          className="hover:text-rose-400 font-medium hover:underline"
                        >
                          {tx.receiver || "ACC_DEST"}
                        </button>
                      </td>
                      <td className={`py-2.5 px-4 text-right font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
                        {currency === "INR"
                          ? formatINR(tx.amount || 0)
                          : formatCurrency(Number(tx.amount || 0) / 83.0, "USD")}
                      </td>
                      <td className="py-2.5 px-4 text-center text-slate-500 text-[11px]">
                        {tx.timestamp ? new Date(tx.timestamp).toLocaleTimeString() : "Just now"}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <button
                          onClick={() => {
                            if (tx.sender) handleGraphNodeClick(tx.sender);
                          }}
                          className={`px-2.5 py-1 rounded text-[10px] font-mono border transition font-semibold ${
                            isDark ? "bg-[#1C1824] hover:bg-[#262132] text-rose-300 border-[#8B1E3F]/30" : "bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200"
                          }`}
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

      {/* Case Management Workbench Modal */}
      <CaseManagementModal
        isOpen={isCaseModalOpen}
        onClose={() => setIsCaseModalOpen(false)}
        initialSuspectNode={caseSuspectNode}
        themeMode={themeMode}
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
