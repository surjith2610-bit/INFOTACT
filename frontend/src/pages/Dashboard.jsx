import { useEffect, useState, useCallback, useMemo } from "react";
import NetworkGraph from "../components/NetworkGraph.jsx";
import {
  fetchStats,
  fetchTransactions,
  fetchFraudAlerts,
  graphOverview,
  runDetection,
  uploadCsv,
  generateData,
  getErrorMessage,
} from "../api/client.js";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("analytics"); // "analytics" | "transactions" | "alerts"
  const [stats, setStats] = useState(null);
  const [graphData, setGraphData] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [isErrorStatus, setIsErrorStatus] = useState(false);
  const [busy, setBusy] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  // Filter states
  const [alertSeverityFilter, setAlertSeverityFilter] = useState("ALL");
  const [alertSearchQuery, setAlertSearchQuery] = useState("");
  const [txSearchQuery, setTxSearchQuery] = useState("");
  const [txLimit, setTxLimit] = useState(25);

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
      console.error("[DASHBOARD] Load error:", err);
    }
  }, []);

  useEffect(() => {
    loadData();
    let interval = null;
    if (autoRefresh) {
      interval = setInterval(() => {
        loadData();
      }, 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [loadData, autoRefresh]);

  async function handleCsvUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setIsErrorStatus(false);
    setStatusMessage("Ingesting transaction CSV dataset into graph & streaming memory…");
    console.log("[CSV UPLOAD] Selected file:", file.name, file.size, "bytes");

    try {
      const { data } = await uploadCsv(file);
      console.log("[CSV UPLOAD] Success response:", data);
      setIsErrorStatus(false);
      setStatusMessage(data.message || "CSV dataset uploaded successfully!");
      await loadData();
    } catch (err) {
      console.error("[CSV UPLOAD] Error:", err);
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
    setStatusMessage("Generating synthetic transaction stream with smurfing syndicate ring…");
    console.log("[SYNTHETIC GENERATOR] Starting synthetic data generation...");

    try {
      const { data } = await generateData({ normal_accounts: 40, normal_transactions: 150, inject_smurfing_ring: true });
      console.log("[SYNTHETIC GENERATOR] Success response:", data);
      setIsErrorStatus(false);
      setStatusMessage(data.message || "Synthetic transaction stream generated successfully!");
      await loadData();
    } catch (err) {
      console.error("[SYNTHETIC GENERATOR] Error:", err);
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
    setStatusMessage("Executing graph analytics engine (PageRank, WCC & Fraud Rules)…");
    console.log("[FRAUD DETECTION] Executing detection engine...");

    try {
      const { data } = await runDetection();
      console.log("[FRAUD DETECTION] Success response:", data);
      setAlerts(data.alerts || []);
      setIsErrorStatus(false);
      setStatusMessage(
        `Detection complete: ${data.alert_count} syndicate alert(s) identified.`
      );
      await loadData();
    } catch (err) {
      console.error("[FRAUD DETECTION] Error:", err);
      const errMsg = getErrorMessage(err, "Detection execution failed.");
      setIsErrorStatus(true);
      setStatusMessage(errMsg);
    } finally {
      setBusy(false);
    }
  }

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
      const matchesSeverity =
        alertSeverityFilter === "ALL" || a.severity === alertSeverityFilter;
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

  // Fraud Distribution metrics
  const fraudDistribution = stats?.fraud_type_distribution || {};
  const totalDistributionAlerts = Object.values(fraudDistribution).reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="min-h-screen ledger-bg text-white font-sans flex flex-col">
      {/* Top Header Navigation Bar */}
      <header className="border-b border-grid bg-panel/90 backdrop-blur sticky top-0 z-30 shadow-md">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <span className="w-3 h-3 rounded-full bg-teal shadow-[0_0_12px_2px_rgba(45,217,196,0.8)] animate-pulse" />
              <div>
                <span className="font-bold tracking-tight text-xl text-white">FinGraph</span>
                <span className="text-teal text-xs font-mono ml-2.5 uppercase tracking-widest px-2 py-0.5 bg-teal/10 border border-teal/30 rounded">
                  Direct Analytics Dashboard
                </span>
              </div>
            </div>

            {/* Navigation Bar Tabs */}
            <nav className="flex items-center bg-ink/80 border border-grid rounded-lg p-1 text-xs font-mono">
              <button
                onClick={() => setActiveTab("analytics")}
                className={`px-3.5 py-1.5 rounded-md transition-all ${
                  activeTab === "analytics"
                    ? "bg-teal text-ink font-bold shadow-md"
                    : "text-ledger hover:text-white"
                }`}
              >
                Graph & Analytics
              </button>
              <button
                onClick={() => setActiveTab("transactions")}
                className={`px-3.5 py-1.5 rounded-md transition-all ${
                  activeTab === "transactions"
                    ? "bg-teal text-ink font-bold shadow-md"
                    : "text-ledger hover:text-white"
                }`}
              >
                Live Transactions Log ({transactions.length})
              </button>
              <button
                onClick={() => setActiveTab("alerts")}
                className={`px-3.5 py-1.5 rounded-md transition-all ${
                  activeTab === "alerts"
                    ? "bg-teal text-ink font-bold shadow-md"
                    : "text-ledger hover:text-white"
                }`}
              >
                Syndicate Alerts ({alerts.length})
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono">
            <div className="flex items-center gap-2 bg-ink border border-grid rounded-full px-3 py-1">
              <span className={`w-2 h-2 rounded-full ${stats?.status === "ok" ? "bg-teal" : "bg-flare"}`} />
              <span className="text-ledger">{stats?.status === "ok" ? "Neo4j Connected" : "Connecting DB..."}</span>
            </div>

            <label className="hidden md:flex items-center gap-2 cursor-pointer text-ledger hover:text-white bg-ink/50 px-2.5 py-1 rounded border border-grid/60">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="accent-teal cursor-pointer"
              />
              Stream Auto-Sync (5s)
            </label>

            <button
              onClick={loadData}
              disabled={busy}
              className="text-ledger hover:text-teal border border-grid px-3 py-1 rounded-md transition-colors flex items-center gap-1.5"
              title="Manual Refresh"
            >
              <svg className={`w-3.5 h-3.5 ${busy ? "animate-spin text-teal" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Workspace */}
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6 flex-1 w-full">
        {/* Status Banner */}
        {statusMessage && (
          <div className={`text-xs font-mono rounded-xl px-4 py-3 flex items-center justify-between shadow-lg backdrop-blur border ${
            isErrorStatus
              ? "bg-flare/10 border-flare/40 text-flare"
              : "bg-panel/90 border-teal/40 text-teal"
          }`}>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full animate-ping ${isErrorStatus ? "bg-flare" : "bg-teal"}`} />
              <span>{statusMessage}</span>
            </div>
            <button onClick={() => setStatusMessage("")} className="text-ledger hover:text-white font-bold ml-4">✕</button>
          </div>
        )}

        {/* Executive Summary Metrics Grid */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-panel border border-grid rounded-xl p-4 shadow-md relative overflow-hidden">
            <div className="flex justify-between items-start">
              <span className="text-xs font-mono text-ledger uppercase tracking-wide">Total Accounts</span>
              <span className="text-xs font-mono text-teal bg-teal/10 px-2 py-0.5 rounded border border-teal/20">Graph Nodes</span>
            </div>
            <div className="text-3xl font-bold font-mono mt-2 text-white">
              {stats?.total_accounts?.toLocaleString() ?? "0"}
            </div>
            <p className="text-[11px] text-ledger mt-1 font-mono">Monitored account entities</p>
          </div>

          <div className="bg-panel border border-grid rounded-xl p-4 shadow-md relative overflow-hidden">
            <div className="flex justify-between items-start">
              <span className="text-xs font-mono text-ledger uppercase tracking-wide">Transactions</span>
              <span className="text-xs font-mono text-teal bg-teal/10 px-2 py-0.5 rounded border border-teal/20">Graph Edges</span>
            </div>
            <div className="text-3xl font-bold font-mono mt-2 text-teal">
              {stats?.total_transactions?.toLocaleString() ?? "0"}
            </div>
            <p className="text-[11px] text-ledger mt-1 font-mono">Recorded transfer edges</p>
          </div>

          <div className="bg-panel border border-grid rounded-xl p-4 shadow-md relative overflow-hidden">
            <div className="flex justify-between items-start">
              <span className="text-xs font-mono text-ledger uppercase tracking-wide">Fraud Alerts</span>
              <span className="text-xs font-mono text-flare bg-flare/10 px-2 py-0.5 rounded border border-flare/20">Rule Hits</span>
            </div>
            <div className="text-3xl font-bold font-mono mt-2 text-flare">
              {stats?.fraud_alerts ?? 0}
            </div>
            <p className="text-[11px] text-ledger mt-1 font-mono">Flagged syndicate patterns</p>
          </div>

          <div className="bg-panel border border-grid rounded-xl p-4 shadow-md relative overflow-hidden">
            <div className="flex justify-between items-start">
              <span className="text-xs font-mono text-ledger uppercase tracking-wide">High / Critical Threats</span>
              <span className="text-xs font-mono text-gold bg-gold/10 px-2 py-0.5 rounded border border-gold/20">Action Required</span>
            </div>
            <div className="text-3xl font-bold font-mono mt-2 text-gold">
              {stats?.high_severity_alerts ?? 0}
            </div>
            <p className="text-[11px] text-ledger mt-1 font-mono">Severe risk syndicates</p>
          </div>
        </section>

        {/* Action Controls Section */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-panel border border-grid rounded-xl p-5 flex flex-col justify-between shadow-md">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full bg-teal" />
                <h3 className="font-mono text-xs uppercase tracking-wide font-bold text-white">Ingest CSV Dataset</h3>
              </div>
              <p className="text-xs text-ledger mb-4 leading-relaxed">
                Upload transaction CSV payload (`sender_account`, `receiver_account`, `amount`).
              </p>
            </div>
            <label className="block cursor-pointer">
              <input type="file" accept=".csv" onChange={handleCsvUpload} disabled={busy} className="hidden" />
              <span className="block w-full text-center bg-teal text-ink font-bold text-xs rounded-lg py-2.5 hover:bg-teal/90 transition-colors shadow">
                {busy ? "Processing Ingestion…" : "Upload CSV Dataset"}
              </span>
            </label>
          </div>

          <div className="bg-panel border border-grid rounded-xl p-5 flex flex-col justify-between shadow-md">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full bg-teal" />
                <h3 className="font-mono text-xs uppercase tracking-wide font-bold text-white">Synthetic Flow Generator</h3>
              </div>
              <p className="text-xs text-ledger mb-4 leading-relaxed">
                Simulate financial transfer stream with planted offshore smurfing ring.
              </p>
            </div>
            <button
              onClick={handleGenerateData}
              disabled={busy}
              className="w-full border border-teal text-teal font-bold text-xs rounded-lg py-2.5 hover:bg-teal/10 transition-colors disabled:opacity-50"
            >
              Generate Synthetic Stream
            </button>
          </div>

          <div className="bg-panel border border-grid rounded-xl p-5 flex flex-col justify-between shadow-md">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full bg-flare" />
                <h3 className="font-mono text-xs uppercase tracking-wide font-bold text-white">Graph Detection Engine</h3>
              </div>
              <p className="text-xs text-ledger mb-4 leading-relaxed">
                Execute PageRank, WCC, Smurfing, Circular Loop & Velocity rules.
              </p>
            </div>
            <button
              onClick={handleRunDetection}
              disabled={busy}
              className="w-full bg-flare text-ink font-bold text-xs rounded-lg py-2.5 hover:bg-flare/90 transition-colors shadow disabled:opacity-50"
            >
              Run Fraud Detection
            </button>
          </div>
        </section>

        {/* Tab 1: Graph Analytics & Syndicate Overview */}
        {(activeTab === "analytics" || activeTab === "alerts") && (
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Graph Topology Canvas */}
            <div className="lg:col-span-2 bg-panel border border-grid rounded-xl p-4 shadow-lg flex flex-col">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-grid">
                <div>
                  <h2 className="text-sm font-bold tracking-wide uppercase font-mono text-white flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-teal" />
                    Transaction Graph Topology
                  </h2>
                  <p className="text-[11px] text-ledger font-mono mt-0.5">
                    Interactive network topology of accounts & transaction transfers
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs font-mono">
                  <span className="bg-ink border border-grid rounded px-2.5 py-1 text-teal">
                    {graphData?.nodes?.length || 0} Nodes
                  </span>
                  <span className="bg-ink border border-grid rounded px-2.5 py-1 text-ledger">
                    {graphData?.links?.length || 0} Edges
                  </span>
                </div>
              </div>

              <div className="flex-1 bg-ink/60 rounded-lg overflow-hidden border border-grid/50 relative">
                <NetworkGraph data={graphData} flaggedIds={flaggedIds} height={480} />
              </div>
            </div>

            {/* Fraud Syndicates & Alerts Panel */}
            <div className="bg-panel border border-grid rounded-xl p-4 shadow-lg flex flex-col">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-grid">
                <div>
                  <h2 className="text-sm font-bold tracking-wide uppercase font-mono text-white">Fraud Alerts</h2>
                  <p className="text-[11px] text-ledger font-mono mt-0.5">
                    {filteredAlerts.length} of {alerts.length} Flagged
                  </p>
                </div>
              </div>

              {/* Severity Filter Badges */}
              <div className="flex items-center gap-1.5 mb-3 text-[11px] font-mono">
                {["ALL", "CRITICAL", "HIGH", "MEDIUM"].map((sev) => (
                  <button
                    key={sev}
                    onClick={() => setAlertSeverityFilter(sev)}
                    className={`px-2.5 py-1 rounded transition-colors ${
                      alertSeverityFilter === sev
                        ? "bg-teal text-ink font-bold"
                        : "bg-ink border border-grid text-ledger hover:text-white"
                    }`}
                  >
                    {sev}
                  </button>
                ))}
              </div>

              {/* Search Filter Input */}
              <div className="mb-3">
                <input
                  type="text"
                  placeholder="Filter alerts by pattern or account..."
                  value={alertSearchQuery}
                  onChange={(e) => setAlertSearchQuery(e.target.value)}
                  className="w-full bg-ink border border-grid rounded-lg px-3 py-1.5 text-xs text-white placeholder-ledger focus:outline-none focus:border-teal font-mono"
                />
              </div>

              {/* Alerts List */}
              <div className="space-y-3 overflow-y-auto max-h-[420px] pr-1 flex-1">
                {filteredAlerts.length === 0 ? (
                  <div className="text-xs text-ledger font-mono border border-dashed border-grid rounded-lg p-6 text-center">
                    No fraud alerts match the filter criteria. Run the detection engine or adjust filters.
                  </div>
                ) : (
                  filteredAlerts.map((alert) => (
                    <div
                      key={alert.alert_id || alert.id || Math.random()}
                      onClick={() => setSelectedAlert(alert)}
                      className={`border rounded-lg p-3.5 cursor-pointer transition-all ${
                        selectedAlert?.id === alert.id || selectedAlert?.alert_id === alert.alert_id
                          ? "border-teal bg-teal/10 shadow-md"
                          : alert.severity === "CRITICAL" || alert.severity === "HIGH"
                          ? "border-flare/40 bg-flare/5 hover:border-flare"
                          : "border-gold/40 bg-gold/5 hover:border-gold"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-mono text-xs font-bold text-white">
                          {alert.type || alert.alert_type}
                        </span>
                        <span
                          className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                            alert.severity === "CRITICAL"
                              ? "bg-flare text-ink"
                              : alert.severity === "HIGH"
                              ? "bg-flare/20 text-flare"
                              : "bg-gold/20 text-gold"
                          }`}
                        >
                          {alert.severity}
                        </span>
                      </div>

                      <p className="text-xs text-ledger line-clamp-2 mb-2 leading-relaxed font-sans">
                        {alert.description}
                      </p>

                      <div className="flex items-center justify-between text-[11px] font-mono text-ledger">
                        <span>Entities: {alert.account_ids?.length || 0}</span>
                        <span>{alert.timestamp ? new Date(alert.timestamp).toLocaleTimeString() : "Recent"}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        )}

        {/* Pattern Analytics Breakdown Bar */}
        <section className="bg-panel border border-grid rounded-xl p-5 shadow-md">
          <h2 className="text-xs font-mono font-bold uppercase tracking-wide text-ledger mb-3">
            Syndicate Pattern Distribution Breakdown
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {Object.keys(fraudDistribution).length === 0 ? (
              <div className="col-span-4 text-xs font-mono text-ledger text-center py-2">
                Run detection engine to populate fraud distribution stats.
              </div>
            ) : (
              Object.entries(fraudDistribution).map(([type, count]) => {
                const pct = Math.round((count / totalDistributionAlerts) * 100);
                return (
                  <div key={type} className="bg-ink border border-grid rounded-lg p-3">
                    <div className="flex justify-between items-center text-xs font-mono mb-1">
                      <span className="text-white font-semibold truncate" title={type}>{type}</span>
                      <span className="text-teal font-bold">{count}</span>
                    </div>
                    <div className="w-full bg-grid h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-teal h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-mono text-ledger mt-1 block">{pct}% of total alerts</span>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Tab 2 / Main View: Streaming Transactions Log Data Table */}
        <section className="bg-panel border border-grid rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-grid">
            <div>
              <h2 className="text-sm font-bold tracking-wide uppercase font-mono text-white flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-teal" />
                Streaming Transactions Log
              </h2>
              <p className="text-[11px] text-ledger font-mono mt-0.5">
                Real-time financial transfers recorded in the Neo4j graph & streaming memory
              </p>
            </div>

            {/* Table Controls */}
            <div className="flex items-center gap-3 text-xs font-mono">
              <input
                type="text"
                placeholder="Search account / Tx ID..."
                value={txSearchQuery}
                onChange={(e) => setTxSearchQuery(e.target.value)}
                className="bg-ink border border-grid rounded-lg px-3 py-1.5 text-xs text-white placeholder-ledger focus:outline-none focus:border-teal font-mono w-48 sm:w-64"
              />

              <select
                value={txLimit}
                onChange={(e) => setTxLimit(Number(e.target.value))}
                className="bg-ink border border-grid rounded-lg px-2.5 py-1.5 text-xs text-ledger focus:outline-none focus:border-teal font-mono cursor-pointer"
              >
                <option value={10}>Show 10</option>
                <option value={25}>Show 25</option>
                <option value={50}>Show 50</option>
                <option value={100}>Show 100</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-grid/50">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-grid bg-ink/70 text-ledger uppercase tracking-wider">
                  <th className="py-3 px-4">Transaction ID</th>
                  <th className="py-3 px-4">Sender Account</th>
                  <th className="py-3 px-4">Receiver Account</th>
                  <th className="py-3 px-4 text-right">Amount ($)</th>
                  <th className="py-3 px-4 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-grid/40 bg-panel/40">
                {filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-ledger font-mono">
                      No recent transactions match the search query or database is empty.
                    </td>
                  </tr>
                ) : (
                  filteredTransactions.map((tx) => (
                    <tr key={tx.id || Math.random()} className="hover:bg-ink/60 transition-colors">
                      <td className="py-2.5 px-4 text-teal font-medium">{tx.id}</td>
                      <td className="py-2.5 px-4 text-white">
                        <span className={`px-2 py-0.5 rounded ${flaggedIds.has(tx.sender) ? "bg-flare/20 text-flare border border-flare/40 font-bold" : "bg-ink border border-grid"}`}>
                          {tx.sender}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-white">
                        <span className={`px-2 py-0.5 rounded ${flaggedIds.has(tx.receiver) ? "bg-flare/20 text-flare border border-flare/40 font-bold" : "bg-ink border border-grid"}`}>
                          {tx.receiver}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right font-bold text-white">
                        ${typeof tx.amount === "number" ? tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : tx.amount}
                      </td>
                      <td className="py-2.5 px-4 text-right text-ledger">
                        {tx.timestamp ? new Date(tx.timestamp).toLocaleTimeString() : "-"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* Alert Detail Modal Drawer */}
      {selectedAlert && (
        <div className="fixed inset-0 z-50 bg-ink/80 backdrop-blur flex items-center justify-center p-4">
          <div className="bg-panel border border-grid rounded-xl max-w-lg w-full p-6 space-y-4 shadow-2xl relative">
            <div className="flex items-center justify-between border-b border-grid pb-3">
              <div>
                <span className="text-xs font-mono text-ledger uppercase">Syndicate Investigation Details</span>
                <h3 className="text-base font-bold text-white font-mono mt-0.5">{selectedAlert.type || selectedAlert.alert_type}</h3>
              </div>
              <button
                onClick={() => setSelectedAlert(null)}
                className="text-ledger hover:text-white font-mono text-sm px-2 py-1 bg-ink border border-grid rounded"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between items-center bg-ink p-2.5 rounded border border-grid font-mono">
                <div>
                  <span className="text-ledger uppercase block text-[10px]">Alert ID</span>
                  <span className="text-teal font-semibold">{selectedAlert.alert_id || selectedAlert.id}</span>
                </div>
                <div className="text-right">
                  <span className="text-ledger uppercase block text-[10px]">Severity</span>
                  <span className={`font-bold px-2 py-0.5 rounded text-[10px] ${selectedAlert.severity === "CRITICAL" ? "bg-flare text-ink" : "bg-gold text-ink"}`}>
                    {selectedAlert.severity}
                  </span>
                </div>
              </div>

              <div>
                <span className="text-ledger font-mono uppercase text-[10px] block mb-1">Description & Analysis</span>
                <p className="text-white leading-relaxed bg-ink p-3 rounded-lg border border-grid font-sans">
                  {selectedAlert.description}
                </p>
              </div>

              <div>
                <span className="text-ledger font-mono uppercase text-[10px] block mb-1.5">Involved Account Entities</span>
                <div className="flex flex-wrap gap-1.5">
                  {selectedAlert.account_ids?.map((acc) => (
                    <span key={acc} className="bg-ink border border-flare/50 font-mono text-flare font-semibold px-2.5 py-1 rounded text-[11px]">
                      {acc}
                    </span>
                  ))}
                </div>
              </div>

              {selectedAlert.transaction_ids?.length > 0 && (
                <div>
                  <span className="text-ledger font-mono uppercase text-[10px] block mb-1.5">Associated Transaction IDs</span>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                    {selectedAlert.transaction_ids?.map((tx) => (
                      <span key={tx} className="bg-ink border border-grid font-mono text-ledger px-2 py-0.5 rounded text-[11px]">
                        {tx}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setSelectedAlert(null)}
                className="bg-teal text-ink font-bold text-xs px-5 py-2 rounded-lg hover:bg-teal/90 transition-colors shadow"
              >
                Close View
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
