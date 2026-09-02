import React, { useState, useEffect, useMemo, useRef } from "react";
import ForceGraph2D from "react-force-graph-2d";
import {
  fetchAccountTransactions,
  fetchMultiHopTrace,
  fetchMoneyFlowGraph,
  fetchFraudAnalysis,
  searchTransactionsTrace,
  getErrorMessage,
} from "../api/client.js";

export default function TransactionTraceView({ selectedAccountId = "", onSelectAccount }) {
  const [searchTarget, setSearchTarget] = useState(selectedAccountId || "SHELL_OFFSHORE_01");
  const [traceDepth, setTraceDepth] = useState(3);
  const [searchType, setSearchType] = useState("account"); // "account" | "transaction"

  // Filter controls
  const [bankFilter, setBankFilter] = useState("ALL");
  const [minAmountFilter, setMinAmountFilter] = useState("");
  const [maxAmountFilter, setMaxAmountFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("ALL");
  const [fraudOnlyFilter, setFraudOnlyFilter] = useState(false);
  const [viewMode, setViewMode] = useState("split"); // "split" | "graph" | "table"

  // Data states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [accountData, setAccountData] = useState(null);
  const [multiHopTrace, setMultiHopTrace] = useState(null);
  const [flowGraph, setFlowGraph] = useState(null);
  const [fraudAnalysis, setFraudAnalysis] = useState(null);

  // Selected item modal/popover states
  const [inspectingNode, setInspectingNode] = useState(null);
  const [inspectingEdge, setInspectingEdge] = useState(null);
  const [copiedText, setCopiedText] = useState(null);

  const graphRef = useRef(null);

  // Sync selectedAccountId prop
  useEffect(() => {
    if (selectedAccountId) {
      setSearchTarget(selectedAccountId);
      setSearchType("account");
    }
  }, [selectedAccountId]);

  const loadData = async (target, depth, type) => {
    if (!target.trim()) return;
    setLoading(true);
    setError("");
    setInspectingNode(null);
    setInspectingEdge(null);

    try {
      if (type === "account") {
        const [accRes, flowRes, fraudRes] = await Promise.allSettled([
          fetchAccountTransactions(target.trim()),
          fetchMoneyFlowGraph(target.trim(), depth),
          fetchFraudAnalysis(target.trim()),
        ]);

        if (accRes.status === "fulfilled") setAccountData(accRes.value.data);
        if (flowRes.status === "fulfilled") setFlowGraph(flowRes.value.data);
        if (fraudRes.status === "fulfilled") setFraudAnalysis(fraudRes.value.data);

        // Also run multi-hop trace from this account
        try {
          const traceRes = await fetchMultiHopTrace(target.trim(), depth);
          setMultiHopTrace(traceRes.data);
        } catch (e) {
          console.warn("Multi-hop trace warning:", e);
        }
      } else {
        // Search by Transaction ID
        const traceRes = await fetchMultiHopTrace(target.trim(), depth);
        setMultiHopTrace(traceRes.data);
        if (traceRes.data && traceRes.data.hops && traceRes.data.hops.length > 0) {
          const originAcc = traceRes.data.hops[0].from;
          const [accRes, fraudRes] = await Promise.allSettled([
            fetchAccountTransactions(originAcc),
            fetchFraudAnalysis(originAcc),
          ]);
          if (accRes.status === "fulfilled") setAccountData(accRes.value.data);
          if (fraudRes.status === "fulfilled") setFraudAnalysis(fraudRes.value.data);
        }
      }
    } catch (err) {
      setError(getErrorMessage(err, "Failed to load transaction trace & fraud analysis."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(searchTarget, traceDepth, searchType);
  }, [searchTarget, traceDepth]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    loadData(searchTarget, traceDepth, searchType);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  // Quick Preset Selector
  const selectPreset = (id, type = "account") => {
    setSearchType(type);
    setSearchTarget(id);
    if (onSelectAccount) onSelectAccount(id);
  };

  // Consolidated ledger transactions for table rendering
  const allLedgerTransactions = useMemo(() => {
    if (multiHopTrace && multiHopTrace.edges && multiHopTrace.edges.length > 0) {
      return multiHopTrace.edges;
    }
    if (flowGraph && flowGraph.edges && flowGraph.edges.length > 0) {
      return flowGraph.edges;
    }
    if (accountData) {
      const inc = (accountData.incoming || []).map((t) => ({ ...t, direction: "INCOMING" }));
      const out = (accountData.outgoing || []).map((t) => ({ ...t, direction: "OUTGOING" }));
      return [...inc, ...out];
    }
    return [];
  }, [multiHopTrace, flowGraph, accountData]);

  // Filtered transactions based on UI controls
  const filteredTransactions = useMemo(() => {
    return allLedgerTransactions.filter((tx) => {
      const amt = Number(tx.amount || 0);
      const bFrom = (tx.bankFrom || tx.from_bank || "").toLowerCase();
      const bTo = (tx.bankTo || tx.to_bank || "").toLowerCase();
      const ch = (tx.channel || tx.mode || "").toUpperCase();
      const isSusp = tx.isSuspicious || tx.is_suspicious || amt >= 10000 || (9000 <= amt && amt < 10000);

      if (bankFilter !== "ALL") {
        const b = bankFilter.toLowerCase();
        if (!bFrom.includes(b) && !bTo.includes(b)) return false;
      }
      if (channelFilter !== "ALL") {
        if (ch !== channelFilter.toUpperCase()) return false;
      }
      if (minAmountFilter !== "" && amt < Number(minAmountFilter)) return false;
      if (maxAmountFilter !== "" && amt > Number(maxAmountFilter)) return false;
      if (fraudOnlyFilter && !isSusp) return false;

      return true;
    });
  }, [allLedgerTransactions, bankFilter, channelFilter, minAmountFilter, maxAmountFilter, fraudOnlyFilter]);

  // D3 Force Graph payload
  const graphDisplayData = useMemo(() => {
    if (flowGraph && flowGraph.nodes && flowGraph.nodes.length > 0) {
      return {
        nodes: flowGraph.nodes.map((n) => ({
          ...n,
          isTarget: n.id === searchTarget,
        })),
        links: (flowGraph.edges || []).map((e) => ({
          source: e.from,
          target: e.to,
          ...e,
        })),
      };
    }
    if (multiHopTrace && multiHopTrace.nodes && multiHopTrace.nodes.length > 0) {
      return {
        nodes: multiHopTrace.nodes.map((n) => ({
          ...n,
          isTarget: n.id === searchTarget,
        })),
        links: (multiHopTrace.edges || []).map((e) => ({
          source: e.from,
          target: e.to,
          ...e,
        })),
      };
    }
    return { nodes: [], links: [] };
  }, [flowGraph, multiHopTrace, searchTarget]);

  // Calculate volume stats
  const totalVolume = useMemo(() => {
    return filteredTransactions.reduce((acc, t) => acc + Number(t.amount || 0), 0);
  }, [filteredTransactions]);

  const suspiciousCount = useMemo(() => {
    return filteredTransactions.filter(
      (t) => t.isSuspicious || t.is_suspicious || Number(t.amount || 0) >= 9000
    ).length;
  }, [filteredTransactions]);

  return (
    <div className="space-y-6 font-sans">
      {/* 1. TOP HEADER & QUICK PRESET WORKBENCH */}
      <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-teal animate-ping" />
              <h2 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
                <span>🔍</span> FinGraph Multi-Hop Transaction Trace & Fraud Intelligence
              </h2>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Trace full money flow across accounts, banks & channels with real-time graph traversal and ML risk scoring.
            </p>
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-obsidian border border-slate-800 text-xs font-mono">
            <button
              onClick={() => setViewMode("split")}
              className={`px-3 py-1.5 rounded-lg transition ${
                viewMode === "split"
                  ? "bg-teal text-obsidian font-bold shadow-neon-teal"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Split View
            </button>
            <button
              onClick={() => setViewMode("graph")}
              className={`px-3 py-1.5 rounded-lg transition ${
                viewMode === "graph"
                  ? "bg-teal text-obsidian font-bold shadow-neon-teal"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Graph View
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`px-3 py-1.5 rounded-lg transition ${
                viewMode === "table"
                  ? "bg-teal text-obsidian font-bold shadow-neon-teal"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Table View
            </button>
          </div>
        </div>

        {/* Search & Trace Form */}
        <form onSubmit={handleSearchSubmit} className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-2">
          {/* Search Type Selector */}
          <div className="md:col-span-2 space-y-1">
            <label className="text-[10px] font-mono uppercase text-slate-400">Search Entity</label>
            <select
              value={searchType}
              onChange={(e) => setSearchType(e.target.value)}
              className="w-full bg-ink border border-slate-700/80 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-teal"
            >
              <option value="account">Account ID</option>
              <option value="transaction">Transaction ID</option>
            </select>
          </div>

          {/* Target Input */}
          <div className="md:col-span-4 space-y-1">
            <label className="text-[10px] font-mono uppercase text-slate-400">
              {searchType === "account" ? "Target Account ID" : "Transaction ID"}
            </label>
            <div className="relative">
              <input
                type="text"
                value={searchTarget}
                onChange={(e) => setSearchTarget(e.target.value)}
                placeholder={searchType === "account" ? "e.g. SHELL_OFFSHORE_01, A101" : "e.g. TXN001, tx-smurf-001"}
                className="w-full bg-ink border border-slate-700/80 rounded-xl pl-3 pr-8 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-teal"
              />
              {searchTarget && (
                <button
                  type="button"
                  onClick={() => setSearchTarget("")}
                  className="absolute right-2.5 top-2 text-slate-400 hover:text-white text-xs"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Trace Depth (Hops) */}
          <div className="md:col-span-2 space-y-1">
            <label className="text-[10px] font-mono uppercase text-slate-400">Trace Depth</label>
            <select
              value={traceDepth}
              onChange={(e) => setTraceDepth(Number(e.target.value))}
              className="w-full bg-ink border border-slate-700/80 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-teal"
            >
              <option value={1}>1 Hop (Direct)</option>
              <option value={2}>2 Hops (A → B → C)</option>
              <option value={3}>3 Hops</option>
              <option value={4}>4 Hops</option>
              <option value={5}>5 Hops (Deep Chain)</option>
            </select>
          </div>

          {/* Action Buttons */}
          <div className="md:col-span-4 flex items-end gap-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-teal hover:bg-teal-400 text-obsidian font-mono text-xs font-bold py-2 rounded-xl shadow-neon-teal transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <span>{loading ? "⚡ Tracing Money Flow…" : "⚡ Execute Multi-Hop Trace"}</span>
            </button>
          </div>
        </form>

        {/* Quick Demo Presets */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800 text-[11px] font-mono">
          <span className="text-slate-400">Quick Test Syndicates:</span>
          <button
            onClick={() => selectPreset("SHELL_OFFSHORE_01")}
            className="px-2.5 py-1 rounded-lg bg-flare/10 hover:bg-flare/20 text-flare border border-flare/30 transition flex items-center gap-1 font-semibold"
          >
            <span>🚨 Smurfing Starburst Hub (SHELL_OFFSHORE_01)</span>
          </button>
          <button
            onClick={() => selectPreset("CIRCULAR_HUB")}
            className="px-2.5 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 transition flex items-center gap-1 font-semibold"
          >
            <span>🔄 Circular Loop (CIRCULAR_HUB)</span>
          </button>
          <button
            onClick={() => selectPreset("CORP_VAULT_99")}
            className="px-2.5 py-1 rounded-lg bg-gold/10 hover:bg-gold/20 text-gold border border-gold/30 transition flex items-center gap-1 font-semibold"
          >
            <span>⚡ Vault Wire ($75k Anomaly)</span>
          </button>
          <button
            onClick={() => selectPreset("A101")}
            className="px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 transition flex items-center gap-1 font-semibold"
          >
            <span>✓ Retail Account (A101)</span>
          </button>
          <button
            onClick={() => selectPreset("TXN001", "transaction")}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition flex items-center gap-1"
          >
            <span>TXN: TXN001</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-flare/10 border border-flare/30 text-flare text-xs font-mono flex items-center justify-between shadow-neon-flare">
          <span>⚠️ {error}</span>
          <button onClick={() => setError("")} className="font-bold">✕</button>
        </div>
      )}

      {/* 2. ACCOUNT IDENTITY & FRAUD INTELLIGENCE SUMMARY CARD */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Account Details Card */}
        <div className="glass-card p-5 rounded-2xl border border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <span className="text-xs font-mono uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <span>👤</span> Target Account Details
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-teal/10 text-teal border border-teal/30">
              Verified Entity
            </span>
          </div>

          <div className="space-y-2.5 text-xs font-mono">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Account ID:</span>
              <button
                onClick={() => copyToClipboard(accountData?.account?.accountId || searchTarget)}
                className="text-white font-bold hover:text-teal flex items-center gap-1"
              >
                <span>{accountData?.account?.accountId || searchTarget}</span>
                <span className="text-[10px] text-slate-500">
                  {copiedText === (accountData?.account?.accountId || searchTarget) ? "✓" : "📋"}
                </span>
              </button>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Account Holder:</span>
              <span className="text-slate-200 font-medium">{accountData?.account?.name || "Account " + searchTarget}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Bank Name:</span>
              <span className="text-teal font-semibold">{accountData?.account?.bank || "State Bank of India"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Branch:</span>
              <span className="text-slate-300">{accountData?.account?.branch || "Central Commercial Branch"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">IFSC Code:</span>
              <span className="text-amber-300 font-bold">{accountData?.account?.ifscCode || "SBIN0001001"}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-slate-800/80">
              <span className="text-slate-400">Total Volume Flow:</span>
              <span className="text-white font-bold">
                ₹{(accountData?.total_volume || totalVolume).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>

        {/* Fraud Intelligence Engine (Rules & AI Reasoning) */}
        <div className="lg:col-span-2 glass-card p-5 rounded-2xl border border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <span className="text-xs font-mono uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <span>🧠</span> AI Fraud Intelligence & Rule Engine
            </span>
            <div className="flex items-center gap-2 font-mono">
              <span className="text-slate-400 text-xs">Risk Score:</span>
              <span
                className={`px-3 py-1 rounded-xl text-xs font-black ${
                  (fraudAnalysis?.riskScore || 0) >= 75
                    ? "bg-flare text-white shadow-neon-flare"
                    : (fraudAnalysis?.riskScore || 0) >= 40
                    ? "bg-gold text-obsidian font-bold"
                    : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                }`}
              >
                {Math.round(fraudAnalysis?.riskScore || 0)} / 100 ({fraudAnalysis?.riskLevel || "LOW"})
              </span>
            </div>
          </div>

          {/* Flagged Rules Pills */}
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-[11px] font-mono">
              <span className="text-slate-400 flex items-center gap-1 mr-1">Rule Checks:</span>
              {[
                { name: "Smurfing (< ₹10k Split)", rule: "Smurfing", desc: "Small transfers & rapid splitting" },
                { name: "Circular Flow (A→B→C→A)", rule: "Circular Flow", desc: "Cyclic wash loop" },
                { name: "Burst Activity (< 60s)", rule: "Burst Activity", desc: "5+ transfers in under 60 sec" },
                { name: "Layering Pattern", rule: "Layering Pattern", desc: "Multi-hop velocity across banks" },
                { name: "Structuring", rule: "Structuring", desc: "Repeated identical amounts" },
              ].map((item) => {
                const isFlagged = (fraudAnalysis?.suspiciousPatterns || []).some((p) => p.pattern === item.rule);
                return (
                  <span
                    key={item.rule}
                    className={`px-2.5 py-1 rounded-lg border font-bold flex items-center gap-1.5 transition ${
                      isFlagged
                        ? "bg-flare/20 text-flare border-flare/40 shadow-neon-flare"
                        : "bg-obsidian/80 text-slate-500 border-slate-800"
                    }`}
                  >
                    <span>{isFlagged ? "🚨" : "✓"}</span>
                    <span>{item.name}</span>
                  </span>
                );
              })}
            </div>

            {/* AI Narrative Breakdown */}
            <div className="p-3.5 rounded-xl bg-obsidian border border-slate-800/80 space-y-2 font-mono text-xs">
              <div className="text-teal font-bold flex items-center gap-2">
                <span>🤖</span> AI Money Flow Narrative & Risk Analysis:
              </div>
              <p className="text-slate-300 leading-relaxed font-sans text-xs">
                {fraudAnalysis?.aiSummary?.riskAnalysis ||
                  multiHopTrace?.narrative?.summaryText ||
                  "Normal commercial transaction pattern observed. Transaction volumes remain within anticipated baseline."}
              </p>

              {multiHopTrace?.narrative?.flowPath && (
                <div className="pt-2 border-t border-slate-800 flex items-center gap-2 text-[11px] overflow-x-auto">
                  <span className="text-slate-500 uppercase">Flow Path:</span>
                  <span className="text-amber-300 font-bold">{multiHopTrace.narrative.flowPath}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3. FILTER BAR FOR TRANSACTION FLOW */}
      <div className="glass-panel p-4 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-slate-400 font-bold uppercase text-[10px]">Filter Flow:</span>

          {/* Bank Filter */}
          <select
            value={bankFilter}
            onChange={(e) => setBankFilter(e.target.value)}
            className="bg-ink border border-slate-700 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-teal"
          >
            <option value="ALL">All Banks</option>
            <option value="HDFC">HDFC Bank</option>
            <option value="SBI">State Bank of India</option>
            <option value="ICICI">ICICI Bank</option>
            <option value="Axis">Axis Bank</option>
            <option value="Kotak">Kotak Bank</option>
            <option value="Offshore">Offshore / Shell Banks</option>
          </select>

          {/* Channel Filter */}
          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="bg-ink border border-slate-700 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-teal"
          >
            <option value="ALL">All Channels</option>
            <option value="UPI">UPI</option>
            <option value="IMPS">IMPS</option>
            <option value="NEFT">NEFT</option>
            <option value="RTGS">RTGS</option>
            <option value="CARD">Card / Wallet</option>
          </select>

          {/* Amount range */}
          <input
            type="number"
            value={minAmountFilter}
            onChange={(e) => setMinAmountFilter(e.target.value)}
            placeholder="Min ₹"
            className="w-20 bg-ink border border-slate-700 rounded-lg px-2 py-1.5 text-white placeholder-slate-500 focus:outline-none focus:border-teal"
          />
          <span className="text-slate-600">-</span>
          <input
            type="number"
            value={maxAmountFilter}
            onChange={(e) => setMaxAmountFilter(e.target.value)}
            placeholder="Max ₹"
            className="w-20 bg-ink border border-slate-700 rounded-lg px-2 py-1.5 text-white placeholder-slate-500 focus:outline-none focus:border-teal"
          />

          {/* Fraud flag toggle */}
          <button
            type="button"
            onClick={() => setFraudOnlyFilter(!fraudOnlyFilter)}
            className={`px-3 py-1.5 rounded-lg border font-bold transition flex items-center gap-1.5 ${
              fraudOnlyFilter
                ? "bg-flare text-white border-flare shadow-neon-flare"
                : "bg-obsidian text-slate-400 border-slate-700 hover:text-white"
            }`}
          >
            <span>🚨 Suspicious Only ({suspiciousCount})</span>
          </button>
        </div>

        <div className="text-slate-400 text-xs">
          Showing <span className="text-teal font-bold">{filteredTransactions.length}</span> transaction(s) • Total Volume:{" "}
          <span className="text-white font-bold">₹{totalVolume.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
        </div>
      </div>

      {/* 4. MAIN WORKBENCH: GRAPH VIEW & TABLE VIEW */}
      <div className={`grid gap-6 ${viewMode === "split" ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
        {/* GRAPH VIEW */}
        {(viewMode === "split" || viewMode === "graph") && (
          <div className="glass-panel p-4 rounded-2xl border border-slate-800 space-y-3 relative">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <span>🕸️</span> Money Flow Graph (Node = Account, Edge = Transaction)
              </span>
              <span className="text-slate-400 text-[11px]">
                Click Node: Account Details • Click Edge: Tx Popup
              </span>
            </div>

            <div className="h-[460px] rounded-xl overflow-hidden bg-ink/95 border border-slate-800 relative">
              {graphDisplayData.nodes.length > 0 ? (
                <ForceGraph2D
                  ref={graphRef}
                  width={viewMode === "split" ? 560 : 1160}
                  height={460}
                  graphData={graphDisplayData}
                  backgroundColor="#07090E"
                  nodeCanvasObject={(node, ctx, globalScale) => {
                    const isTarget = node.isTarget;
                    const rScore = node.riskScore || 0;
                    const isFraud = rScore >= 70;
                    const color = isTarget ? "#00F2FE" : isFraud ? "#FF385C" : "#10B981";
                    const radius = isTarget ? 14 : isFraud ? 11 : 8;

                    // Concentric pulse for target or fraud
                    if (isTarget || isFraud) {
                      ctx.save();
                      ctx.beginPath();
                      ctx.arc(node.x, node.y, radius + 6, 0, 2 * Math.PI);
                      ctx.fillStyle = isTarget ? "rgba(0, 242, 254, 0.25)" : "rgba(255, 56, 92, 0.3)";
                      ctx.fill();
                      ctx.restore();
                    }

                    // Main Circle
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
                    ctx.fillStyle = color;
                    ctx.shadowColor = color;
                    ctx.shadowBlur = isFraud || isTarget ? 12 : 4;
                    ctx.fill();
                    ctx.lineWidth = 1.5;
                    ctx.strokeStyle = "#FFFFFF";
                    ctx.stroke();
                    ctx.restore();

                    // Label tag
                    ctx.save();
                    const fontSize = Math.max(9 / globalScale, 4.5);
                    ctx.font = `bold ${fontSize}px monospace`;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "top";
                    ctx.fillStyle = "#E2E8F0";
                    ctx.fillText(node.id, node.x, node.y + radius + 3);
                    ctx.restore();
                  }}
                  linkCanvasObject={(link, ctx, globalScale) => {
                    const src = link.source;
                    const tgt = link.target;
                    if (!src || !tgt || src.x === undefined || tgt.x === undefined) return;

                    const amt = Number(link.amount || 0);
                    const isSuspicious = link.isSuspicious || amt >= 9000;
                    const color = isSuspicious ? "#FF385C" : "#334155";

                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(src.x, src.y);
                    ctx.lineTo(tgt.x, tgt.y);
                    ctx.strokeStyle = color;
                    ctx.lineWidth = isSuspicious ? 2.5 : 1.2;
                    ctx.stroke();

                    // Amount Badge on edge
                    if (globalScale > 0.8) {
                      const mx = (src.x + tgt.x) / 2;
                      const my = (src.y + tgt.y) / 2;
                      const badgeText = `₹${amt >= 1000 ? (amt / 1000).toFixed(1) + "k" : amt}`;
                      const fontSize = Math.max(8 / globalScale, 3.8);
                      ctx.font = `bold ${fontSize}px monospace`;
                      const bw = ctx.measureText(badgeText).width + 6;
                      ctx.fillStyle = "rgba(10, 12, 18, 0.9)";
                      ctx.fillRect(mx - bw / 2, my - fontSize / 2 - 2, bw, fontSize + 4);
                      ctx.fillStyle = isSuspicious ? "#FFB800" : "#94A3B8";
                      ctx.textAlign = "center";
                      ctx.textBaseline = "middle";
                      ctx.fillText(badgeText, mx, my);
                    }
                    ctx.restore();
                  }}
                  linkDirectionalParticles={4}
                  linkDirectionalParticleSpeed={0.008}
                  linkDirectionalParticleColor={(l) => (l.isSuspicious || l.amount >= 9000 ? "#FF385C" : "#00F2FE")}
                  linkDirectionalParticleWidth={3}
                  onNodeClick={(node) => {
                    setInspectingNode(node);
                    setInspectingEdge(null);
                  }}
                  onLinkClick={(link) => {
                    setInspectingEdge(link);
                    setInspectingNode(null);
                  }}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-slate-500 font-mono text-xs">
                  Enter target account or transaction ID to render graph
                </div>
              )}

              {/* Node Inspection Drawer Popup */}
              {inspectingNode && (
                <div className="absolute top-4 right-4 z-30 p-4 rounded-xl bg-obsidian/95 border border-teal/40 backdrop-blur-md shadow-2xl font-mono text-xs max-w-xs space-y-2.5 animate-fade-in">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="text-teal font-extrabold">{inspectingNode.id}</span>
                    <button onClick={() => setInspectingNode(null)} className="text-slate-400 hover:text-white">✕</button>
                  </div>
                  <div className="space-y-1 text-slate-300 text-[11px]">
                    <div><span className="text-slate-500">Name:</span> {inspectingNode.name}</div>
                    <div><span className="text-slate-500">Bank:</span> {inspectingNode.bank}</div>
                    <div><span className="text-slate-500">Branch:</span> {inspectingNode.branch || "Commercial Hub"}</div>
                    <div><span className="text-slate-500">IFSC:</span> {inspectingNode.ifsc || "HDFC0001234"}</div>
                    <div className="flex justify-between pt-1 border-t border-slate-800">
                      <span className="text-slate-500">Risk Score:</span>
                      <span className="text-flare font-bold">{Math.round(inspectingNode.riskScore || 0)}%</span>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      selectPreset(inspectingNode.id);
                      setInspectingNode(null);
                    }}
                    className="w-full py-1.5 bg-teal hover:bg-teal-400 text-obsidian font-bold rounded-lg transition"
                  >
                    Center Flow on This Node
                  </button>
                </div>
              )}

              {/* Edge Inspection Drawer Popup */}
              {inspectingEdge && (
                <div className="absolute bottom-4 left-4 z-30 p-4 rounded-xl bg-obsidian/95 border border-flare/40 backdrop-blur-md shadow-2xl font-mono text-xs max-w-sm space-y-2.5 animate-fade-in">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="text-flare font-extrabold flex items-center gap-1.5">
                      <span>💸</span> Transaction Details
                    </span>
                    <button onClick={() => setInspectingEdge(null)} className="text-slate-400 hover:text-white">✕</button>
                  </div>
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Tx ID:</span>
                      <span className="text-white font-bold">{inspectingEdge.transactionId || inspectingEdge.txId}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">From Account:</span>
                      <span className="text-teal">{inspectingEdge.from || inspectingEdge.source?.id}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Sender Bank:</span>
                      <span className="text-slate-300">{inspectingEdge.bankFrom || "State Bank of India"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">To Account:</span>
                      <span className="text-cyan-300">{inspectingEdge.to || inspectingEdge.target?.id}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Receiver Bank:</span>
                      <span className="text-slate-300">{inspectingEdge.bankTo || "HDFC Bank"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Amount:</span>
                      <span className="text-emerald-400 font-bold">₹{Number(inspectingEdge.amount || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Channel Mode:</span>
                      <span className="text-amber-300 font-bold">{inspectingEdge.channel || "UPI"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Timestamp:</span>
                      <span className="text-slate-300">{inspectingEdge.timestamp}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 5. STRUCTURED TABLE VIEW */}
        {(viewMode === "split" || viewMode === "table") && (
          <div className="glass-panel p-4 rounded-2xl border border-slate-800 space-y-3 flex flex-col">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <span>📋</span> Transaction Flow Table ({filteredTransactions.length})
              </span>
              <span className="text-slate-400 text-[11px]">
                Sender & Receiver Bank-level Details + Mode
              </span>
            </div>

            <div className="flex-1 overflow-x-auto max-h-[460px] rounded-xl border border-slate-800 bg-obsidian">
              <table className="w-full text-left font-mono text-xs">
                <thead className="sticky top-0 bg-panel border-b border-slate-800 text-slate-400 text-[11px] uppercase">
                  <tr>
                    <th className="py-2.5 px-3">Tx ID</th>
                    <th className="py-2.5 px-3">Sender</th>
                    <th className="py-2.5 px-3">Sender Bank</th>
                    <th className="py-2.5 px-3">Receiver</th>
                    <th className="py-2.5 px-3">Receiver Bank</th>
                    <th className="py-2.5 px-3 text-right">Amount (₹)</th>
                    <th className="py-2.5 px-3 text-center">Channel</th>
                    <th className="py-2.5 px-3">Timestamp</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-200">
                  {filteredTransactions.length > 0 ? (
                    filteredTransactions.map((tx, idx) => {
                      const txId = tx.transactionId || tx.transaction_id || tx.id || `TXN_${idx}`;
                      const fromAcc = tx.from || tx.from_account || tx.sender;
                      const toAcc = tx.to || tx.to_account || tx.receiver;
                      const bankFrom = tx.bankFrom || tx.from_bank || "State Bank of India";
                      const bankTo = tx.bankTo || tx.to_bank || "HDFC Bank";
                      const amt = Number(tx.amount || 0);
                      const channel = tx.channel || tx.mode || "UPI";
                      const isSusp = tx.isSuspicious || tx.is_suspicious || amt >= 10000 || (9000 <= amt && amt < 10000);

                      return (
                        <tr key={txId + idx} className="hover:bg-panelHover transition">
                          <td className="py-2.5 px-3">
                            <button
                              onClick={() => copyToClipboard(txId)}
                              className="text-slate-400 hover:text-teal font-mono text-[11px] flex items-center gap-1 group"
                            >
                              <span>{txId.slice(0, 10)}…</span>
                              <span className="text-[9px] text-slate-500 group-hover:text-teal">
                                {copiedText === txId ? "✓" : "📋"}
                              </span>
                            </button>
                          </td>
                          <td className="py-2.5 px-3">
                            <button
                              onClick={() => selectPreset(fromAcc)}
                              className="text-teal hover:underline font-bold"
                            >
                              {fromAcc}
                            </button>
                          </td>
                          <td className="py-2.5 px-3 text-slate-300">{bankFrom}</td>
                          <td className="py-2.5 px-3">
                            <button
                              onClick={() => selectPreset(toAcc)}
                              className="text-cyan-300 hover:underline font-bold"
                            >
                              {toAcc}
                            </button>
                          </td>
                          <td className="py-2.5 px-3 text-slate-300">{bankTo}</td>
                          <td className="py-2.5 px-3 text-right font-black text-white">
                            ₹{amt.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-300 border border-amber-500/30">
                              {channel}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-400 text-[11px]">
                            {tx.timestamp ? tx.timestamp.slice(0, 19).replace("T", " ") : "2026-09-02 10:15"}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {isSusp ? (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-flare/20 text-flare border border-flare/30">
                                🚨 SUSPICIOUS
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                                CLEAN
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-500 font-mono text-xs">
                        No transactions found matching current filter criteria.
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
