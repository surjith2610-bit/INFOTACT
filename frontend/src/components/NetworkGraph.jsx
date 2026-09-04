import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { formatINR, formatCompactINR } from "../utils/currency.js";

export default function NetworkGraph({
  data,
  flaggedIds = new Set(),
  height = 580,
  onNodeSelect,
  selectedNodeId,
}) {
  const fgRef = useRef();
  const [filterMode, setFilterMode] = useState("ALL"); // "ALL" | "STARBURST" | "CIRCULAR" | "HIGH_RISK"
  const [enableParticles, setEnableParticles] = useState(true);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [hoveredLink, setHoveredLink] = useState(null);
  const [pulseTime, setPulseTime] = useState(0);

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
      };
    });

    data.links.forEach((l) => {
      const srcId = typeof l.source === "object" ? l.source.id : l.source;
      const tgtId = typeof l.target === "object" ? l.target.id : l.target;
      const amt = Number(l.amount) || 0;

      if (!metrics[srcId]) metrics[srcId] = { inDegree: 0, outDegree: 0, totalAmount: 0, risk: 0, role: "Clean Account", isFraud: false };
      if (!metrics[tgtId]) metrics[tgtId] = { inDegree: 0, outDegree: 0, totalAmount: 0, risk: 0, role: "Clean Account", isFraud: false };

      metrics[srcId].outDegree += 1;
      metrics[srcId].totalAmount += amt;
      metrics[tgtId].inDegree += 1;
      metrics[tgtId].totalAmount += amt;
    });

    // Detect explicit fraud syndicate clusters for quick 1-click camera focus
    const syndicates = {
      smurfing: { hub: "SHELL_OFFSHORE_01", nodes: [], totalAmount: 0 },
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
    } else if (filterMode === "HIGH_RISK") {
      filteredNodes = data.nodes.filter((n) => {
        const m = metrics[n.id];
        return (m && m.risk >= 40) || flaggedIds.has(n.id) || n.is_fraud;
      });
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
      fraudSyndicates: syndicates,
    };
  }, [data, filterMode, flaggedIds]);

  // Apply D3 Force Spacing to prevent node clumping
  useEffect(() => {
    if (fgRef.current) {
      // Repulsion force to fan out starburst nodes
      fgRef.current.d3Force("charge")?.strength(-380);
      fgRef.current.d3Force("link")?.distance(110);
    }
  }, [graphData]);

  // Center & zoom on initial load
  useEffect(() => {
    if (fgRef.current && graphData.nodes.length > 0) {
      setTimeout(() => {
        fgRef.current.zoomToFit(500, 40);
      }, 400);
    }
  }, [graphData.nodes.length]);

  // Camera fly-to focus helper
  const focusCluster = (nodeIds, zoomLevel = 2.4) => {
    if (!fgRef.current || !graphData.nodes.length) return;
    const targetNodes = graphData.nodes.filter((n) => nodeIds.includes(n.id));
    if (targetNodes.length === 0) return;

    // Calculate center coordinates
    const avgX = targetNodes.reduce((sum, n) => sum + (n.x || 0), 0) / targetNodes.length;
    const avgY = targetNodes.reduce((sum, n) => sum + (n.y || 0), 0) / targetNodes.length;

    fgRef.current.centerAt(avgX, avgY, 700);
    fgRef.current.zoom(zoomLevel, 700);

    if (targetNodes[0] && onNodeSelect) {
      onNodeSelect(targetNodes[0].id);
    }
  };

  // Node Color Logic
  const getNodeColor = useCallback(
    (node) => {
      if (selectedNodeId === node.id) return "#1D4ED8"; // Deep Royal Blue Focus
      const m = nodeMetrics[node.id];
      const isFlagged = flaggedIds.has(node.id) || (m && m.isFraud);
      const risk = m ? m.risk : node.risk || 0;

      if (isFlagged || risk >= 70) return "#EF4444"; // High-Risk Fraud Crimson
      if (risk >= 35) return "#F59E0B";              // Suspicious Amber
      return "#2563EB";                              // Clean Account Royal Blue
    },
    [flaggedIds, selectedNodeId, nodeMetrics]
  );

  // Custom Node Canvas Renderer
  const drawNode = useCallback(
    (node, ctx, globalScale) => {
      const isSelected = selectedNodeId === node.id;
      const isHovered = hoveredNode?.id === node.id;
      const m = nodeMetrics[node.id];
      const risk = m ? m.risk : node.risk || 0;
      const isFraud = (m && m.isFraud) || flaggedIds.has(node.id) || risk >= 70;
      const color = getNodeColor(node);

      const degree = m ? m.inDegree + m.outDegree : 0;
      const idUpper = (node.id || "").toUpperCase();
      const isHub = idUpper.includes("SHELL") || idUpper.includes("CORP") || degree >= 6;
      const baseR = isHub ? 14 : Math.max(5, Math.min(12, 5 + degree * 1.2));

      // 1. Animated Concentric Radar Pulse Rings for Flagged / Fraud Nodes
      if (isFraud || isSelected) {
        ctx.save();
        const pulseFactor = (Math.sin(pulseTime) + 1) / 2; // 0 to 1
        const pulseR1 = baseR + 6 + pulseFactor * 8;
        const pulseR2 = baseR + 12 + pulseFactor * 14;

        // Outer wave 1
        ctx.beginPath();
        ctx.arc(node.x, node.y, pulseR1, 0, 2 * Math.PI);
        ctx.fillStyle = isSelected
          ? `rgba(37, 99, 235, ${0.3 - pulseFactor * 0.15})`
          : `rgba(239, 68, 68, ${0.35 - pulseFactor * 0.2})`;
        ctx.fill();

        // Outer wave 2 (wider halo)
        ctx.beginPath();
        ctx.arc(node.x, node.y, pulseR2, 0, 2 * Math.PI);
        ctx.fillStyle = isSelected
          ? `rgba(37, 99, 235, ${0.15 - pulseFactor * 0.08})`
          : `rgba(239, 68, 68, ${0.18 - pulseFactor * 0.1})`;
        ctx.fill();
        ctx.restore();
      }

      // 2. Main Node Solid Sphere with Glowing Shadow
      ctx.save();
      ctx.beginPath();
      ctx.arc(node.x, node.y, baseR, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = isFraud || isSelected ? 12 : 4;
      ctx.fill();

      ctx.lineWidth = isSelected ? 2.5 : isFraud ? 2 : 1.5;
      ctx.strokeStyle = isSelected ? "#FFFFFF" : isFraud ? "#FEE2E2" : "#FFFFFF";
      ctx.stroke();
      ctx.restore();

      // 3. Central Icon / Glyphs for Key Fraud Entities
      if (isHub || isFraud) {
        ctx.save();
        const iconSize = Math.max(9 / globalScale, 6);
        ctx.font = `bold ${iconSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(isHub ? "★" : "!", node.x, node.y);
        ctx.restore();
      }

      // 4. Floating High-Contrast Badge Tags
      // Always render prominent badges for Fraud Hubs or high-risk entities
      const showAlways = isFraud || isSelected || isHovered || isHub || globalScale > 1.3;
      if (showAlways) {
        ctx.save();
        const label = node.id || "Account";
        const roleText =
          idUpper.includes("SHELL")
            ? "🚨 SMURFING DESTINATION HUB"
            : idUpper.includes("CORP_VAULT")
            ? "⚡ ANOMALOUS WIRE SENDER"
            : idUpper.includes("OFFSHORE_PRIV")
            ? "🚨 OFFSHORE CASHOUT TARGET"
            : idUpper.includes("CIRCULAR")
            ? "🔄 WASH TRADING HUB"
            : idUpper.includes("SMURF")
            ? "🚨 SMURF MULE"
            : isFraud
            ? `🚨 SUSPECT (${Math.round(risk)}%)`
            : label;

        const fontSize = Math.max(10 / globalScale, 4.5);
        const subFontSize = Math.max(8 / globalScale, 3.5);

        ctx.font = `bold ${fontSize}px 'JetBrains Mono', monospace`;
        const textWidth = ctx.measureText(label).width;
        const roleWidth = isFraud ? ctx.measureText(roleText).width : 0;
        const boxWidth = Math.max(textWidth, roleWidth) + 8;
        const boxHeight = isFraud ? fontSize + subFontSize + 6 : fontSize + 4;

        const boxY = node.y + baseR + 3;

        // Background pill
        ctx.fillStyle = isFraud ? "rgba(254, 242, 242, 0.96)" : "rgba(255, 255, 255, 0.96)";
        ctx.strokeStyle = isSelected ? "#2563EB" : isFraud ? "#EF4444" : "rgba(148, 163, 184, 0.7)";
        ctx.lineWidth = isFraud || isSelected ? 1.5 : 1;

        // Draw rounded rectangle
        ctx.beginPath();
        const rBox = 3;
        ctx.roundRect
          ? ctx.roundRect(node.x - boxWidth / 2, boxY, boxWidth, boxHeight, rBox)
          : ctx.rect(node.x - boxWidth / 2, boxY, boxWidth, boxHeight);
        ctx.fill();
        ctx.stroke();

        // Node ID Text
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = isSelected ? "#1D4ED8" : isFraud ? "#DC2626" : "#0F172A";
        ctx.font = `bold ${fontSize}px 'JetBrains Mono', monospace`;
        ctx.fillText(label, node.x, boxY + 2);

        // Subtitle Role / Fraud Tag
        if (isFraud) {
          ctx.font = `bold ${subFontSize}px 'JetBrains Mono', monospace`;
          ctx.fillStyle = "#D97706";
          ctx.fillText(roleText, node.x, boxY + fontSize + 3);
        }
        ctx.restore();
      }
    },
    [selectedNodeId, hoveredNode, flaggedIds, getNodeColor, nodeMetrics, pulseTime]
  );

  // Custom Link Canvas Renderer to make fraud flows immediately visible
  const drawLink = useCallback(
    (link, ctx, globalScale) => {
      const src = typeof link.source === "object" ? link.source : { x: 0, y: 0 };
      const tgt = typeof link.target === "object" ? link.target : { x: 0, y: 0 };
      if (!src.x || !tgt.x) return;

      const amt = Number(link.amount) || 0;
      const isFraud = link.is_fraud || amt >= 9000 || link.is_suspicious;
      const isSelected = selectedNodeId === src.id || selectedNodeId === tgt.id;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);

      if (isFraud) {
        // Thick bold crimson line for fraud transactions
        ctx.strokeStyle = amt >= 50000 ? "#DC2626" : "#EF4444";
        ctx.lineWidth = isSelected ? 4.5 : Math.max(2.5, Math.min(5, 2.5 + Math.log10(amt / 1000)));
        ctx.shadowColor = "#EF4444";
        ctx.shadowBlur = 8;
      } else {
        // Crisp subtle slate-blue line for clean transfers
        ctx.strokeStyle = isSelected ? "rgba(37, 99, 235, 0.85)" : "rgba(148, 163, 184, 0.5)";
        ctx.lineWidth = isSelected ? 2.5 : 1.2;
        ctx.shadowBlur = 0;
      }
      ctx.stroke();
      ctx.restore();

      // Draw Directional Flow Arrow
      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 25) {
        ctx.save();
        const arrowDist = 0.55; // 55% along the edge
        const midX = src.x + dx * arrowDist;
        const midY = src.y + dy * arrowDist;
        const angle = Math.atan2(dy, dx);
        const arrowSize = isFraud ? Math.max(8 / globalScale, 4.5) : Math.max(5 / globalScale, 3);

        ctx.translate(midX, midY);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-arrowSize * 1.5, -arrowSize);
        ctx.lineTo(-arrowSize * 1.5, arrowSize);
        ctx.closePath();
        ctx.fillStyle = isFraud ? "#EF4444" : "rgba(71, 85, 105, 0.85)";
        ctx.fill();
        ctx.restore();

        // Draw Floating Amount Badge on Canvas for Fraud Transactions
        if (isFraud || globalScale > 1.8) {
          ctx.save();
          const amtText = formatCompactINR(amt);
          const badgeText = isFraud ? `🚨 ${amtText}` : `⚡ ${amtText}`;
          const amtFontSize = Math.max(8.5 / globalScale, 3.8);

          ctx.font = `bold ${amtFontSize}px 'JetBrains Mono', monospace`;
          const badgeW = ctx.measureText(badgeText).width + 6;
          const badgeH = amtFontSize + 4;

          const labelX = src.x + dx * 0.42;
          const labelY = src.y + dy * 0.42;

          ctx.fillStyle = isFraud ? "rgba(254, 242, 242, 0.95)" : "rgba(255, 255, 255, 0.95)";
          ctx.strokeStyle = isFraud ? "#EF4444" : "rgba(148, 163, 184, 0.6)";
          ctx.lineWidth = 1;

          ctx.beginPath();
          ctx.rect(labelX - badgeW / 2, labelY - badgeH / 2, badgeW, badgeH);
          ctx.fill();
          ctx.stroke();

          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = isFraud ? "#DC2626" : "#0F172A";
          ctx.fillText(badgeText, labelX, labelY);
          ctx.restore();
        }
      }
    },
    [selectedNodeId]
  );

  return (
    <div className="relative rounded-2xl overflow-hidden glass-panel border border-slate-200/90 shadow-xl transition-all duration-300">
      {/* REAL-TIME FRAUD SPOTLIGHT QUICK-FOCUS BANNER */}
      <div className="bg-gradient-to-r from-red-50 via-white to-blue-50 border-b border-red-200/80 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-flare animate-ping" />
          <span className="font-extrabold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
            <span>🚨</span> Verified Fraud Syndicates Detected:
          </span>
        </div>

        {/* 1-Click Camera Fly-to Spotlight Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => focusCluster(fraudSyndicates.smurfing.nodes, 2.3)}
            className="px-3 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 border border-red-300 font-bold transition shadow-sm flex items-center gap-1.5 group cursor-pointer"
            title="Focus Smurfing Starburst Ring (10 Mules -> 1 Offshore Shell)"
          >
            <span>💥</span>
            <span>Focus Smurfing Starburst (₹81.8L)</span>
          </button>

          <button
            onClick={() => focusCluster(["CORP_VAULT_99", "OFFSHORE_PRIV_88"], 2.8)}
            className="px-3 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 font-bold transition flex items-center gap-1.5 group cursor-pointer"
            title="Focus ₹62,25,000 Offshore Vault Transfer"
          >
            <span>⚡</span>
            <span>Focus ₹62.25L Offshore Wire</span>
          </button>

          <button
            onClick={() => focusCluster(fraudSyndicates.circular.nodes, 2.5)}
            className="px-3 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-300 font-bold transition flex items-center gap-1.5 group cursor-pointer"
            title="Focus Circular Money Routing Loop"
          >
            <span>🔄</span>
            <span>Focus Circular Loop</span>
          </button>

          <button
            onClick={() => fgRef.current?.zoomToFit(500, 30)}
            className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 text-[11px] transition"
            title="Reset to Full Graph View"
          >
            Reset View
          </button>
        </div>
      </div>

      {/* Floating HUD Header / Filter Toolbar */}
      <div className="absolute top-14 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-3 pointer-events-none">
        {/* Left: Quick Pattern Filter Chips */}
        <div className="flex items-center gap-1.5 p-1.5 rounded-xl bg-white/95 backdrop-blur-md border border-slate-200 pointer-events-auto shadow-md">
          <button
            onClick={() => setFilterMode("ALL")}
            className={`px-3 py-1 rounded-lg text-xs font-mono font-medium transition-all ${
              filterMode === "ALL"
                ? "bg-blue-600 text-white font-bold shadow-sm"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            All Nodes ({graphData.nodes.length})
          </button>
          <button
            onClick={() => setFilterMode("STARBURST")}
            className={`px-3 py-1 rounded-lg text-xs font-mono font-medium transition-all flex items-center gap-1.5 ${
              filterMode === "STARBURST"
                ? "bg-blue-600 text-white font-bold shadow-sm"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            <span>💥</span> Starburst Hubs
          </button>
          <button
            onClick={() => setFilterMode("CIRCULAR")}
            className={`px-3 py-1 rounded-lg text-xs font-mono font-medium transition-all flex items-center gap-1.5 ${
              filterMode === "CIRCULAR"
                ? "bg-blue-600 text-white font-bold shadow-sm"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            <span>🔄</span> Circular Loops
          </button>
          <button
            onClick={() => setFilterMode("HIGH_RISK")}
            className={`px-3 py-1 rounded-lg text-xs font-mono font-medium transition-all flex items-center gap-1.5 ${
              filterMode === "HIGH_RISK"
                ? "bg-red-600 text-white font-bold shadow-sm"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            <span>🚨</span> High Risk
          </button>
        </div>

        {/* Right: Interactive Camera Controls */}
        <div className="flex items-center gap-2 p-1.5 rounded-xl bg-white/95 backdrop-blur-md border border-slate-200 pointer-events-auto shadow-md">
          <button
            onClick={() => setEnableParticles((p) => !p)}
            className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all flex items-center gap-1.5 ${
              enableParticles
                ? "bg-blue-50 text-blue-700 border border-blue-200"
                : "text-slate-500 hover:text-slate-800"
            }`}
            title="Toggle Money Flow Particles"
          >
            <span>{enableParticles ? "⚡ Flow Stream ON" : "⚪ Flow OFF"}</span>
          </button>
          <button
            onClick={() => fgRef.current?.zoom(fgRef.current.zoom() * 1.35, 300)}
            className="p-1.5 px-2.5 rounded-lg text-slate-700 hover:text-blue-600 hover:bg-slate-100 font-mono text-sm"
            title="Zoom In"
          >
            +
          </button>
          <button
            onClick={() => fgRef.current?.zoom(fgRef.current.zoom() / 1.35, 300)}
            className="p-1.5 px-2.5 rounded-lg text-slate-700 hover:text-blue-600 hover:bg-slate-100 font-mono text-sm"
            title="Zoom Out"
          >
            −
          </button>
        </div>
      </div>

      {/* Force Graph Interactive Canvas */}
      <div className="w-full relative bg-slate-50">
        <ForceGraph2D
          ref={fgRef}
          width={window.innerWidth > 1200 ? 1200 : window.innerWidth - 48}
          height={height}
          graphData={graphData}
          backgroundColor="#F8FAFC"
          nodeCanvasObject={drawNode}
          nodePointerAreaPaint={(node, color, ctx) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(node.x, node.y, 16, 0, 2 * Math.PI, false);
            ctx.fill();
          }}
          linkCanvasObject={drawLink}
          linkCanvasObjectMode={() => "after"}
          linkDirectionalParticles={enableParticles ? 4 : 0}
          linkDirectionalParticleWidth={(link) => (link.is_fraud || Number(link.amount) >= 9000 ? 3.5 : 2.0)}
          linkDirectionalParticleSpeed={(d) =>
            d.is_fraud || Number(d.amount) >= 9000
              ? 0.015
              : 0.005 + (Math.min(Number(d.amount) || 500, 10000) / 50000) * 0.008
          }
          linkDirectionalParticleColor={(link) => {
            const isSuspicious = Number(link.amount) >= 9000 || link.is_fraud || link.is_suspicious;
            return isSuspicious ? "#EF4444" : "#2563EB";
          }}
          onNodeHover={(node) => setHoveredNode(node || null)}
          onLinkHover={(link) => setHoveredLink(link || null)}
          onNodeClick={(node) => {
            if (onNodeSelect && node) onNodeSelect(node.id);
          }}
          d3AlphaDecay={0.018}
          d3VelocityDecay={0.28}
        />
      </div>

      {/* Dynamic Hover Tooltip HUD card */}
      {hoveredNode && (
        <div className="absolute bottom-4 left-4 z-30 p-4 rounded-2xl bg-white/95 backdrop-blur-md border border-slate-200 shadow-xl font-mono text-xs max-w-sm animate-fade-in pointer-events-none">
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="text-blue-600 font-extrabold tracking-wide text-sm">{hoveredNode.id}</span>
            <span
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                flaggedIds.has(hoveredNode.id) || (nodeMetrics[hoveredNode.id]?.risk >= 70)
                  ? "bg-red-50 text-red-700 border border-red-300"
                  : nodeMetrics[hoveredNode.id]?.risk >= 35
                  ? "bg-amber-50 text-amber-700 border border-amber-300"
                  : "bg-blue-50 text-blue-700 border border-blue-200"
              }`}
            >
              Risk: {Math.round(nodeMetrics[hoveredNode.id]?.risk || 0)}%
            </span>
          </div>

          <div className="space-y-1.5 text-slate-700 text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-500">Class Role:</span>
              <span className="text-slate-900 font-bold">{nodeMetrics[hoveredNode.id]?.role || "Account Entity"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Inbound Transfers:</span>
              <span className="text-emerald-700 font-semibold">{nodeMetrics[hoveredNode.id]?.inDegree || 0} incoming</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Outbound Transfers:</span>
              <span className="text-blue-700 font-semibold">{nodeMetrics[hoveredNode.id]?.outDegree || 0} outgoing</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-slate-200">
              <span className="text-slate-500">Total Volume:</span>
              <span className="text-blue-700 font-bold">
                {formatINR(nodeMetrics[hoveredNode.id]?.totalAmount || 0)}
              </span>
            </div>
          </div>

          <div className="mt-2.5 pt-2 border-t border-slate-200 text-[10px] text-blue-600 text-center font-sans font-semibold">
            ⚡ Click node to open deep forensic investigation panel
          </div>
        </div>
      )}

      {/* Visual Graph Legend Footer */}
      <div className="p-3.5 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded-full bg-flare shadow-sm" />
            <span className="text-slate-800 font-bold">🚨 Flagged Fraud Syndicate (&gt;70%)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-gold shadow-sm" />
            <span className="text-slate-700">⚠️ Suspicious Velocity (35-70%)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-blue-600 shadow-sm" />
            <span className="text-slate-700">🔵 Clean Account (&lt;30%)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-1.5 bg-flare rounded" />
            <span className="text-slate-700">🔴 High-Risk Laundering Flow</span>
          </div>
        </div>
        <div className="text-slate-500 text-[11px] font-sans">
          ⚡ GPU Particle Acceleration Enabled • Live Cypher Graph
        </div>
      </div>
    </div>
  );
}
