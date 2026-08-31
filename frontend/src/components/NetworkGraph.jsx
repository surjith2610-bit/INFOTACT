import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import ForceGraph2D from "react-force-graph-2d";

export default function NetworkGraph({
  data,
  flaggedIds = new Set(),
  height = 560,
  onNodeSelect,
  selectedNodeId,
}) {
  const fgRef = useRef();
  const [filterMode, setFilterMode] = useState("ALL"); // "ALL" | "STARBURST" | "CIRCULAR" | "HIGH_RISK"
  const [enableParticles, setEnableParticles] = useState(true);
  const [hoveredNode, setHoveredNode] = useState(null);

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
      // Hub receiving from >= 3 senders or sending to >= 3 receivers
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
    const filteredLinks = (data.links || []).filter((l) => {
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

  // Center & zoom on load
  useEffect(() => {
    if (fgRef.current && graphData.nodes.length > 0) {
      setTimeout(() => {
        fgRef.current.zoomToFit(400, 30);
      }, 500);
    }
  }, [graphData.nodes.length]);

  // Node coloring
  const getNodeColor = useCallback((node) => {
    if (selectedNodeId === node.id) return "#00F2FE"; // Bright neon cyan
    if (flaggedIds.has(node.id)) return "#FF385C";   // Neon flare red
    
    const risk = node.risk !== undefined ? (node.risk > 1 ? node.risk : node.risk * 100) : 0;
    if (risk >= 70) return "#FF385C"; // Red -> Fraud
    if (risk >= 35) return "#FBBF24"; // Gold -> Suspicious
    return "#10B981"; // Emerald -> Normal
  }, [flaggedIds, selectedNodeId]);

  // Custom node canvas renderer for high visual aesthetics
  const drawNode = useCallback((node, ctx, globalScale) => {
    const isSelected = selectedNodeId === node.id;
    const isHovered = hoveredNode?.id === node.id;
    const isFlagged = flaggedIds.has(node.id);
    const color = getNodeColor(node);

    const m = nodeMetrics[node.id];
    const degree = m ? m.inDegree + m.outDegree : 0;
    const r = Math.max(4, Math.min(18, 4 + degree * 1.5));

    // Outer glow halo for flagged/selected nodes
    if (isFlagged || isSelected || isHovered) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + (isSelected ? 6 : 4), 0, 2 * Math.PI, false);
      ctx.fillStyle = isSelected ? "rgba(0, 242, 254, 0.25)" : "rgba(255, 56, 92, 0.25)";
      ctx.fill();
      ctx.restore();
    }

    // Main Node Circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = isFlagged || isSelected ? 12 : 4;
    ctx.fill();
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.strokeStyle = isSelected ? "#FFFFFF" : "rgba(255, 255, 255, 0.6)";
    ctx.stroke();
    ctx.restore();

    // Node Label on high zoom, hover, or flagged status
    if (globalScale > 1.4 || isHovered || isSelected || isFlagged) {
      const label = node.id || "Acc";
      const fontSize = Math.max(10 / globalScale, 3);
      ctx.font = `600 ${fontSize}px 'JetBrains Mono', monospace`;
      const textWidth = ctx.measureText(label).width;
      const bckgDimensions = [textWidth + 4, fontSize + 2];

      ctx.fillStyle = "rgba(7, 9, 14, 0.85)";
      ctx.fillRect(
        node.x - bckgDimensions[0] / 2,
        node.y + r + 2,
        bckgDimensions[0],
        bckgDimensions[1]
      );

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = isSelected ? "#00F2FE" : isFlagged ? "#FF8599" : "#E2E8F0";
      ctx.fillText(label, node.x, node.y + r + 2 + bckgDimensions[1] / 2);
    }
  }, [selectedNodeId, hoveredNode, flaggedIds, getNodeColor, nodeMetrics]);

  const handleZoomFit = () => {
    if (fgRef.current) fgRef.current.zoomToFit(400, 30);
  };

  const handleZoomIn = () => {
    if (fgRef.current) fgRef.current.zoom(fgRef.current.zoom() * 1.35, 300);
  };

  const handleZoomOut = () => {
    if (fgRef.current) fgRef.current.zoom(fgRef.current.zoom() / 1.35, 300);
  };

  return (
    <div className="relative rounded-2xl overflow-hidden glass-panel border border-slate-800/80 shadow-2xl transition-all duration-300">
      {/* Floating HUD Header / Filter Toolbar */}
      <div className="absolute top-4 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-3 pointer-events-none">
        {/* Left: Quick Pattern Filter Chips */}
        <div className="flex items-center gap-1.5 p-1.5 rounded-xl bg-obsidian/85 backdrop-blur-md border border-slate-800 pointer-events-auto shadow-lg">
          <button
            onClick={() => setFilterMode("ALL")}
            className={`px-3 py-1 rounded-lg text-xs font-mono font-medium transition-all ${
              filterMode === "ALL"
                ? "bg-teal text-obsidian font-bold shadow-neon-teal"
                : "text-slate-400 hover:text-white hover:bg-slate-800/60"
            }`}
          >
            All Nodes ({graphData.nodes.length})
          </button>
          <button
            onClick={() => setFilterMode("STARBURST")}
            className={`px-3 py-1 rounded-lg text-xs font-mono font-medium transition-all flex items-center gap-1.5 ${
              filterMode === "STARBURST"
                ? "bg-teal text-obsidian font-bold shadow-neon-teal"
                : "text-slate-400 hover:text-white hover:bg-slate-800/60"
            }`}
          >
            <span>💥</span> Starburst Hubs
          </button>
          <button
            onClick={() => setFilterMode("CIRCULAR")}
            className={`px-3 py-1 rounded-lg text-xs font-mono font-medium transition-all flex items-center gap-1.5 ${
              filterMode === "CIRCULAR"
                ? "bg-teal text-obsidian font-bold shadow-neon-teal"
                : "text-slate-400 hover:text-white hover:bg-slate-800/60"
            }`}
          >
            <span>🔄</span> Circular Loops
          </button>
          <button
            onClick={() => setFilterMode("HIGH_RISK")}
            className={`px-3 py-1 rounded-lg text-xs font-mono font-medium transition-all flex items-center gap-1.5 ${
              filterMode === "HIGH_RISK"
                ? "bg-flare text-white font-bold shadow-neon-flare"
                : "text-slate-400 hover:text-white hover:bg-slate-800/60"
            }`}
          >
            <span>🚨</span> High Risk
          </button>
        </div>

        {/* Right: Interactive Camera Controls */}
        <div className="flex items-center gap-2 p-1.5 rounded-xl bg-obsidian/85 backdrop-blur-md border border-slate-800 pointer-events-auto shadow-lg">
          <button
            onClick={() => setEnableParticles((p) => !p)}
            className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all flex items-center gap-1.5 ${
              enableParticles
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "text-slate-500 hover:text-slate-300"
            }`}
            title="Toggle Money Flow Particles"
          >
            <span>{enableParticles ? "⚡ Particles ON" : "⚪ Particles OFF"}</span>
          </button>
          <button
            onClick={handleZoomIn}
            className="p-1.5 px-2.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 font-mono text-sm"
            title="Zoom In"
          >
            +
          </button>
          <button
            onClick={handleZoomOut}
            className="p-1.5 px-2.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 font-mono text-sm"
            title="Zoom Out"
          >
            −
          </button>
          <button
            onClick={handleZoomFit}
            className="px-2.5 py-1 rounded-lg text-xs font-mono text-teal-400 hover:bg-teal-500/10 border border-teal-500/30 transition-all"
            title="Reset View"
          >
            Fit View
          </button>
        </div>
      </div>

      {/* Force Graph Interactive Area */}
      <div className="w-full relative bg-ink/90">
        <ForceGraph2D
          ref={fgRef}
          width={window.innerWidth > 1200 ? 1200 : window.innerWidth - 48}
          height={height}
          graphData={graphData}
          backgroundColor="#07090E"
          nodeCanvasObject={drawNode}
          nodePointerAreaPaint={(node, color, ctx) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(node.x, node.y, 14, 0, 2 * Math.PI, false);
            ctx.fill();
          }}
          linkColor={() => "rgba(51, 65, 85, 0.45)"}
          linkWidth={(link) => Math.min(3.5, 0.8 + Math.log10((Number(link.amount) || 100) / 100))}
          linkDirectionalParticles={enableParticles ? 3 : 0}
          linkDirectionalParticleWidth={2.5}
          linkDirectionalParticleSpeed={(d) => 0.004 + (Math.min(Number(d.amount) || 500, 10000) / 50000) * 0.01}
          linkDirectionalParticleColor={(link) => {
            const isSuspicious = Number(link.amount) > 10000 || link.is_suspicious;
            return isSuspicious ? "#FF385C" : "#00F2FE";
          }}
          onNodeHover={(node) => setHoveredNode(node || null)}
          onNodeClick={(node) => {
            if (onNodeSelect && node) onNodeSelect(node.id);
          }}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
        />
      </div>

      {/* Dynamic Hover Tooltip HUD card */}
      {hoveredNode && (
        <div className="absolute bottom-4 left-4 z-30 p-3.5 rounded-xl bg-obsidian/95 backdrop-blur-md border border-slate-700/80 shadow-2xl font-mono text-xs max-w-xs animate-fade-in pointer-events-none">
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <span className="text-teal font-bold tracking-wide">{hoveredNode.id}</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
              flaggedIds.has(hoveredNode.id) || (hoveredNode.risk && hoveredNode.risk >= 70)
                ? "bg-flare/20 text-flare border border-flare/30"
                : hoveredNode.risk >= 35
                ? "bg-gold/20 text-gold border border-gold/30"
                : "bg-emerald/20 text-emerald-400 border border-emerald/30"
            }`}>
              Risk: {hoveredNode.risk ? Math.round(hoveredNode.risk > 1 ? hoveredNode.risk : hoveredNode.risk * 100) : 0}%
            </span>
          </div>
          <div className="space-y-1 text-slate-300 text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-400">Account Type:</span>
              <span className="text-white font-medium">{hoveredNode.type || "Checking"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Inbound Transfers:</span>
              <span className="text-emerald-400 font-semibold">{nodeMetrics[hoveredNode.id]?.inDegree || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Outbound Transfers:</span>
              <span className="text-cyan-400 font-semibold">{nodeMetrics[hoveredNode.id]?.outDegree || 0}</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-slate-800">
              <span className="text-slate-400">Total Volume:</span>
              <span className="text-teal font-bold">
                ${(nodeMetrics[hoveredNode.id]?.totalAmount || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-slate-400 text-center font-sans">
            Click node to open Investigation Workbench
          </div>
        </div>
      )}

      {/* Visual Graph Legend Footer */}
      <div className="p-3.5 bg-obsidian/95 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
            <span className="text-slate-300">Clean Account</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-gold shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
            <span className="text-slate-300">Suspicious Velocity</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-flare shadow-[0_0_10px_rgba(255,56,92,0.8)] animate-pulse" />
            <span className="text-slate-300 font-bold">Flagged Syndicate Ring</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-teal shadow-[0_0_8px_rgba(0,242,254,0.8)]" />
            <span className="text-slate-300">Selected Target</span>
          </div>
        </div>
        <div className="text-slate-400 text-[11px] font-sans">
          ⚡ GPU Particle Acceleration Enabled • Live Cypher Topology
        </div>
      </div>
    </div>
  );
}
