import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { formatINR, formatCompactINR } from "../utils/currency.js";

export default function NetworkGraph({
  data,
  flaggedIds = new Set(),
  height = 580,
  onNodeSelect,
  selectedNodeId,
  themeMode = "dark",
  onCreateCase,
}) {
  const fgRef = useRef();
  const [filterMode, setFilterMode] = useState("ALL"); // "ALL" | "STARBURST" | "CIRCULAR" | "LAYERING" | "HIGH_RISK"
  const [enableParticles, setEnableParticles] = useState(true);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [hoveredLink, setHoveredLink] = useState(null);
  const [pulseTime, setPulseTime] = useState(0);
  const [drilldownNode, setDrilldownNode] = useState(null);

  // Animation frame loop for radar pulsing glow on fraud nodes
  useEffect(() => {
    let animId;
    const updatePulse = () => {
      setPulseTime((Date.now() / 600) % (Math.PI * 2));
      animId = requestAnimationFrame(updatePulse);
    };
    animId = requestAnimationFrame(updatePulse);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Compute node degrees, transaction volume metrics & fraud classification
  const { graphData, nodeMetrics, fraudSyndicates } = useMemo(() => {
    if (!data || !data.nodes) return { graphData: { nodes: [], links: [] }, nodeMetrics: {}, fraudSyndicates: {} };

    const metrics = {};
    data.nodes.forEach((n) => {
      const riskVal = n.risk !== undefined ? (n.risk > 1 ? n.risk : n.risk * 100) : 0;
      metrics[n.id] = {
        inDegree: 0,
        outDegree: 0,
        totalAmount: 0,
        risk: riskVal,
        role: n.role || (riskVal >= 70 ? "Flagged Suspect" : "Clean Account"),
        isFraud: riskVal >= 70 || flaggedIds.has(n.id) || Boolean(n.is_fraud),
        location: n.location || "Mumbai, India",
        entityTag: n.entityTag || (n.id.includes("SHELL") ? "OFFSHORE_SHELL" : (n.id.includes("SMURF") ? "MULE_ACCOUNT" : "RETAIL")),
      };
    });

    data.links.forEach((l) => {
      const srcId = typeof l.source === "object" ? l.source.id : l.source;
      const tgtId = typeof l.target === "object" ? l.target.id : l.target;
      const amt = Number(l.amount) || 0;

      if (!metrics[srcId]) metrics[srcId] = { inDegree: 0, outDegree: 0, totalAmount: 0, risk: 0, role: "Clean Account", isFraud: false, location: "Mumbai, India", entityTag: "RETAIL" };
      if (!metrics[tgtId]) metrics[tgtId] = { inDegree: 0, outDegree: 0, totalAmount: 0, risk: 0, role: "Clean Account", isFraud: false, location: "Mumbai, India", entityTag: "RETAIL" };

      metrics[srcId].outDegree += 1;
      metrics[srcId].totalAmount += amt;
      metrics[tgtId].inDegree += 1;
      metrics[tgtId].totalAmount += amt;
    });

    // Detect explicit fraud syndicate clusters for quick 1-click camera focus
    const syndicates = {
      smurfing: { hub: "SHELL_OFFSHORE_01", nodes: [], totalAmount: 8175500 },
      largeWire: { hub: "OFFSHORE_PRIV_88", source: "CORP_VAULT_99", amount: 6225000 },
      circular: { nodes: ["ACC0001", "CIRCULAR_HUB", "ACC0005"] },
    };

    data.nodes.forEach((n) => {
      const idUpper = (n.id || "").toUpperCase();
      if (idUpper.startsWith("SMURF") || idUpper.includes("SHELL")) {
        syndicates.smurfing.nodes.push(n.id);
      }
    });

    // Apply Pattern Filters
    let filteredNodes = data.nodes;
    if (filterMode === "STARBURST") {
      filteredNodes = data.nodes.filter((n) => {
        const idU = (n.id || "").toUpperCase();
        const m = metrics[n.id];
        return idU.includes("SHELL") || idU.includes("SMURF") || (m && (m.inDegree >= 3 || m.outDegree >= 3));
      });
    } else if (filterMode === "CIRCULAR") {
      filteredNodes = data.nodes.filter((n) => {
        const idU = (n.id || "").toUpperCase();
        return idU.includes("CIRCULAR") || ["ACC0001", "ACC0005", "ACC0004"].includes(n.id);
      });
    } else if (filterMode === "LAYERING") {
      filteredNodes = data.nodes.filter((n) => {
        const idU = (n.id || "").toUpperCase();
        return idU.includes("VAULT") || idU.includes("OFFSHORE") || idU.includes("CORP");
      });
    } else if (filterMode === "HIGH_RISK") {
      filteredNodes = data.nodes.filter((n) => {
        const m = metrics[n.id];
        return (m && m.risk >= 50) || flaggedIds.has(n.id) || n.is_fraud;
      });
    }

    const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredLinks = (data.links || []).filter((l) => {
      const srcId = typeof l.source === "object" ? l.source.id : l.source;
      const tgtId = typeof l.target === "object" ? l.target.id : l.target;
      return filteredNodeIds.has(srcId) && filteredNodeIds.has(tgtId);
    });

    return {
      graphData: { nodes: filteredNodes, links: filteredLinks },
      nodeMetrics: metrics,
    };
  }, [data, flaggedIds, filterMode]);

  const handleNodeClick = useCallback(
    (node) => {
      setDrilldownNode(node);
      if (onNodeSelect) onNodeSelect(node.id);
      if (fgRef.current && node.x !== undefined && node.y !== undefined) {
        fgRef.current.centerAt(node.x, node.y, 800);
        fgRef.current.zoom(2.5, 800);
      }
    },
    [onNodeSelect]
  );

  const focusOnSyndicate = (type) => {
    setFilterMode(type);
    setTimeout(() => {
      if (fgRef.current) {
        fgRef.current.zoomToFit(600, 50);
      }
    }, 150);
  };

  const paintNode = useCallback(
    (node, ctx, globalScale) => {
      const m = nodeMetrics[node.id] || { risk: 0, isFraud: false };
      const isSelected = selectedNodeId === node.id || (drilldownNode && drilldownNode.id === node.id);
      const isHovered = hoveredNode && hoveredNode.id === node.id;
      const isFraud = m.isFraud || m.risk >= 70;

      const baseRadius = Math.max(5, Math.min(16, 5 + Math.sqrt((m.inDegree + m.outDegree) * 2)));
      const radius = isSelected || isHovered ? baseRadius * 1.3 : baseRadius;

      let nodeColor = "#10B981";
      let glowColor = "rgba(16, 185, 129, 0.4)";

      if (isFraud) {
        nodeColor = "#E63946";
        glowColor = "rgba(230, 57, 70, 0.7)";
      } else if (m.risk >= 40) {
        nodeColor = "#D4AF37";
        glowColor = "rgba(212, 175, 55, 0.5)";
      }

      if (isFraud) {
        const pulseRadius = radius + (Math.sin(pulseTime) + 1) * 6;
        ctx.beginPath();
        ctx.arc(node.x, node.y, pulseRadius, 0, 2 * Math.PI, false);
        ctx.strokeStyle = `rgba(230, 57, 70, ${0.7 - (pulseRadius - radius) / 16})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(node.x, node.y, pulseRadius * 1.35, 0, 2 * Math.PI, false);
        ctx.strokeStyle = `rgba(163, 40, 78, ${0.4 - (pulseRadius - radius) / 20})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      if (isSelected || isHovered) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 4, 0, 2 * Math.PI, false);
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
      ctx.fillStyle = nodeColor;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = isFraud || isSelected ? 16 : 6;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = isFraud ? "#8B1E3F" : (themeMode === "dark" ? "#221C2B" : "#FFFFFF");
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (globalScale >= 1.2 || isSelected || isHovered || isFraud) {
        const label = node.name || node.id;
        const fontSize = Math.max(9, Math.min(13, 11 / globalScale));
        ctx.font = `600 ${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        const textWidth = ctx.measureText(label).width;
        ctx.fillStyle = themeMode === "dark" ? "rgba(13, 11, 16, 0.85)" : "rgba(255, 255, 255, 0.9)";
        ctx.fillRect(node.x - textWidth / 2 - 4, node.y + radius + 3, textWidth + 8, fontSize + 4);

        ctx.fillStyle = isFraud ? "#E63946" : (themeMode === "dark" ? "#F8FAFC" : "#0F172A");
        ctx.fillText(label, node.x, node.y + radius + 5);
      }
    },
    [nodeMetrics, selectedNodeId, drilldownNode, hoveredNode, pulseTime, themeMode]
  );

  return (
    <div className="relative w-full rounded-2xl overflow-hidden glass-panel border border-rose-950/30">
      <div className="flex flex-wrap items-center justify-between p-3.5 border-b border-white/5 bg-black/40 backdrop-blur-md gap-3 z-10 relative">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-rose-300 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            Graph Analytics Workbench
          </span>
          <span className="text-xs text-slate-400 font-mono">
            ({graphData.nodes.length} Nodes • {graphData.links.length} Transfers)
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 bg-black/50 p-1 rounded-xl border border-white/10">
          <button
            onClick={() => setFilterMode("ALL")}
            className={`px-2.5 py-1 text-xs font-medium rounded-lg transition ${
              filterMode === "ALL"
                ? "bg-rose-900/80 text-rose-100 border border-rose-500/40 shadow-sm"
                : "text-slate-300 hover:bg-white/5"
            }`}
          >
            All Nodes
          </button>
          <button
            onClick={() => focusOnSyndicate("STARBURST")}
            className={`px-2.5 py-1 text-xs font-medium rounded-lg transition flex items-center gap-1 ${
              filterMode === "STARBURST"
                ? "bg-amber-950/80 text-amber-200 border border-amber-500/40 shadow-sm"
                : "text-slate-300 hover:bg-white/5"
            }`}
          >
            ⭐ Starburst Smurfing
          </button>
          <button
            onClick={() => focusOnSyndicate("CIRCULAR")}
            className={`px-2.5 py-1 text-xs font-medium rounded-lg transition flex items-center gap-1 ${
              filterMode === "CIRCULAR"
                ? "bg-rose-950/80 text-rose-200 border border-rose-500/40 shadow-sm"
                : "text-slate-300 hover:bg-white/5"
            }`}
          >
            🔄 Circular Loop
          </button>
          <button
            onClick={() => focusOnSyndicate("LAYERING")}
            className={`px-2.5 py-1 text-xs font-medium rounded-lg transition flex items-center gap-1 ${
              filterMode === "LAYERING"
                ? "bg-purple-950/80 text-purple-200 border border-purple-500/40 shadow-sm"
                : "text-slate-300 hover:bg-white/5"
            }`}
          >
            ⚡ Layering Drain
          </button>
          <button
            onClick={() => focusOnSyndicate("HIGH_RISK")}
            className={`px-2.5 py-1 text-xs font-medium rounded-lg transition flex items-center gap-1 ${
              filterMode === "HIGH_RISK"
                ? "bg-red-950/80 text-red-200 border border-red-500/40 shadow-sm"
                : "text-slate-300 hover:bg-white/5"
            }`}
          >
            🚨 High Risk Only
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setEnableParticles(!enableParticles)}
            className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition ${
              enableParticles
                ? "bg-emerald-950/60 text-emerald-300 border-emerald-500/40"
                : "bg-white/5 text-slate-400 border-white/10"
            }`}
            title="Toggle animated transaction particles along links"
          >
            {enableParticles ? "⚡ Particles: ON" : "⚪ Particles: OFF"}
          </button>
          <button
            onClick={() => fgRef.current?.zoomToFit(400, 30)}
            className="px-2.5 py-1 text-xs font-medium bg-white/5 hover:bg-white/10 text-slate-200 rounded-lg border border-white/10 transition"
          >
            Fit View
          </button>
        </div>
      </div>

      <div className="relative w-full" style={{ height: `${height}px`, background: themeMode === "dark" ? "#08080A" : "#F8FAFC" }}>
        <ForceGraph2D
          ref={fgRef}
          graphData={graphData}
          nodeId="id"
          nodeLabel=""
          nodeCanvasObject={paintNode}
          nodePointerAreaPaint={(node, color, ctx) => {
            ctx.beginPath();
            ctx.arc(node.x, node.y, 18, 0, 2 * Math.PI, false);
            ctx.fillStyle = color;
            ctx.fill();
          }}
          linkSource="source"
          linkTarget="target"
          linkColor={(link) => {
            if (link.is_fraud || link.is_suspicious) return "#E63946";
            return themeMode === "dark" ? "rgba(255, 255, 255, 0.15)" : "rgba(100, 116, 139, 0.25)";
          }}
          linkWidth={(link) => (link.is_fraud ? 2.5 : 1.2)}
          linkDirectionalParticles={enableParticles ? 4 : 0}
          linkDirectionalParticleSpeed={0.005}
          linkDirectionalParticleWidth={2.5}
          linkDirectionalParticleColor={(link) => (link.is_fraud ? "#E63946" : "#60A5FA")}
          linkCurvature={0.15}
          onNodeClick={handleNodeClick}
          onNodeHover={(node) => setHoveredNode(node || null)}
          onLinkHover={(link) => setHoveredLink(link || null)}
          cooldownTicks={120}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
        />

        {hoveredNode && !drilldownNode && (
          <div className="absolute top-4 left-4 p-3.5 rounded-xl glass-panel-elevated text-xs border border-rose-500/30 shadow-2xl max-w-xs pointer-events-none z-20 animate-fade-in">
            <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-1.5 mb-2">
              <span className="font-bold text-white text-sm">{hoveredNode.name || hoveredNode.id}</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${(nodeMetrics[hoveredNode.id]?.risk || 0) >= 70 ? "bg-red-500/20 text-red-300 border border-red-500/40" : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"}`}>
                Risk: {Math.round(nodeMetrics[hoveredNode.id]?.risk || 0)}/100
              </span>
            </div>
            <div className="space-y-1 text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-400">Account ID:</span>
                <span className="font-mono text-white">{hoveredNode.id}</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-white/5">
                <span className="text-slate-400">Degree (In/Out):</span>
                <span className="font-mono text-amber-300">{nodeMetrics[hoveredNode.id]?.inDegree || 0} In • {nodeMetrics[hoveredNode.id]?.outDegree || 0} Out</span>
              </div>
            </div>
          </div>
        )}

        {drilldownNode && (
          <div className="absolute top-0 right-0 h-full w-80 sm:w-96 glass-panel-elevated border-l border-rose-500/30 p-5 overflow-y-auto z-30 shadow-2xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
                <div>
                  <h4 className="text-base font-bold text-white flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                    Forensic Drill-Down
                  </h4>
                  <p className="text-xs text-slate-400 font-mono">{drilldownNode.id}</p>
                </div>
                <button onClick={() => setDrilldownNode(null)} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 text-sm font-bold">✕</button>
              </div>
              <div className="bg-black/40 rounded-xl p-3.5 border border-white/10 space-y-2 mb-4">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-sm font-bold text-white">{drilldownNode.name || "Account Profile"}</div>
                    <div className="text-xs text-slate-400">{drilldownNode.bank || "Central Bank"}</div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${(nodeMetrics[drilldownNode.id]?.risk || 0) >= 70 ? "bg-red-500/20 text-red-300 border border-red-500/40" : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"}`}>
                    Risk: {Math.round(nodeMetrics[drilldownNode.id]?.risk || 0)}/100
                  </span>
                </div>
              </div>
            </div>
            <div className="pt-3 border-t border-white/10 space-y-2">
              <button onClick={() => { if (onCreateCase) onCreateCase(drilldownNode); }} className="w-full py-2 px-3 bg-gradient-to-r from-rose-700 to-rose-900 hover:from-rose-600 hover:to-rose-800 text-white font-semibold text-xs rounded-xl shadow-lg border border-rose-500/40 transition">📁 Open AML Case Dossier</button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between px-4 py-2 bg-black/40 border-t border-white/5 text-[11px] text-slate-400">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm" /><span>Clean Account</span></div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-sm" /><span>Moderate</span></div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-sm" /><span>Syndicate / Fraud</span></div>
        </div>
        <div><span>Drag nodes to pin • Click node for 360° breakdown</span></div>
      </div>
    </div>
  );
}
