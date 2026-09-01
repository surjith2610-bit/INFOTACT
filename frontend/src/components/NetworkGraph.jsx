import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import ForceGraph2D from "react-force-graph-2d";

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
      largeWire: { hub: "OFFSHORE_PRIV_88", source: "CORP_VAULT_99", amount: 75000 },
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
      if (selectedNodeId === node.id) return "#00F2FE"; // Bright Neon Cyan
      const m = nodeMetrics[node.id];
      const isFlagged = flaggedIds.has(node.id) || (m && m.isFraud);
      const risk = m ? m.risk : node.risk || 0;

      if (isFlagged || risk >= 70) return "#FF385C"; // High-Risk Fraud Red
      if (risk >= 35) return "#FBBF24";              // Suspicious Amber
      return "#10B981";                              // Clean Emerald
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
          ? `rgba(0, 242, 254, ${0.35 - pulseFactor * 0.2})`
          : `rgba(255, 56, 92, ${0.4 - pulseFactor * 0.25})`;
        ctx.fill();

        // Outer wave 2 (wider halo)
        ctx.beginPath();
        ctx.arc(node.x, node.y, pulseR2, 0, 2 * Math.PI);
        ctx.fillStyle = isSelected
          ? `rgba(0, 242, 254, ${0.15 - pulseFactor * 0.1})`
          : `rgba(255, 56, 92, ${0.2 - pulseFactor * 0.15})`;
        ctx.fill();
        ctx.restore();
      }

      // 2. Main Node Solid Sphere with Glowing Shadow
      ctx.save();
      ctx.beginPath();
      ctx.arc(node.x, node.y, baseR, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = isFraud || isSelected ? 16 : 6;
      ctx.fill();

      ctx.lineWidth = isSelected ? 2.5 : isFraud ? 2 : 1;
      ctx.strokeStyle = isSelected ? "#FFFFFF" : isFraud ? "#FFE4E6" : "rgba(255, 255, 255, 0.7)";
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
        ctx.fillStyle = isFraud ? "rgba(20, 5, 8, 0.92)" : "rgba(7, 9, 14, 0.88)";
        ctx.strokeStyle = isSelected ? "#00F2FE" : isFraud ? "#FF385C" : "rgba(255, 255, 255, 0.25)";
        ctx.lineWidth = isFraud || isSelected ? 1.5 : 0.8;

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
        ctx.fillStyle = isSelected ? "#00F2FE" : isFraud ? "#FF8599" : "#E2E8F0";
        ctx.font = `bold ${fontSize}px 'JetBrains Mono', monospace`;
        ctx.fillText(label, node.x, boxY + 2);

        // Subtitle Role / Fraud Tag
        if (isFraud) {
          ctx.font = `bold ${subFontSize}px 'JetBrains Mono', monospace`;
          ctx.fillStyle = "#FFB800";
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
        // Thick glowing crimson / neon flare line for fraud transactions
        ctx.strokeStyle = amt >= 50000 ? "#FF0055" : "#FF385C";
        ctx.lineWidth = isSelected ? 4.5 : Math.max(2.5, Math.min(5, 2.5 + Math.log10(amt / 1000)));
        ctx.shadowColor = "#FF385C";
        ctx.shadowBlur = 10;
      } else {
        // Subtle translucent line for clean transfers
        ctx.strokeStyle = isSelected ? "rgba(0, 242, 254, 0.7)" : "rgba(71, 85, 105, 0.35)";
        ctx.lineWidth = isSelected ? 2 : 1;
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
        ctx.fillStyle = isFraud ? "#FF385C" : "rgba(148, 163, 184, 0.8)";
        ctx.fill();
        ctx.restore();

        // Draw Floating Amount Badge on Canvas for Fraud Transactions
        if (isFraud || globalScale > 1.8) {
          ctx.save();
          const amtText = amt >= 1000 ? `$${(amt / 1000).toFixed(1)}k` : `$${amt.toFixed(0)}`;
          const badgeText = amt >= 10000 ? `🚨 $${amt.toLocaleString()}` : `⚡ ${amtText}`;
          const amtFontSize = Math.max(8.5 / globalScale, 3.8);

          ctx.font = `bold ${amtFontSize}px 'JetBrains Mono', monospace`;
          const badgeW = ctx.measureText(badgeText).width + 6;
          const badgeH = amtFontSize + 4;

          const labelX = src.x + dx * 0.42;
          const labelY = src.y + dy * 0.42;

          ctx.fillStyle = "rgba(10, 12, 18, 0.92)";
          ctx.strokeStyle = isFraud ? "#FF385C" : "rgba(255, 255, 255, 0.2)";
          ctx.lineWidth = 1;

          ctx.beginPath();
          ctx.rect(labelX - badgeW / 2, labelY - badgeH / 2, badgeW, badgeH);
          ctx.fill();
          ctx.stroke();

          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = isFraud ? "#FFB800" : "#E2E8F0";
          ctx.fillText(badgeText, labelX, labelY);
          ctx.restore();
        }
      }
    },
    [selectedNodeId]
  );

  return (
    <div className="relative rounded-2xl overflow-hidden glass-panel border border-slate-800/80 shadow-2xl transition-all duration-300">
      {/* REAL-TIME FRAUD SPOTLIGHT QUICK-FOCUS BANNER */}
      <div className="bg-gradient-to-r from-red-950/90 via-obsidian/95 to-slate-900/90 border-b border-red-500/30 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-flare animate-ping" />
          <span className="font-extrabold text-white uppercase tracking-wider flex items-center gap-1.5">
            <span>🚨</span> Verified Fraud Syndicates Detected:
          </span>
        </div>

        {/* 1-Click Camera Fly-to Spotlight Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => focusCluster(fraudSyndicates.smurfing.nodes, 2.3)}
            className="px-3 py-1 rounded-lg bg-flare/20 hover:bg-flare text-white border border-flare/40 font-bold transition shadow-neon-flare flex items-center gap-1.5 group cursor-pointer"
            title="Focus Smurfing Starburst Ring (10 Mules -> 1 Offshore Shell)"
          >
            <span>💥</span>
            <span>Focus Smurfing Starburst ($98.5k)</span>
          </button>

          <button
            onClick={() => focusCluster(["CORP_VAULT_99", "OFFSHORE_PRIV_88"], 2.8)}
            className="px-3 py-1 rounded-lg bg-gold/20 hover:bg-gold hover:text-obsidian text-gold border border-gold/40 font-bold transition flex items-center gap-1.5 group cursor-pointer"
            title="Focus $75,000 Offshore Vault Transfer"
          >
            <span>⚡</span>
            <span>Focus $75k Offshore Wire</span>
          </button>

          <button
            onClick={() => focusCluster(fraudSyndicates.circular.nodes, 2.5)}
            className="px-3 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-400 hover:text-obsidian text-cyan-300 border border-cyan-400/40 font-bold transition flex items-center gap-1.5 group cursor-pointer"
            title="Focus Circular Money Routing Loop"
          >
            <span>🔄</span>
            <span>Focus Circular Loop</span>
          </button>

          <button
            onClick={() => fgRef.current?.zoomToFit(500, 30)}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] transition"
            title="Reset to Full Graph View"
          >
            Reset View
          </button>
        </div>
      </div>

      {/* Floating HUD Header / Filter Toolbar */}
      <div className="absolute top-14 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-3 pointer-events-none">
        {/* Left: Quick Pattern Filter Chips */}
        <div className="flex items-center gap-1.5 p-1.5 rounded-xl bg-obsidian/90 backdrop-blur-md border border-slate-800 pointer-events-auto shadow-xl">
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
        <div className="flex items-center gap-2 p-1.5 rounded-xl bg-obsidian/90 backdrop-blur-md border border-slate-800 pointer-events-auto shadow-xl">
          <button
            onClick={() => setEnableParticles((p) => !p)}
            className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all flex items-center gap-1.5 ${
              enableParticles
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "text-slate-500 hover:text-slate-300"
            }`}
            title="Toggle Money Flow Particles"
          >
            <span>{enableParticles ? "⚡ Particle Flow ON" : "⚪ Particles OFF"}</span>
          </button>
          <button
            onClick={() => fgRef.current?.zoom(fgRef.current.zoom() * 1.35, 300)}
            className="p-1.5 px-2.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 font-mono text-sm"
            title="Zoom In"
          >
            +
          </button>
          <button
            onClick={() => fgRef.current?.zoom(fgRef.current.zoom() / 1.35, 300)}
            className="p-1.5 px-2.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 font-mono text-sm"
            title="Zoom Out"
          >
            −
          </button>
        </div>
      </div>

      {/* Force Graph Interactive Canvas */}
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
            return isSuspicious ? "#FF385C" : "#00F2FE";
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
        <div className="absolute bottom-4 left-4 z-30 p-4 rounded-2xl bg-obsidian/95 backdrop-blur-md border border-slate-700/80 shadow-2xl font-mono text-xs max-w-sm animate-fade-in pointer-events-none">
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="text-teal font-extrabold tracking-wide text-sm">{hoveredNode.id}</span>
            <span
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                flaggedIds.has(hoveredNode.id) || (nodeMetrics[hoveredNode.id]?.risk >= 70)
                  ? "bg-flare text-white shadow-neon-flare"
                  : nodeMetrics[hoveredNode.id]?.risk >= 35
                  ? "bg-gold/20 text-gold border border-gold/30"
                  : "bg-emerald/20 text-emerald-400 border border-emerald/30"
              }`}
            >
              Risk: {Math.round(nodeMetrics[hoveredNode.id]?.risk || 0)}%
            </span>
          </div>

          <div className="space-y-1.5 text-slate-300 text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-400">Class Role:</span>
              <span className="text-white font-bold">{nodeMetrics[hoveredNode.id]?.role || "Account Entity"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Inbound Transfers:</span>
              <span className="text-emerald-400 font-semibold">{nodeMetrics[hoveredNode.id]?.inDegree || 0} incoming</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Outbound Transfers:</span>
              <span className="text-cyan-400 font-semibold">{nodeMetrics[hoveredNode.id]?.outDegree || 0} outgoing</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-slate-800">
              <span className="text-slate-400">Total Volume:</span>
              <span className="text-teal font-bold">
                ${(nodeMetrics[hoveredNode.id]?.totalAmount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          <div className="mt-2.5 pt-2 border-t border-slate-800/80 text-[10px] text-teal text-center font-sans font-semibold">
            ⚡ Click node to open deep forensic investigation panel
          </div>
        </div>
      )}

      {/* Visual Graph Legend Footer */}
      <div className="p-3.5 bg-obsidian/95 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded-full bg-flare shadow-[0_0_12px_rgba(255,56,92,0.9)] animate-pulse" />
            <span className="text-white font-bold">🚨 Flagged Fraud Syndicate (&gt;70%)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-gold shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
            <span className="text-slate-300">⚠️ Suspicious Velocity (35-70%)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
            <span className="text-slate-300">🟢 Clean Account (&lt;30%)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-1.5 bg-flare rounded shadow-neon-flare" />
            <span className="text-slate-300">🔴 High-Risk Laundering Flow</span>
          </div>
        </div>
        <div className="text-slate-400 text-[11px] font-sans">
          ⚡ GPU Particle Acceleration Enabled • Live Cypher Graph
        </div>
      </div>
    </div>
  );
}
