import { useMemo } from "react";
import ForceGraph2D from "react-force-graph-2d";

export default function NetworkGraph({ data, flaggedIds = new Set(), height = 480 }) {
  const graphData = useMemo(() => {
    if (!data) return { nodes: [], links: [] };
    return {
      nodes: data.nodes.map((n) => ({ ...n })),
      links: data.links.map((l) => ({ ...l })),
    };
  }, [data]);

  if (!data || data.nodes.length === 0) {
    return (
      <div className="h-[480px] flex items-center justify-center border border-dashed border-grid rounded-lg text-ledger text-sm font-mono">
        No graph data yet — upload a CSV or generate synthetic data to populate it.
      </div>
    );
  }

  return (
    <div className="border border-grid rounded-lg overflow-hidden bg-ink">
      <ForceGraph2D
        graphData={graphData}
        height={height}
        backgroundColor="#0B0E14"
        nodeRelSize={4}
        nodeColor={(n) => (flaggedIds.has(n.id) ? "#FF5C3D" : n.risk > 0.5 ? "#E8B34C" : "#2DD9C4")}
        nodeLabel={(n) => `${n.id}${flaggedIds.has(n.id) ? " — FLAGGED" : ""}`}
        linkColor={() => "rgba(122,135,156,0.25)"}
        linkDirectionalParticles={1}
        linkDirectionalParticleWidth={1.2}
        linkDirectionalParticleColor={() => "#2DD9C4"}
        cooldownTicks={80}
      />
    </div>
  );
}
