import React, { useState, useEffect, useMemo, useRef } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { fetchTransactionTrace, searchTransactionsTrace, getErrorMessage } from "../api/client";

export default function TransactionTraceView({ selectedAccountId = "", onSelectAccount }) {
  const [searchAccountId, setSearchAccountId] = useState(selectedAccountId || "");
  const [searchName, setSearchName] = useState("");
  const [searchBank, setSearchBank] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [viewMode, setViewMode] = useState("split"); // "split" | "table" | "graph"

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [traceData, setTraceData] = useState(null);
  const [searchResult, setSearchResult] = useState(null);
  const graphRef = useRef(null);

  // Sync selectedAccountId prop changes
  useEffect(() => {
    if (selectedAccountId) {
      setSearchAccountId(selectedAccountId);
    }
  }, [selectedAccountId]);

  // Load data whenever filters change or active account changes
  const loadTrace = async () => {
    setLoading(true);
    setError("");
    try {
      if (searchAccountId.trim()) {
        const res = await fetchTransactionTrace(searchAccountId.trim(), {
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        });
        setTraceData(res.data);
        setSearchResult(null);
      } else {
        const res = await searchTransactionsTrace({
          name: searchName || undefined,
          bank: searchBank || undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        });
        setSearchResult(res.data);
        setTraceData(null);
      }
    } catch (err) {
      setError(getErrorMessage(err, "Failed to load transaction trace data."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTrace();
  }, [searchAccountId]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    loadTrace();
  };

  const handleClearFilters = () => {
    setSearchAccountId("");
    setSearchName("");
    setSearchBank("");
    setStartDate("");
    setEndDate("");
    setTraceData(null);
    setSearchResult(null);
  };

  // Combine transactions for table display
  const combinedTransactions = useMemo(() => {
    if (traceData) {
      const incoming = (traceData.incoming_transactions || []).map((t) => ({ ...t, direction: "INCOMING" }));
      const outgoing = (traceData.outgoing_transactions || []).map((t) => ({ ...t, direction: "OUTGOING" }));
      return [...incoming, ...outgoing].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }
    if (searchResult) {
      return searchResult.transactions || [];
    }
    return [];
  }, [traceData, searchResult]);

  // Compute metrics
  const metrics = useMemo(() => {
    if (traceData) {
      const totalIn = traceData.total_incoming || 0;
      const totalOut = traceData.total_outgoing || 0;
      const suspicious = combinedTransactions.filter((t) => t.is_suspicious).length;
      return {
        totalIncoming: totalIn,
        totalOutgoing: totalOut,
        totalVolume: totalIn + totalOut,
        suspiciousCount: suspicious,
        accountName: traceData.account?.name || searchAccountId,
        accountBank: traceData.account?.bank || "N/A",
      };
    }
    if (searchResult) {
      return {
        totalIncoming: searchResult.total_incoming || 0,
        totalOutgoing: searchResult.total_outgoing || 0,
        totalVolume: searchResult.total_volume || 0,
        suspiciousCount: searchResult.suspicious_count || 0,
        accountName: "All Filtered Accounts",
        accountBank: searchBank || "All Banks",
      };
    }
    return {
      totalIncoming: 0,
      totalOutgoing: 0,
      totalVolume: 0,
      suspiciousCount: 0,
      accountName: "N/A",
      accountBank: "N/A",
    };
  }, [traceData, searchResult, combinedTransactions, searchAccountId, searchBank]);

  // Build Graph Nodes & Edges from transactions
  const graphData = useMemo(() => {
    const nodesMap = {};
    const links = [];

    combinedTransactions.forEach((tx) => {
      const fromId = tx.from_account || "UNKNOWN_SRC";
      const toId = tx.to_account || "UNKNOWN_DST";

      if (!nodesMap[fromId]) {
        nodesMap[fromId] = {
          id: fromId,
          name: tx.from_name || fromId,
          bank: tx.from_bank || "Bank",
          isTarget: fromId === searchAccountId,
        };
      }
      if (!nodesMap[toId]) {
        nodesMap[toId] = {
          id: toId,
          name: tx.to_name || toId,
          bank: tx.to_bank || "Bank",
          isTarget: toId === searchAccountId,
        };
      }

      links.push({
        source: fromId,
        target: toId,
        amount: tx.amount,
        timestamp: tx.timestamp,
        transactionId: tx.transaction_id || tx.id,
        isSuspicious: Boolean(tx.is_suspicious),
      });
    });

    return {
      nodes: Object.values(nodesMap),
      links,
    };
  }, [combinedTransactions, searchAccountId]);

  const formatCurrency = (amt) => {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amt || 0);
  };

  const formatDateTime = (ts) => {
    if (!ts) return "N/A";
    try {
      return new Date(ts).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return ts;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span className="p-2 bg-indigo-600/20 text-indigo-400 rounded-lg text-lg">🔍</span>
              Transaction Trace & Flow Workbench
            </h2>
            <p className="text-slate-400 text-xs mt-1">
              Investigate account transfer chains, Bank-to-Bank flows, and smurfing transaction patterns.
            </p>
          </div>

          {/* View Switcher */}
          <div className="flex items-center bg-slate-800 p-1 rounded-lg border border-slate-700 self-start">
            <button
              onClick={() => setViewMode("split")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                viewMode === "split" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white"
              }`}
            >
              Split View
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                viewMode === "table" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white"
              }`}
            >
              Table Only
            </button>
            <button
              onClick={() => setViewMode("graph")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                viewMode === "graph" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white"
              }`}
            >
              Graph Only
            </button>
          </div>
        </div>

        {/* Filters Form */}
        <form onSubmit={handleSearchSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-3 border-t border-slate-800">
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Account Number</label>
            <input
              type="text"
              placeholder="e.g. ACC0001 or SHELL01"
              value={searchAccountId}
              onChange={(e) => setSearchAccountId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Holder Name</label>
            <input
              type="text"
              placeholder="e.g. Alice Smith"
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Bank Name</label>
            <input
              type="text"
              placeholder="e.g. HDFC or SBI"
              value={searchBank}
              onChange={(e) => setSearchBank(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Date Range</label>
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-1/2 bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-[11px] text-white focus:outline-none focus:border-indigo-500"
              />
              <span className="text-slate-500 text-xs">-</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-1/2 bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-[11px] text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="flex items-end gap-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs px-3 py-2.5 rounded-lg shadow transition-colors flex items-center justify-center gap-1"
            >
              {loading ? "Tracing..." : "Apply Filters"}
            </button>
            <button
              type="button"
              onClick={handleClearFilters}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs px-3 py-2.5 rounded-lg border border-slate-700 transition-colors"
            >
              Clear
            </button>
          </div>
        </form>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="text-red-400 hover:text-white font-bold ml-2">✕</button>
        </div>
      )}

      {/* Summary Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-emerald-500/30 rounded-xl p-4 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-2 h-full bg-emerald-500" />
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">Total Incoming</p>
          <h3 className="text-xl font-extrabold text-emerald-400 mt-1">{formatCurrency(metrics.totalIncoming)}</h3>
          <p className="text-[11px] text-slate-500 mt-1">Inbound transfers to target</p>
        </div>

        <div className="bg-slate-900 border border-sky-500/30 rounded-xl p-4 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-2 h-full bg-sky-500" />
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">Total Outgoing</p>
          <h3 className="text-xl font-extrabold text-sky-400 mt-1">{formatCurrency(metrics.totalOutgoing)}</h3>
          <p className="text-[11px] text-slate-500 mt-1">Outbound transfers from target</p>
        </div>

        <div className="bg-slate-900 border border-indigo-500/30 rounded-xl p-4 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-2 h-full bg-indigo-500" />
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">Net Volume</p>
          <h3 className="text-xl font-extrabold text-indigo-300 mt-1">{formatCurrency(metrics.totalVolume)}</h3>
          <p className="text-[11px] text-slate-500 mt-1">{combinedTransactions.length} traced transactions</p>
        </div>

        <div className="bg-slate-900 border border-rose-500/30 rounded-xl p-4 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-2 h-full bg-rose-500" />
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">Suspicious Transfers</p>
          <h3 className="text-xl font-extrabold text-rose-500 mt-1">{metrics.suspiciousCount}</h3>
          <p className="text-[11px] text-slate-500 mt-1">Smurfing & repeated velocity flags</p>
        </div>
      </div>

      {/* Main Content Layout */}
      <div className={`grid gap-6 ${viewMode === "split" ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
        {/* Table View */}
        {(viewMode === "split" || viewMode === "table") && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-500" />
                Transaction Flow Trace ({combinedTransactions.length})
              </h3>
              <span className="text-slate-400 text-xs font-mono">
                {searchAccountId ? `Account: ${searchAccountId}` : "Global Trace"}
              </span>
            </div>

            <div className="overflow-x-auto max-h-[500px] overflow-y-auto rounded-lg border border-slate-800">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-800 text-slate-300 uppercase text-[10px] tracking-wider sticky top-0 z-10">
                  <tr>
                    <th className="py-2.5 px-3">From Name / Bank</th>
                    <th className="py-2.5 px-3">To Name / Bank</th>
                    <th className="py-2.5 px-3 text-right">Amount</th>
                    <th className="py-2.5 px-3">Timestamp</th>
                    <th className="py-2.5 px-3">Tx ID</th>
                    <th className="py-2.5 px-3">Risk Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {combinedTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500 text-xs">
                        No transactions found matching the specified filters.
                      </td>
                    </tr>
                  ) : (
                    combinedTransactions.map((tx, idx) => {
                      const isSuspicious = Boolean(tx.is_suspicious);
                      return (
                        <tr
                          key={tx.transaction_id || tx.id || idx}
                          className={`transition-colors ${
                            isSuspicious
                              ? "bg-rose-950/40 hover:bg-rose-900/50 text-rose-100 border-l-4 border-l-rose-500"
                              : "hover:bg-slate-800/40 text-slate-300"
                          }`}
                        >
                          {/* Sender Info */}
                          <td className="py-2.5 px-3">
                            <div
                              onClick={() => onSelectAccount && onSelectAccount(tx.from_account)}
                              className="font-medium hover:text-indigo-400 cursor-pointer flex items-center gap-1.5"
                            >
                              <span className="text-white font-semibold">{tx.from_name || tx.from_account}</span>
                            </div>
                            <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                              <span className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">{tx.from_bank || "Bank"}</span>
                              <span className="font-mono text-slate-400">({tx.from_account})</span>
                            </div>
                          </td>

                          {/* Receiver Info */}
                          <td className="py-2.5 px-3">
                            <div
                              onClick={() => onSelectAccount && onSelectAccount(tx.to_account)}
                              className="font-medium hover:text-indigo-400 cursor-pointer flex items-center gap-1.5"
                            >
                              <span className="text-white font-semibold">{tx.to_name || tx.to_account}</span>
                            </div>
                            <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                              <span className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">{tx.to_bank || "Bank"}</span>
                              <span className="font-mono text-slate-400">({tx.to_account})</span>
                            </div>
                          </td>

                          {/* Amount */}
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-100">
                            {formatCurrency(tx.amount)}
                          </td>

                          {/* Timestamp */}
                          <td className="py-2.5 px-3 text-[11px] text-slate-400 whitespace-nowrap">
                            {formatDateTime(tx.timestamp)}
                          </td>

                          {/* Transaction ID */}
                          <td className="py-2.5 px-3 font-mono text-[10px] text-slate-400 truncate max-w-[100px]">
                            {tx.transaction_id || tx.id}
                          </td>

                          {/* Risk Status */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            {isSuspicious ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                                🚨 SUSPICIOUS
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                ✓ Normal
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Graph View (Neo4j Style Force Directed Graph) */}
        {(viewMode === "split" || viewMode === "graph") && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Graph Topology & Relationship Visualization
              </h3>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="flex items-center gap-1 text-slate-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Normal Node
                </span>
                <span className="flex items-center gap-1 text-slate-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" /> Suspicious Transfer
                </span>
              </div>
            </div>

            <div className="w-full h-[480px] bg-slate-950 rounded-lg overflow-hidden border border-slate-800 relative">
              {graphData.nodes.length === 0 ? (
                <div className="w-full h-full flex items-center justify-center text-slate-500 text-xs">
                  No topology data available for rendering.
                </div>
              ) : (
                <ForceGraph2D
                  ref={graphRef}
                  graphData={graphData}
                  nodeLabel={(n) => `${n.name} (${n.bank}) - ID: ${n.id}`}
                  nodeColor={(n) => (n.id === searchAccountId ? "#6366f1" : "#10b981")}
                  nodeVal={(n) => (n.id === searchAccountId ? 8 : 4)}
                  linkColor={(link) => (link.isSuspicious ? "#f43f5e" : "#475569")}
                  linkWidth={(link) => (link.isSuspicious ? 2.5 : 1)}
                  linkDirectionalArrowLength={4}
                  linkDirectionalArrowRelPos={0.9}
                  linkLabel={(link) => `Amount: ₹${link.amount} | ID: ${link.transactionId}`}
                  onNodeClick={(node) => {
                    if (node && node.id) {
                      setSearchAccountId(node.id);
                      if (onSelectAccount) onSelectAccount(node.id);
                    }
                  }}
                  canvasObject={(node, ctx, globalScale) => {
                    const label = `${node.name} (${node.bank})`;
                    const fontSize = 12 / globalScale;
                    ctx.font = `${fontSize}px Sans-Serif`;

                    const r = node.id === searchAccountId ? 7 : 5;
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
                    ctx.fillStyle = node.id === searchAccountId ? "#6366f1" : "#10b981";
                    ctx.fill();

                    if (node.id === searchAccountId) {
                      ctx.strokeStyle = "#a5b4fc";
                      ctx.lineWidth = 2 / globalScale;
                      ctx.stroke();
                    }

                    if (globalScale > 1.2 || node.id === searchAccountId) {
                      ctx.fillStyle = "#e2e8f0";
                      ctx.textAlign = "center";
                      ctx.textBaseline = "top";
                      ctx.fillText(label, node.x, node.y + r + 2);
                    }
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
