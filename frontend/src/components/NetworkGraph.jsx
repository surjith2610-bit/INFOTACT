import { useMemo, useRef, useState, useCallback } from "react";
import ForceGraph2D from "react-force-graph-2d";

export default function NetworkGraph({
  data,
  flaggedIds = new Set(),
  height = 540,
  onNodeSelect,
  selectedNodeId,
}) {
  const fgRef = useRef();
  const [filterMode, setFilterMode] = useState("ALL"); // "ALL" | "STARBURST" | "CIRCULAR" | "HIGH_RISK"
  const [enableParticles, setEnableParticles] = useState(true);

  // Compute node degrees & transaction volume metrics
  const { graphData, nodeMetrics } = useMemo(() => {
    if (!data || !data.nodes) return { graphData: { nodes: [], links: [] }, nodeMetrics: {} };

    const metrics = {};
    data.nodes.forEach((n) => {
      metrics[n.id] = { inDegree: 0, outDegree: 0, totalAmount: 0, risk: n.risk || 0 };
    });

    data.links.forEach((l) => {
      const srcId = typeof l.source === "object" ? l.source.id : l.source;
      const tgtId = typeof l.target === "object" ? l.target.id : l.target;
      const amt = Number(l.amount) || 0;

      if (!metrics[srcId]) metrics[srcId] = { inDegree: 0, outDegree: 0, totalAmount: 0, risk: 0 };
      if (!metrics[tgtId]) metrics[tgtId] = { inDegree: 0, outDegree: 0, totalAmount: 0, risk: 0 };

      metrics[srcId].outDegree += 1;
      metrics[srcId].totalAmount += amt;
      metrics[tgtId].inDegree += 1;
      metrics[tgtId].totalAmount += amt;
    });

    // Apply Pattern Filters
    let filteredNodes = data.nodes;
    if (filterMode === "STARBURST") {
      // Hub receiving from >= 4 senders or sending to >= 4 receivers
      filteredNodes = data.nodes.filter((n) => {
        const m = metrics[n.id];
        return m && (m.inDegree >= 3 || m.outDegree >= 3);
      });
    } else if (filterMode === "CIRCULAR") {
      // Nodes in active loops or flagged circular
      filteredNodes = data.nodes.filter((n) => flaggedIds.has(n.id) || (metrics[n.id] && metrics[n.id].inDegree > 0 && metrics[n.id].outDegree > 0));
    } else if (filterMode === "HIGH_RISK") {
      filteredNodes = data.nodes.filter((n) => (n.risk && n.risk >= 40) || flaggedIds.has(n.id));
    }

    const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredLinks = data.links.filter((l) => {
      const srcId = typeof l.source === "object" ? l.source.id : l.source;
      const tgtId = typeof l.target === "object" ? l.target.id : l.target;
      return filteredNodeIds.has(srcId) && filteredNodeIds.has(tgtId);
    });

    return {
      graphData: {
        nodes: filteredNodes.map((n) => ({ ...n })),
        links: filteredLinks.map((l) => ({ ...l })),
      },
      nodeMetrics: metrics,
    };
  }, [data, filterMode, flaggedIds]);

  // Color mapping based on risk score (0 - 100)
  const getNodeColor = useCallback((node) => {
    if (selectedNodeId === node.id) return "#38BDF8"; // Bright Cyan highlight
    if (flaggedIds.has(node.id)) return "#EF4444"; // Crimson Red
    
    const risk = node.risk !== undefined ? (node.risk > 1 ? node.risk : node.risk * 100) : 0;
    if (risk >= 70) return "#EF4444"; // Red
    if (risk >= 40) return "#F59E0B"; // Amber
    if (risk >= 20) return "#10B981"; // Emerald
    return "#14B8A6"; // Teal
  }, [flaggedIds, selectedNodeId]);

  // Size node proportional to volume/degree
  const getNodeVal = useCallback((node) => {
    const m = nodeMetrics[node.id];
    if (!m) return 4;
    const degree = m.inDegree + m.outDegree;
    return Math.min(25, 4 + degree * 2.5 + Math.log10(m.totalAmount + 1) * 1.5);
  }, [nodeMetrics]);

  const handleZoomReset = () => {
    if (fgRef.current) {
      fgRef.current.zoomToFit(400, 20);
    }
  };

  const handleZoomIn = () => {
    if (fgRef.current) {
      fgRef.current.zoom(fgRef.current.zoom() * 1.3, 300);
    }
  };

  const handleZoomOut = () => {
    if (fgRef.current) {
      fgRef.current.zoom(fgRef.current.zoom() / 1.3, 300);
    }
  };

  if (!data || !data.nodes || data.nodes.length === 0) {
    return (
      <div className="h-[540px] flex flex-col items-center justify-center border border-dashed border-slate-800 rounded-xl bg-slate-950/60 text-slate-400 font-mono text-sm gap-3">
        <svg className="w-10 h-10 text-teal-400/60 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <span>No Graph Data Available — Stream or Ingest Transactions to Visualize Network topology.</span>
      </div>
    );
  }

  return (
    <div className="relative border border-slate-800/80 rounded-xl overflow-hidden bg-slate-950 shadow-2xl">
      {/* Top Interactive Controls Toolbar */}
      <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-2 bg-slate-900/90 backdrop-blur border border-slate-800 p-1.5 rounded-lg shadow-lg text-xs font-mono">
        <span className="text-slate-400 px-2 font-semibold">Pattern Filter:</span>
        <button
          onClick={() => setFilterMode("ALL")}
          className={`px-2.5 py-1 rounded font-medium transition ${
            filterMode === "ALL" ? "bg-teal-500 text-slate-950 font-bold" : "text-slate-300 hover:bg-slate-800"
          }`}
        >
          All ({data.nodes.length})
        </button>
        <button
          onClick={() => setFilterMode("STARBURST")}
          className={`px-2.5 py-1 rounded font-medium transition ${
            filterMode === "STARBURST" ? "bg-amber-500 text-slate-950 font-bold" : "text-slate-300 hover:bg-slate-800"
          }`}
        >
          ⚡ Starburst Hubs
        </button>
        <button
          onClick={() => setFilterMode("CIRCULAR")}
          className={`px-2.5 py-1 rounded font-medium transition ${
            filterMode === "CIRCULAR" ? "bg-red-500 text-white font-bold" : "text-slate-300 hover:bg-slate-800"
          }`}
        >
          🔄 Circular Loops
        </button>
        <button
          onClick={() => setFilterMode("HIGH_RISK")}
          className={`px-2.5 py-1 rounded font-medium transition ${
            filterMode === "HIGH_RISK" ? "bg-rose-600 text-white font-bold" : "text-slate-300 hover:bg-slate-800"
          }`}
        >
          🚨 High Risk ({flaggedIds.size})
        </button>
      </div>

      {/* Right Zoom & View Toolbar */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 bg-slate-900/90 backdrop-blur border border-slate-800 p-1 rounded-lg shadow-lg text-xs">
        <button
          onClick={handleZoomIn}
          title="Zoom In"
          className="w-7 h-7 flex items-center justify-center text-slate-300 hover:bg-slate-800 rounded font-bold"
        >
          +
        </button>
        <button
          onClick={handleZoomOut}
          title="Zoom Out"
          className="w-7 h-7 flex items-center justify-center text-slate-300 hover:bg-slate-800 rounded font-bold"
        >
          –
        </button>
        <button
          onClick={handleZoomReset}
          title="Reset Zoom"
          className="px-2 h-7 flex items-center justify-center text-slate-300 hover:bg-slate-800 rounded font-mono font-semibold"
        >
          Reset
        </button>
        <button
          onClick={() => setEnableParticles(!enableParticles)}
          title="Toggle Flow Animation"
          className={`px-2 h-7 flex items-center justify-center rounded font-mono transition ${
            enableParticles ? "bg-teal-500/20 text-teal-400 border border-teal-500/40" : "text-slate-400 hover:bg-slate-800"
          }`}
        >
          {enableParticles ? "Flow: ON" : "Flow: OFF"}
        </button>
      </div>

      {/* Force-Directed Graph Canvas */}
      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        height={height}
        backgroundColor="#030712"
        nodeVal={getNodeVal}
        nodeColor={getNodeColor}
        nodeLabel={(n) => {
          const m = nodeMetrics[n.id] || {};
          const riskVal = n.risk !== undefined ? (n.risk > 1 ? n.risk : n.risk * 100).toFixed(1) : "0.0";
          return `
            <div style="background: rgba(15,23,42,0.95); border: 1px solid rgba(51,65,85,0.8); padding: 8px 12px; border-radius: 6px; font-family: monospace; color: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">
              <div style="font-weight: bold; color: #38BDF8; font-size: 13px;">${n.id}</div>
              <div style="color: ${riskVal > 60 ? '#EF4444' : riskVal > 30 ? '#F59E0B' : '#10B981'}; font-weight: 600; margin-top: 2px;">
                Risk Score: ${riskVal} / 100
              </div>
              <div style="font-size: 11px; color: #94A3B8; margin-top: 4px;">
                Inbound: ${m.inDegree || 0} | Outbound: ${m.outDegree || 0}
              </div>
              <div style="font-size: 11px; color: #34D399; margin-top: 2px;">
                Total Volume: $${(m.totalAmount || 0).toLocaleString()}
              </div>
            </div>
          `;
        }}
        linkColor={(l) => {
          const amt = Number(l.amount) || 0;
          if (amt >= 10000) return "rgba(239, 68, 68, 0.6)"; // Red line for large transactions
          if (amt >= 5000) return "rgba(245, 158, 11, 0.5)"; // Amber line
          return "rgba(51, 65, 85, 0.4)"; // Slate default
        }}
        linkWidth={(l) => Math.max(1, Math.min(5, (Number(l.amount) || 1000) / 2500))}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={0.9}
        linkDirectionalParticles={enableParticles ? 2 : 0}
        linkDirectionalParticleWidth={1.5}
        linkDirectionalParticleSpeed={0.005}
        linkDirectionalParticleColor={(l) => (Number(l.amount) >= 10000 ? "#EF4444" : "#2DD9C4")}
        onNodeClick={(node) => {
          if (onNodeSelect) onNodeSelect(node.id);
        }}
        cooldownTicks={100}
      />

      {/* Bottom Legend Overlay */}
      <div className="absolute bottom-3 left-3 right-3 z-10 flex items-center justify-between bg-slate-900/80 backdrop-blur border border-slate-800/80 px-4 py-2 rounded-lg text-xs font-mono text-slate-300">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Low Risk (0-30)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> Medium (30-70)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block animate-pulse" /> Flagged / High (70-100)
          </span>
        </div>
        <div className="text-slate-400 font-sans">
          Click any account node to inspect full AI fraud chain & counterparty subgraph.
        </div>
      </div>
    </div>
  );
}
