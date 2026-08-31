import React, { useState, useEffect, useMemo, useRef } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { fetchTransactionTrace, searchTransactionsTrace, getErrorMessage } from "../api/client.js";

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
  const [copiedHash, setCopiedHash] = useState(null);
  const graphRef = useRef(null);

  // Sync selectedAccountId prop
  useEffect(() => {
    if (selectedAccountId) {
      setSearchAccountId(selectedAccountId);
    }
  }, [selectedAccountId]);

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

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedHash(text);
    setTimeout(() => setCopiedHash(null), 2000);
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
        netFlow: totalIn - totalOut,
        suspiciousCount: suspicious,
        accountName: traceData.account?.name || searchAccountId,
        accountBank: traceData.account?.bank || "Global Interbank",
      };
    }
    return {
      totalIncoming: 0,
      totalOutgoing: 0,
      netFlow: 0,
      suspiciousCount: 0,
      accountName: "Multi-Account Filter",
      accountBank: "All Integrated Banks",
    };
  }, [traceData, searchAccountId, combinedTransactions]);

  // Build local sub-graph for the trace
  const subGraphData = useMemo(() => {
    if (!traceData) return { nodes: [], links: [] };

    const nodesMap = new Map();
    const links = [];

    // Center target account
    nodesMap.set(searchAccountId, {
      id: searchAccountId,
      name: traceData.account?.name || searchAccountId,
      isTarget: true,
      val: 18,
    });

    (traceData.incoming_transactions || []).forEach((tx) => {
      const sender = tx.sender || "Unknown";
      if (!nodesMap.has(sender)) {
        nodesMap.set(sender, { id: sender, name: tx.sender_name || sender, isTarget: false, val: 8 });
      }
      links.push({
        source: sender,
        target: searchAccountId,
        amount: tx.amount,
        isSuspicious: tx.is_suspicious,
      });
    });

    (traceData.outgoing_transactions || []).forEach((tx) => {
      const receiver = tx.receiver || "Unknown";
      if (!nodesMap.has(receiver)) {
        nodesMap.set(receiver, { id: receiver, name: tx.receiver_name || receiver, isTarget: false, val: 8 });
      }
      links.push({
        source: searchAccountId,
        target: receiver,
        amount: tx.amount,
        isSuspicious: tx.is_suspicious,
      });
    });

    return {
      nodes: Array.from(nodesMap.values()),
      links,
    };
  }, [traceData, searchAccountId]);

  return (
    <div className="space-y-6 font-sans">
      {/* Header & Filter Controls Bar */}
      <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
              <span>🔍</span> Forensic Transaction Trace & Multi-Hop Audit
            </h2>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Inspect historical inbound/outbound transfer flow, intermediary relays, and velocity anomalies.
            </p>
          </div>

          {/* View Mode Switcher */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-obsidian border border-slate-800 text-xs font-mono">
            <button
              onClick={() => setViewMode("split")}
              className={`px-3 py-1.5 rounded-lg transition ${
                viewMode === "split" ? "bg-teal text-obsidian font-bold shadow-neon-teal" : "text-slate-400 hover:text-white"
              }`}
            >
              Split View
            </button>
            <button
              onClick={() => setViewMode("graph")}
              className={`px-3 py-1.5 rounded-lg transition ${
                viewMode === "graph" ? "bg-teal text-obsidian font-bold shadow-neon-teal" : "text-slate-400 hover:text-white"
              }`}
            >
              Topology Subgraph
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`px-3 py-1.5 rounded-lg transition ${
                viewMode === "table" ? "bg-teal text-obsidian font-bold shadow-neon-teal" : "text-slate-400 hover:text-white"
              }`}
            >
              Ledger Table
            </button>
          </div>
        </div>

        {/* Search & Filter Inputs Grid */}
        <form onSubmit={handleSearchSubmit} className="grid grid-cols-1 md:grid-cols-5 gap-3 pt-2">
          <div className="space-y-1">
            <label className="text-[10px] font-mono uppercase text-slate-400">Target Account ID</label>
            <input
              type="text"
              value={searchAccountId}
              onChange={(e) => setSearchAccountId(e.target.value)}
              placeholder="e.g. ACC_9941"
              className="w-full bg-ink border border-slate-700/80 rounded-xl px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-teal"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-mono uppercase text-slate-400">Account Holder Name</label>
            <input
              type="text"
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              placeholder="Search by name…"
              className="w-full bg-ink border border-slate-700/80 rounded-xl px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-teal"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-mono uppercase text-slate-400">Bank Entity</label>
            <input
              type="text"
              value={searchBank}
              onChange={(e) => setSearchBank(e.target.value)}
              placeholder="e.g. JPM, Chase, Citi"
              className="w-full bg-ink border border-slate-700/80 rounded-xl px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-teal"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-mono uppercase text-slate-400">Date Range Start</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-ink border border-slate-700/80 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-teal"
            />
          </div>

          <div className="flex items-end gap-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-teal hover:bg-teal-400 text-obsidian font-mono text-xs font-bold py-2 rounded-xl shadow-neon-teal transition disabled:opacity-50"
            >
              {loading ? "Tracing…" : "Execute Trace"}
            </button>
            <button
              type="button"
              onClick={handleClearFilters}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-xs rounded-xl border border-slate-700 transition"
              title="Reset search"
            >
              ✕
            </button>
          </div>
        </form>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-flare/10 border border-flare/30 text-flare text-xs font-mono flex items-center justify-between">
          <span>⚠️ {error}</span>
          <button onClick={() => setError("")} className="font-bold">✕</button>
        </div>
      )}

      {/* Metric Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 font-mono">
        <div className="glass-card p-4 rounded-xl border border-slate-800">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider">Total Inflow Volume</div>
          <div className="text-2xl font-black text-emerald-400 mt-1">
            ${metrics.totalIncoming.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Inbound transfers</div>
        </div>

        <div className="glass-card p-4 rounded-xl border border-slate-800">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider">Total Outflow Volume</div>
          <div className="text-2xl font-black text-cyan-400 mt-1">
            ${metrics.totalOutgoing.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Outbound transfers</div>
        </div>

        <div className="glass-card p-4 rounded-xl border border-slate-800">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider">Net Retained Balance</div>
          <div className={`text-2xl font-black mt-1 ${metrics.netFlow >= 0 ? "text-teal" : "text-amber-400"}`}>
            ${metrics.netFlow.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Flow Differential</div>
        </div>

        <div className="glass-card p-4 rounded-xl border border-slate-800">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider">Suspicious Transfers</div>
          <div className="text-2xl font-black text-flare mt-1">
            {metrics.suspiciousCount}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Flagged high velocity/cyclic</div>
        </div>
      </div>

      {/* Main Content Area: Split / Graph / Table */}
      <div className={`grid gap-6 ${viewMode === "split" ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
        {/* Topology Sub-Graph */}
        {(viewMode === "split" || viewMode === "graph") && (
          <div className="glass-panel p-4 rounded-2xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <span>🕸️</span> Flow Sub-Graph Topology
              </span>
              <span className="text-slate-400 text-[11px]">
                {subGraphData.nodes.length} Connected Entities • {subGraphData.links.length} Transfers
              </span>
            </div>

            <div className="h-[420px] rounded-xl overflow-hidden bg-ink/95 border border-slate-800/80 relative">
              {subGraphData.nodes.length > 0 ? (
                <ForceGraph2D
                  ref={graphRef}
                  width={viewMode === "split" ? 560 : 1180}
                  height={420}
                  graphData={subGraphData}
                  backgroundColor="#07090E"
                  nodeColor={(n) => (n.isTarget ? "#00F2FE" : "#10B981")}
                  nodeVal={(n) => (n.isTarget ? 14 : 7)}
                  linkColor={() => "rgba(51, 65, 85, 0.6)"}
                  linkDirectionalParticles={2}
                  linkDirectionalParticleSpeed={0.006}
                  linkDirectionalParticleColor={(l) => (l.isSuspicious ? "#FF385C" : "#00F2FE")}
                  onNodeClick={(node) => {
                    if (onSelectAccount) onSelectAccount(node.id);
                  }}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-slate-500 font-mono text-xs">
                  Enter an Account ID above to render sub-graph
                </div>
              )}
            </div>
          </div>
        )}

        {/* Ledger Transactions Table */}
        {(viewMode === "split" || viewMode === "table") && (
          <div className="glass-panel p-4 rounded-2xl border border-slate-800 space-y-3 flex flex-col">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <span>📑</span> Ledger Transfer History ({combinedTransactions.length})
              </span>
              <span className="text-slate-400 text-[11px]">Sorted chronologically</span>
            </div>

            <div className="flex-1 overflow-x-auto max-h-[420px] rounded-xl border border-slate-800 bg-obsidian">
              <table className="w-full text-left font-mono text-xs">
                <thead className="sticky top-0 bg-panel border-b border-slate-800 text-slate-400 text-[11px] uppercase">
                  <tr>
                    <th className="py-2.5 px-3">Flow</th>
                    <th className="py-2.5 px-3">Tx Hash</th>
                    <th className="py-2.5 px-3">Counterparty</th>
                    <th className="py-2.5 px-3 text-right">Amount</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-200">
                  {combinedTransactions.length > 0 ? (
                    combinedTransactions.map((tx, idx) => (
                      <tr key={tx.id || idx} className="hover:bg-panelHover transition">
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            tx.direction === "INCOMING"
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                              : "bg-cyan-500/10 text-cyan-400 border border-cyan-500/30"
                          }`}>
                            {tx.direction === "INCOMING" ? "↓ IN" : "↑ OUT"}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <button
                            onClick={() => copyToClipboard(tx.id || `TX_${idx}`)}
                            className="text-slate-400 hover:text-teal font-mono text-[11px] flex items-center gap-1 group"
                          >
                            <span>{(tx.id || `TX_${idx}`).slice(0, 12)}…</span>
                            <span className="text-[9px] text-slate-500 group-hover:text-teal">
                              {copiedHash === (tx.id || `TX_${idx}`) ? "✓" : "📋"}
                            </span>
                          </button>
                        </td>
                        <td className="py-2.5 px-3">
                          <button
                            onClick={() => {
                              const other = tx.direction === "INCOMING" ? tx.sender : tx.receiver;
                              if (onSelectAccount && other) onSelectAccount(other);
                            }}
                            className="text-slate-300 hover:text-white font-medium hover:underline text-[11px]"
                          >
                            {tx.direction === "INCOMING" ? tx.sender : tx.receiver}
                          </button>
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-white">
                          ${Number(tx.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {tx.is_suspicious ? (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-flare/20 text-flare border border-flare/30">
                              FLAGGED
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                              CLEAN
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500 font-mono text-xs">
                        No transactions found for the specified criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
