import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { formatINR, formatCompactINR } from "../utils/currency.js";

/**
 * Zoom Level Utility Constants & Calculation Functions
 * Compatible with D3.js, Cytoscape.js, Vis.js, and ForceGraph2D
 */
export const ZOOM_THRESHOLDS = {
  MIN_LABEL_VISIBILITY: 0.6,
  FULL_DETAIL_VISIBILITY: 1.2,
};

/**
 * Calculates dynamically scaled font size in graph canvas space:
 * font_size = base_size / zoom_level
 */
export function calculateFontSize(baseSize = 11, zoomLevel = 1, minScreenPx = 8, maxScreenPx = 18) {
  const effectiveZoom = Math.max(0.1, zoomLevel || 1);
  const rawSize = baseSize / effectiveZoom;
  // Bound the canvas font size to maintain crisp readability
  return Math.max(minScreenPx / effectiveZoom, Math.min(maxScreenPx / effectiveZoom, rawSize));
}

/**
 * Calculates edge stroke thickness based on transaction amount (Logarithmic scaling)
 */
export function calculateEdgeWidth(amount = 0, isFraud = false) {
  const num = Number(amount) || 0;
  const base = Math.max(1.2, Math.min(6.5, 1.2 + Math.log10(num + 1) * 0.85));
  return isFraud ? Math.min(base * 1.35, 7.5) : base;
}

/**
 * Utility to draw a crisp rounded pill label with high contrast outline
 */
function drawPillLabel(ctx, text, x, y, fontSize, options = {}) {
  const {
    textColor = "#FFFFFF",
    bgColor = "rgba(10, 8, 14, 0.88)",
    borderColor = "rgba(255, 255, 255, 0.18)",
    paddingX = 5,
    paddingY = 2.5,
    borderRadius = 4,
    fontWeight = "600",
  } = options;

  ctx.font = `${fontWeight} ${fontSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const metrics = ctx.measureText(text);
  const textWidth = metrics.width;
  const boxWidth = textWidth + paddingX * 2;
  const boxHeight = fontSize + paddingY * 2;
  const boxX = x - boxWidth / 2;
  const boxY = y - boxHeight / 2;

  // Draw pill background
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(boxX, boxY, boxWidth, boxHeight, borderRadius);
  } else {
    ctx.rect(boxX, boxY, boxWidth, boxHeight);
  }
  ctx.fillStyle = bgColor;
  ctx.fill();

  if (borderColor) {
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = Math.max(0.7, fontSize * 0.08);
    ctx.stroke();
  }

  // Draw crisp text
  ctx.fillStyle = textColor;
  ctx.fillText(text, x, y);
}

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
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [pulseTime, setPulseTime] = useState(0);
  const [drilldownNode, setDrilldownNode] = useState(null);
  const [currentZoomLevel, setCurrentZoomLevel] = useState(1);

  // Throttled zoom level updater for HUD (avoids re-rendering the whole graph on minor zoom ticks)
  const zoomThrottleRef = useRef(null);
  const handleZoomChange = useCallback((transform) => {
    if (zoomThrottleRef.current) return;
    zoomThrottleRef.current = setTimeout(() => {
      if (transform && transform.k !== undefined) {
        setCurrentZoomLevel(Number(transform.k.toFixed(2)));
      }
      zoomThrottleRef.current = null;
    }, 80);
  }, []);

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

  // Track cursor position inside canvas container for high-accuracy floating tooltip
  const handleMouseMove = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
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
        role: n.role || (riskVal >= 70 ? "Flagged Suspect" : riskVal >= 40 ? "Mule / Layering" : "Clean Account"),
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
      fraudSyndicates: syndicates,
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

  /**
   * Custom Node Renderer with Dynamic Zoom Scaling & Conditional Visibility
   */
  const paintNode = useCallback(
    (node, ctx, globalScale) => {
      const m = nodeMetrics[node.id] || { risk: 0, isFraud: false };
      const isSelected = selectedNodeId === node.id || (drilldownNode && drilldownNode.id === node.id);
      const isHovered = hoveredNode && hoveredNode.id === node.id;
      const isFraud = m.isFraud || m.risk >= 70;

      // Node Radius scaled slightly with degree, bounded for smoothness
      const baseRadius = Math.max(5, Math.min(15, 5 + Math.sqrt((m.inDegree + m.outDegree) * 2)));
      const radius = isSelected || isHovered ? baseRadius * 1.3 : baseRadius;

      // Color Coding: Red (Fraud/Suspicious) | Amber (Moderate Risk) | Emerald (Normal)
      let nodeColor = "#10B981"; // Normal: Green
      let glowColor = "rgba(16, 185, 129, 0.4)";

      if (isFraud) {
        nodeColor = "#EF4444"; // Fraud: Red
        glowColor = "rgba(239, 68, 68, 0.7)";
      } else if (m.risk >= 40) {
        nodeColor = "#F59E0B"; // Suspicious: Amber
        glowColor = "rgba(245, 158, 11, 0.5)";
      }

      // Radar Pulse on High Risk / Fraud Nodes
      if (isFraud) {
        const pulseRadius = radius + (Math.sin(pulseTime) + 1) * 6;
        ctx.beginPath();
        ctx.arc(node.x, node.y, pulseRadius, 0, 2 * Math.PI, false);
        ctx.strokeStyle = `rgba(239, 68, 68, ${0.7 - (pulseRadius - radius) / 16})`;
        ctx.lineWidth = Math.max(0.8, 1.5 / globalScale);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(node.x, node.y, pulseRadius * 1.35, 0, 2 * Math.PI, false);
        ctx.strokeStyle = `rgba(185, 28, 28, ${0.4 - (pulseRadius - radius) / 20})`;
        ctx.lineWidth = Math.max(0.6, 1 / globalScale);
        ctx.stroke();
      }

      // Selection Halo
      if (isSelected || isHovered) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 4, 0, 2 * Math.PI, false);
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = Math.max(1, 2 / globalScale);
        ctx.stroke();
      }

      // Node Body
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
      ctx.fillStyle = nodeColor;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = isFraud || isSelected ? 16 : 6;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = isFraud ? "#991B1B" : (themeMode === "dark" ? "#1E1B29" : "#FFFFFF");
      ctx.lineWidth = Math.max(0.8, 1.5 / globalScale);
      ctx.stroke();

      // ==========================================
      // CONDITIONAL NODE LABEL VISIBILITY & SCALING
      // ==========================================
      // Requirement 1 & 2:
      // - Hide when zoom < 0.6 (unless hovered or selected)
      // - Medium zoom (0.6 - 1.2): Short ID
      // - High zoom (> 1.2): Full Account Details + Tag
      if (globalScale >= ZOOM_THRESHOLDS.MIN_LABEL_VISIBILITY || isSelected || isHovered || isFraud) {
        // Formula: font_size = base_size / zoom_level
        const fontSize = calculateFontSize(10.5, globalScale, 8, 14);
        const offsetY = radius + (4 / globalScale);

        if (globalScale > ZOOM_THRESHOLDS.FULL_DETAIL_VISIBILITY || isSelected || isHovered) {
          // Full Details
          const primaryLabel = node.name || node.id;
          const subLabel = isFraud ? `🚨 RISK ${Math.round(m.risk)}` : (node.bank || m.entityTag);

          drawPillLabel(
            ctx,
            `${primaryLabel} • ${subLabel}`,
            node.x,
            node.y + offsetY + fontSize * 0.7,
            fontSize,
            {
              textColor: isFraud ? "#FCA5A5" : (themeMode === "dark" ? "#F8FAFC" : "#0F172A"),
              bgColor: isFraud ? "rgba(45, 10, 15, 0.92)" : (themeMode === "dark" ? "rgba(15, 12, 22, 0.9)" : "rgba(255, 255, 255, 0.95)"),
              borderColor: isFraud ? "rgba(239, 68, 68, 0.5)" : "rgba(255, 255, 255, 0.15)",
              paddingX: 5 / globalScale,
              paddingY: 2.5 / globalScale,
              borderRadius: 3 / globalScale,
            }
          );
        } else if (globalScale >= ZOOM_THRESHOLDS.MIN_LABEL_VISIBILITY) {
          // Partial Label (Short ID only)
          const shortId = node.id.length > 10 ? `${node.id.slice(0, 8)}..` : node.id;
          drawPillLabel(
            ctx,
            shortId,
            node.x,
            node.y + offsetY + fontSize * 0.6,
            fontSize,
            {
              textColor: isFraud ? "#FCA5A5" : (themeMode === "dark" ? "#E2E8F0" : "#1E293B"),
              bgColor: themeMode === "dark" ? "rgba(15, 12, 22, 0.85)" : "rgba(255, 255, 255, 0.9)",
              borderColor: isFraud ? "rgba(239, 68, 68, 0.4)" : "rgba(255, 255, 255, 0.1)",
              paddingX: 4 / globalScale,
              paddingY: 2 / globalScale,
              borderRadius: 3 / globalScale,
            }
          );
        }
      }
    },
    [nodeMetrics, selectedNodeId, drilldownNode, hoveredNode, pulseTime, themeMode]
  );

  /**
   * Custom Link (Edge) Renderer with Amount Scaling, Anti-Collision, & Zoom Dynamics
   */
  const paintLink = useCallback(
    (link, ctx, globalScale) => {
      const isFraud = Boolean(link.is_fraud || link.is_suspicious);
      const isHovered = hoveredLink === link;
      const amt = Number(link.amount) || 0;

      // Ensure source/target coords are resolved
      const src = link.source;
      const tgt = link.target;
      if (!src || !tgt || src.x === undefined || tgt.x === undefined) return;

      // Dynamic Edge Stroke Thickness based on Amount
      const linkWidth = calculateEdgeWidth(amt, isFraud);
      const isHighlight = isHovered || isFraud;

      // Color Coding: Red for Fraud | Green for Normal
      let strokeColor = isFraud
        ? "rgba(239, 68, 68, 0.85)" // Suspicious/Fraud: Vibrant Red
        : "rgba(16, 185, 129, 0.45)"; // Normal: Green

      if (isHovered) {
        strokeColor = isFraud ? "#EF4444" : "#34D399";
      } else if (!isFraud && themeMode === "dark") {
        strokeColor = "rgba(16, 185, 129, 0.35)";
      }

      // Draw Edge Line
      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = linkWidth;
      ctx.stroke();

      // ==========================================
      // CONDITIONAL EDGE LABEL VISIBILITY & SCALING
      // ==========================================
      // Requirement 1 & 2:
      // - Hide when zoom < 0.6
      // - Medium zoom (0.6 - 1.2): Compact Amount (e.g. ₹8.1L)
      // - High zoom (> 1.2): Full Amount (e.g. ₹8,13,400) + Timestamp
      if ((globalScale >= ZOOM_THRESHOLDS.MIN_LABEL_VISIBILITY || isHovered) && amt > 0) {
        // Calculate midpoint with slight normal-vector offset to prevent overlap on bidirectional edges
        const dx = tgt.x - src.x;
        const dy = tgt.y - src.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 20) {
          // Midpoint
          const midX = (src.x + tgt.x) / 2;
          const midY = (src.y + tgt.y) / 2;

          // Normal vector offset (perp to edge) to avoid line occlusion
          const nx = -dy / dist;
          const ny = dx / dist;
          const offsetDist = Math.max(6, 10 / globalScale);

          const posX = midX + nx * offsetDist;
          const posY = midY + ny * offsetDist;

          // Formula: font_size = base_size / zoom_level
          const fontSize = calculateFontSize(9.5, globalScale, 7.5, 13);

          let labelText = "";
          if (globalScale > ZOOM_THRESHOLDS.FULL_DETAIL_VISIBILITY || isHovered) {
            // Full details at high zoom
            const formattedAmt = formatINR(amt, { showSymbol: true, maximumFractionDigits: 0 });
            const timeStr = link.timestamp ? ` • ${link.timestamp.slice(11, 16) || link.timestamp}` : "";
            labelText = `${formattedAmt}${timeStr}`;
          } else {
            // Compact details at medium zoom
            labelText = formatCompactINR(amt, { showSymbol: true });
          }

          drawPillLabel(ctx, labelText, posX, posY, fontSize, {
            textColor: isFraud ? "#FECACA" : "#A7F3D0",
            bgColor: isFraud
              ? "rgba(35, 8, 12, 0.92)"
              : (themeMode === "dark" ? "rgba(6, 20, 14, 0.88)" : "rgba(240, 253, 244, 0.95)"),
            borderColor: isFraud ? "rgba(239, 68, 68, 0.6)" : "rgba(16, 185, 129, 0.4)",
            paddingX: 4 / globalScale,
            paddingY: 2 / globalScale,
            borderRadius: 3 / globalScale,
            fontWeight: isHighlight ? "700" : "600",
          });
        }
      }
    },
    [hoveredLink, themeMode]
  );

  return (
    <div
      className="relative w-full rounded-2xl overflow-hidden glass-panel border border-rose-950/30 shadow-2xl"
      onMouseMove={handleMouseMove}
    >
      {/* Top Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between p-3.5 border-b border-white/5 bg-black/40 backdrop-blur-md gap-3 z-10 relative">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-rose-300 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            Graph Analytics Workbench
          </span>
          <span className="text-xs text-slate-400 font-mono">
            ({graphData.nodes.length} Nodes • {graphData.links.length} Transfers)
          </span>
          {/* Real-time Zoom Scale HUD Badge */}
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white/5 border border-white/10 text-slate-300">
            🔍 {(currentZoomLevel * 100).toFixed(0)}%
          </span>
        </div>

        {/* Pattern Highlight Quick Filters */}
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

        {/* View Actions */}
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

      {/* Interactive 2D Graph Canvas */}
      <div
        className="relative w-full"
        style={{ height: `${height}px`, background: themeMode === "dark" ? "#08080A" : "#F8FAFC" }}
      >
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
          linkCanvasObject={paintLink}
          linkPointerAreaPaint={(link, color, ctx) => {
            const src = link.source;
            const tgt = link.target;
            if (!src || !tgt || src.x === undefined || tgt.x === undefined) return;
            ctx.beginPath();
            ctx.moveTo(src.x, src.y);
            ctx.lineTo(tgt.x, tgt.y);
            ctx.strokeStyle = color;
            ctx.lineWidth = 14; // Wide pointer capture area for easy hover
            ctx.stroke();
          }}
          linkDirectionalParticles={enableParticles ? 4 : 0}
          linkDirectionalParticleSpeed={0.005}
          linkDirectionalParticleWidth={(link) => (link.is_fraud ? 3.5 : 2.2)}
          linkDirectionalParticleColor={(link) => (link.is_fraud ? "#EF4444" : "#10B981")}
          linkCurvature={0.12}
          onNodeClick={handleNodeClick}
          onNodeHover={(node) => setHoveredNode(node || null)}
          onLinkHover={(link) => setHoveredLink(link || null)}
          onZoom={handleZoomChange}
          cooldownTicks={120}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
        />

        {/* ==================================================== */}
        {/* REQUIREMENT 5: HOVER TOOLTIP INTERACTION            */}
        {/* Appears on hover for nodes and edges at all zooms    */}
        {/* ==================================================== */}

        {/* Node Hover Tooltip */}
        {hoveredNode && !drilldownNode && (
          <div
            className="absolute p-3.5 rounded-xl glass-panel-elevated text-xs border border-rose-500/30 shadow-2xl max-w-xs pointer-events-none z-20 animate-fade-in backdrop-blur-xl"
            style={{
              left: `${Math.min(mousePos.x + 16, 450)}px`,
              top: `${Math.max(12, mousePos.y - 40)}px`,
            }}
          >
            <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-1.5 mb-2">
              <span className="font-bold text-white text-sm">{hoveredNode.name || hoveredNode.id}</span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  (nodeMetrics[hoveredNode.id]?.risk || 0) >= 70
                    ? "bg-red-500/20 text-red-300 border border-red-500/40"
                    : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                }`}
              >
                Risk: {Math.round(nodeMetrics[hoveredNode.id]?.risk || 0)}/100
              </span>
            </div>
            <div className="space-y-1.5 text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-400">Account ID:</span>
                <span className="font-mono text-white font-semibold">{hoveredNode.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Bank / Entity:</span>
                <span className="text-slate-200">{hoveredNode.bank || nodeMetrics[hoveredNode.id]?.entityTag || "Retail Bank"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Total Volume:</span>
                <span className="font-mono text-emerald-400 font-bold">
                  {formatINR(nodeMetrics[hoveredNode.id]?.totalAmount || 0, { maximumFractionDigits: 0 })}
                </span>
              </div>
              <div className="flex justify-between pt-1 border-t border-white/5">
                <span className="text-slate-400">Flows (In/Out):</span>
                <span className="font-mono text-amber-300">
                  {nodeMetrics[hoveredNode.id]?.inDegree || 0} In • {nodeMetrics[hoveredNode.id]?.outDegree || 0} Out
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Edge (Transaction) Hover Tooltip */}
        {hoveredLink && !hoveredNode && (
          <div
            className="absolute p-3.5 rounded-xl glass-panel-elevated text-xs border border-emerald-500/30 shadow-2xl max-w-sm pointer-events-none z-20 animate-fade-in backdrop-blur-xl"
            style={{
              left: `${Math.min(mousePos.x + 16, 450)}px`,
              top: `${Math.max(12, mousePos.y - 40)}px`,
            }}
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-1.5 mb-2">
              <span className="font-bold text-white text-xs flex items-center gap-1.5">
                <span>💸</span> Transaction Details
              </span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  hoveredLink.is_fraud || hoveredLink.is_suspicious
                    ? "bg-red-500/20 text-red-300 border border-red-500/40"
                    : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                }`}
              >
                {hoveredLink.is_fraud || hoveredLink.is_suspicious ? "🚨 SUSPICIOUS" : "✅ NORMAL"}
              </span>
            </div>
            <div className="space-y-1.5 text-slate-300">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Sender:</span>
                <span className="font-mono text-amber-300 font-semibold">
                  {typeof hoveredLink.source === "object" ? hoveredLink.source.id : hoveredLink.source}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Receiver:</span>
                <span className="font-mono text-blue-300 font-semibold">
                  {typeof hoveredLink.target === "object" ? hoveredLink.target.id : hoveredLink.target}
                </span>
              </div>
              <div className="flex justify-between items-center pt-1 border-t border-white/5">
                <span className="text-slate-400">Amount:</span>
                <span className="font-mono text-white font-black text-sm">
                  {formatINR(hoveredLink.amount || 0, { maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Timestamp:</span>
                <span className="font-mono text-slate-300">
                  {hoveredLink.timestamp || "Real-Time Ingestion"}
                </span>
              </div>
              {hoveredLink.channel && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Channel:</span>
                  <span className="font-mono text-purple-300">{hoveredLink.channel}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Slide-over Forensic Drilldown Dossier */}
        {drilldownNode && (
          <div className="absolute top-0 right-0 h-full w-80 sm:w-96 glass-panel-elevated border-l border-rose-500/30 p-5 overflow-y-auto z-30 shadow-2xl flex flex-col justify-between backdrop-blur-2xl">
            <div>
              <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
                <div>
                  <h4 className="text-base font-bold text-white flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                    Forensic Drill-Down
                  </h4>
                  <p className="text-xs text-slate-400 font-mono">{drilldownNode.id}</p>
                </div>
                <button
                  onClick={() => setDrilldownNode(null)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 text-sm font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="bg-black/40 rounded-xl p-3.5 border border-white/10 space-y-2 mb-4">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-sm font-bold text-white">{drilldownNode.name || "Account Profile"}</div>
                    <div className="text-xs text-slate-400">{drilldownNode.bank || "Central Bank"}</div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-bold ${
                      (nodeMetrics[drilldownNode.id]?.risk || 0) >= 70
                        ? "bg-red-500/20 text-red-300 border border-red-500/40"
                        : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                    }`}
                  >
                    Risk: {Math.round(nodeMetrics[drilldownNode.id]?.risk || 0)}/100
                  </span>
                </div>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between p-2 rounded-lg bg-white/5">
                  <span className="text-slate-400">Total Volume:</span>
                  <span className="font-mono text-emerald-400 font-bold">
                    {formatINR(nodeMetrics[drilldownNode.id]?.totalAmount || 0, { maximumFractionDigits: 0 })}
                  </span>
                </div>
                <div className="flex justify-between p-2 rounded-lg bg-white/5">
                  <span className="text-slate-400">Connections:</span>
                  <span className="font-mono text-amber-300">
                    {nodeMetrics[drilldownNode.id]?.inDegree || 0} In / {nodeMetrics[drilldownNode.id]?.outDegree || 0} Out
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-white/10 space-y-2">
              <button
                onClick={() => {
                  if (onCreateCase) onCreateCase(drilldownNode);
                }}
                className="w-full py-2 px-3 bg-gradient-to-r from-rose-700 to-rose-900 hover:from-rose-600 hover:to-rose-800 text-white font-semibold text-xs rounded-xl shadow-lg border border-rose-500/40 transition"
              >
                📁 Open AML Case Dossier
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Status & Color Legend Bar */}
      <div className="flex flex-wrap items-center justify-between px-4 py-2 bg-black/40 border-t border-white/5 text-[11px] text-slate-400">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm" />
            <span>Normal Transaction / Clean Node</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-sm" />
            <span>Moderate Velocity</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-sm" />
            <span>Suspicious / Fraud</span>
          </div>
        </div>
        <div className="font-mono text-[10px] text-slate-400">
          <span>Edge thickness = Transaction Amount • Scroll to dynamic zoom • Hover for details</span>
        </div>
      </div>
    </div>
  );
}

