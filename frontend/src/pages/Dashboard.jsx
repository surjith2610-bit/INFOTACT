import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import NetworkGraph from "../components/NetworkGraph.jsx";
import ProfessionalProfile from "../components/ProfessionalProfile.jsx";
import {
  fetchStats,
  fetchTransactions,
  fetchFraudAlerts,
  graphOverview,
  runDetection,
  uploadCsv,
  generateData,
} from "../api/client.js";

export default function Dashboard() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("analytics"); // "analytics" | "profile"
  const [stats, setStats] = useState(null);
  const [graphData, setGraphData] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [statsRes, graphRes, alertsRes, txRes] = await Promise.allSettled([
        fetchStats(),
        graphOverview(300),
        fetchFraudAlerts(50),
        fetchTransactions(20),
      ]);

      if (statsRes.status === "fulfilled") setStats(statsRes.value.data);
      if (graphRes.status === "fulfilled") setGraphData(graphRes.value.data);
      if (alertsRes.status === "fulfilled") setAlerts(alertsRes.value.data);
      if (txRes.status === "fulfilled") setTransactions(txRes.value.data);
    } catch (err) {
      setStatusMessage("Unable to reach backend API server.");
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

  function handleLogout() {
    localStorage.removeItem("fingraph_token");
    navigate("/login");
  }

  async function handleCsvUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setStatusMessage("Ingesting transaction CSV into graph and streaming channel…");
    try {
      const { data } = await uploadCsv(file);
      setStatusMessage(data.message);
      await loadData();
    } catch (err) {
      setStatusMessage(err.response?.data?.detail || "CSV upload failed.");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function handleGenerateData() {
    setBusy(true);
    setStatusMessage("Generating synthetic transaction flow & smurfing syndicate ring…");
    try {
      const { data } = await generateData({ normal_accounts: 40, normal_transactions: 150, inject_smurfing_ring: true });
      setStatusMessage(data.message);
      await loadData();
    } catch (err) {
      setStatusMessage(err.response?.data?.detail || "Synthetic generation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRunDetection() {
    setBusy(true);
    setStatusMessage("Running graph analytics & modular fraud rules…");
    try {
      const { data } = await runDetection();
      setAlerts(data.alerts || []);
      setStatusMessage(
        `Detection complete: ${data.alert_count} alert(s) identified. (${data.gds?.gds_available ? "GDS PageRank/WCC applied" : "Cypher heuristics applied"})`
      );
      await loadData();
    } catch (err) {
      setStatusMessage(err.response?.data?.detail || "Detection execution failed.");
    } finally {
      setBusy(false);
    }
  }

  // Extract all involved account IDs across active alerts for graph highlight
  const flaggedIds = new Set();
  alerts.forEach((a) => {
    if (Array.isArray(a.account_ids)) {
      a.account_ids.forEach((id) => flaggedIds.add(id));
    }
  });

  return (
    <div className="min-h-screen ledger-bg text-white font-sans">
      {/* Top Header */}
      <header className="border-b border-grid bg-panel/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-teal shadow-[0_0_12px_2px_rgba(45,217,196,0.6)]" />
              <div>
                <span className="font-bold tracking-tight text-lg">FinGraph</span>
                <span className="text-ledger text-xs font-mono ml-2 uppercase tracking-widest hidden sm:inline">Syndicate Analytics</span>
              </div>
            </div>

            {/* Navigation Tabs */}
            <nav className="flex items-center bg-ink/70 border border-grid rounded-lg p-1 text-xs font-mono">
              <button
                onClick={() => setActiveTab("analytics")}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  activeTab === "analytics"
                    ? "bg-teal text-ink font-semibold shadow-md"
                    : "text-ledger hover:text-white"
                }`}
              >
                Graph Analytics
              </button>
              <button
                onClick={() => setActiveTab("profile")}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  activeTab === "profile"
                    ? "bg-teal text-ink font-semibold shadow-md"
                    : "text-ledger hover:text-white"
                }`}
              >
                Professional Profile
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono">
            <div className="flex items-center gap-2 bg-ink border border-grid rounded-full px-3 py-1">
              <span className={`w-2 h-2 rounded-full ${stats?.status === "ok" ? "bg-teal animate-pulse" : "bg-flare"}`} />
              <span className="text-ledger">{stats?.status === "ok" ? "System Online" : "Connecting..."}</span>
            </div>

            <label className="hidden md:flex items-center gap-2 cursor-pointer text-ledger hover:text-white">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="accent-teal cursor-pointer"
              />
              Live Stream (5s)
            </label>

            <button
              onClick={handleLogout}
              className="text-ledger hover:text-white border border-grid px-3 py-1.5 rounded-md transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Status Notification */}
        {statusMessage && (
          <div className="text-xs font-mono text-teal bg-panel border border-teal/30 rounded-lg px-4 py-2.5 flex items-center justify-between">
            <span>{statusMessage}</span>
            <button onClick={() => setStatusMessage("")} className="text-ledger hover:text-white">✕</button>
          </div>
        )}

        {/* Tab Content Switching */}
        {activeTab === "profile" ? (
          <ProfessionalProfile />
        ) : (
          <>

        {/* Executive Summary Metrics Grid */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-panel border border-grid rounded-xl p-4">
            <span className="text-xs font-mono text-ledger uppercase tracking-wide">Total Accounts</span>
            <div className="text-2xl font-bold font-mono mt-1 text-white">
              {stats?.total_accounts ?? "-"}
            </div>
          </div>
          <div className="bg-panel border border-grid rounded-xl p-4">
            <span className="text-xs font-mono text-ledger uppercase tracking-wide">Transactions</span>
            <div className="text-2xl font-bold font-mono mt-1 text-teal">
              {stats?.total_transactions ?? "-"}
            </div>
          </div>
          <div className="bg-panel border border-grid rounded-xl p-4">
            <span className="text-xs font-mono text-ledger uppercase tracking-wide">Fraud Alerts</span>
            <div className="text-2xl font-bold font-mono mt-1 text-flare">
              {stats?.fraud_alerts ?? 0}
            </div>
          </div>
          <div className="bg-panel border border-grid rounded-xl p-4">
            <span className="text-xs font-mono text-ledger uppercase tracking-wide">High / Critical</span>
            <div className="text-2xl font-bold font-mono mt-1 text-gold">
              {stats?.high_severity_alerts ?? 0}
            </div>
          </div>
        </section>

        {/* Action Controls Section */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-panel border border-grid rounded-xl p-4 flex flex-col justify-between">
            <div>
              <h3 className="font-mono text-xs uppercase tracking-wide text-ledger mb-1">Ingest Transaction Data</h3>
              <p className="text-xs text-ledger mb-3">Upload custom CSV payload (sender_account, receiver_account, amount).</p>
            </div>
            <label className="block cursor-pointer">
              <input type="file" accept=".csv" onChange={handleCsvUpload} disabled={busy} className="hidden" id="csv-input" />
              <span className="block w-full text-center bg-teal text-ink font-semibold text-xs rounded-md py-2 hover:bg-teal/90 transition-colors">
                {busy ? "Processing..." : "Choose CSV Dataset"}
              </span>
            </label>
          </div>

          <div className="bg-panel border border-grid rounded-xl p-4 flex flex-col justify-between">
            <div>
              <h3 className="font-mono text-xs uppercase tracking-wide text-ledger mb-1">Synthetic Generator</h3>
              <p className="text-xs text-ledger mb-3">Generate synthetic financial transfers with planted smurfing ring.</p>
            </div>
            <button
              onClick={handleGenerateData}
              disabled={busy}
              className="w-full border border-teal text-teal font-semibold text-xs rounded-md py-2 hover:bg-teal/10 transition-colors disabled:opacity-50"
            >
              Generate Demo Flow
            </button>
          </div>

          <div className="bg-panel border border-grid rounded-xl p-4 flex flex-col justify-between">
            <div>
              <h3 className="font-mono text-xs uppercase tracking-wide text-ledger mb-1">Fraud Detection Engine</h3>
              <p className="text-xs text-ledger mb-3">Execute PageRank, WCC, Smurfing, Circular & Velocity detection rules.</p>
            </div>
            <button
              onClick={handleRunDetection}
              disabled={busy}
              className="w-full bg-flare text-ink font-semibold text-xs rounded-md py-2 hover:bg-flare/90 transition-colors disabled:opacity-50"
            >
              Run Detection Engine
            </button>
          </div>
        </section>

        {/* Network Graph & Alerts Split View */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Network Graph Visualization */}
          <div className="lg:col-span-2 bg-panel border border-grid rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold tracking-wide uppercase font-mono">Transaction Graph Topology</h2>
              <span className="text-xs font-mono text-ledger">
                {graphData?.nodes?.length || 0} Nodes • {graphData?.links?.length || 0} Edges
              </span>
            </div>
            <NetworkGraph data={graphData} flaggedIds={flaggedIds} height={460} />
          </div>

          {/* Fraud Alerts Drawer Panel */}
          <div className="bg-panel border border-grid rounded-xl p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold tracking-wide uppercase font-mono">Fraud Alerts</h2>
              <span className="text-xs font-mono text-flare">{alerts.length} Flagged</span>
            </div>

            <div className="space-y-3 overflow-y-auto max-h-[460px] pr-1 flex-1">
              {alerts.length === 0 ? (
                <div className="text-xs text-ledger font-mono border border-dashed border-grid rounded-lg p-6 text-center">
                  No fraud alerts generated yet. Click "Run Detection Engine" or ingest transactions to analyze patterns.
                </div>
              ) : (
                alerts.map((alert) => (
                  <div
                    key={alert.alert_id || alert.id}
                    onClick={() => setSelectedAlert(alert)}
                    className={`border rounded-lg p-3.5 cursor-pointer transition-all ${
                      selectedAlert?.id === alert.id || selectedAlert?.alert_id === alert.alert_id
                        ? "border-teal bg-teal/10"
                        : alert.severity === "CRITICAL" || alert.severity === "HIGH"
                        ? "border-flare/40 bg-flare/5 hover:border-flare"
                        : "border-gold/40 bg-gold/5 hover:border-gold"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono text-xs font-semibold text-white">
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

                    <p className="text-xs text-ledger line-clamp-2 mb-2 leading-relaxed">
                      {alert.description}
                    </p>

                    <div className="flex items-center justify-between text-[11px] font-mono text-ledger">
                      <span>Entities: {alert.account_ids?.length || 0}</span>
                      <span>{alert.timestamp ? new Date(alert.timestamp).toLocaleTimeString() : "Just now"}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* Recent Transactions Stream Table */}
        <section className="bg-panel border border-grid rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold tracking-wide uppercase font-mono">Streaming Transactions Log</h2>
            <span className="text-xs font-mono text-ledger">Showing latest {transactions.length} events</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-grid text-ledger uppercase">
                  <th className="py-2 px-3">Tx ID</th>
                  <th className="py-2 px-3">Sender Account</th>
                  <th className="py-2 px-3">Receiver Account</th>
                  <th className="py-2 px-3 text-right">Amount</th>
                  <th className="py-2 px-3 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-grid/50">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-ledger">No recent transactions recorded.</td>
                  </tr>
                ) : (
                  transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-ink/50 transition-colors">
                      <td className="py-2 px-3 text-teal">{tx.id}</td>
                      <td className="py-2 px-3 text-white">{tx.sender}</td>
                      <td className="py-2 px-3 text-white">{tx.receiver}</td>
                      <td className="py-2 px-3 text-right font-bold text-white">${tx.amount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td className="py-2 px-3 text-right text-ledger">{tx.timestamp ? new Date(tx.timestamp).toLocaleTimeString() : "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
        </>
        )}
      </main>

      {/* Alert Detail Modal */}
      {selectedAlert && (
        <div className="fixed inset-0 z-50 bg-ink/80 backdrop-blur flex items-center justify-center p-4">
          <div className="bg-panel border border-grid rounded-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-grid pb-3">
              <div>
                <span className="text-xs font-mono text-ledger uppercase">Alert Details</span>
                <h3 className="text-base font-bold text-white font-mono mt-0.5">{selectedAlert.type}</h3>
              </div>
              <button
                onClick={() => setSelectedAlert(null)}
                className="text-ledger hover:text-white font-mono text-sm px-2 py-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-ledger font-mono uppercase">Alert ID:</span>
                <span className="font-mono text-teal ml-2">{selectedAlert.alert_id || selectedAlert.id}</span>
              </div>

              <div>
                <span className="text-ledger font-mono uppercase">Severity:</span>
                <span className="font-mono text-flare font-bold ml-2">{selectedAlert.severity}</span>
              </div>

              <div>
                <span className="text-ledger font-mono uppercase">Description:</span>
                <p className="text-white mt-1 leading-relaxed bg-ink p-3 rounded border border-grid">
                  {selectedAlert.description}
                </p>
              </div>

              <div>
                <span className="text-ledger font-mono uppercase">Involved Accounts:</span>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {selectedAlert.account_ids?.map((acc) => (
                    <span key={acc} className="bg-ink border border-grid font-mono text-teal px-2 py-0.5 rounded text-[11px]">
                      {acc}
                    </span>
                  ))}
                </div>
              </div>

              {selectedAlert.transaction_ids?.length > 0 && (
                <div>
                  <span className="text-ledger font-mono uppercase">Associated Transactions:</span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {selectedAlert.transaction_ids?.map((tx) => (
                      <span key={tx} className="bg-ink border border-grid font-mono text-ledger px-2 py-0.5 rounded text-[11px]">
                        {tx}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-2 text-right">
              <button
                onClick={() => setSelectedAlert(null)}
                className="bg-teal text-ink font-semibold text-xs px-4 py-2 rounded hover:bg-teal/90"
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
