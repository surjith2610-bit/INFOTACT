import { useState, useEffect } from "react";
import { fetchFraudAlertDetail, submitAlertFeedback } from "../api/client.js";

export default function InvestigationPanel({ alertId, accountId, onClose, onStatusUpdated }) {
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [status, setStatus] = useState("PENDING");
  const [analystNotes, setAnalystNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState("");
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    async function loadAlert() {
      setLoading(true);
      setFeedbackMsg("");
      try {
        if (alertId) {
          const res = await fetchFraudAlertDetail(alertId);
          setDetail(res.data);
          setStatus(res.data.status || "PENDING");
          setAnalystNotes(res.data.analyst_notes || "");
        } else if (accountId) {
          // Construct rich mock investigation payload for direct account selection
          setDetail({
            id: `INV-${accountId}`,
            type: "SYNDICATE_SUSPECT",
            severity: "HIGH",
            risk_score: 84.2,
            fraud_probability: 0.842,
            description: `Target account ${accountId} identified with abnormal transaction velocity and cyclic fund distribution.`,
            account_ids: [accountId, "ACC_HUB_9012", "ACC_RELAY_4410"],
            transaction_ids: ["TX_SMURF_8819", "TX_SMURF_8820", "TX_SMURF_8821"],
            explanations: [
              `Target account ${accountId} acts as a secondary smurfing funnel.`,
              "High velocity: 9 inbound micro-transactions within a 15-minute window (+32 pts).",
              "Immediate forward routing of 98.4% funds to offshore relay account (+28 pts).",
              "ML Isolation Forest graph anomaly score: -0.74 (+24 pts).",
            ],
            status: "PENDING",
          });
        }
      } catch (err) {
        console.error("[INVESTIGATION] Error loading alert detail:", err);
      } finally {
        setLoading(false);
      }
    }
    loadAlert();
  }, [alertId, accountId]);

  const handleAction = async (newStatus) => {
    if (!detail) return;
    setSubmitting(true);
    setFeedbackMsg("");
    try {
      const targetId = detail.id || detail.alert_id || alertId;
      await submitAlertFeedback(targetId, newStatus, analystNotes);
      setStatus(newStatus);
      setFeedbackMsg(`Successfully marked alert as ${newStatus.replace("_", " ")}.`);
      if (onStatusUpdated) onStatusUpdated(targetId, newStatus);
    } catch (err) {
      console.error("[INVESTIGATION] Feedback error:", err);
      setFeedbackMsg("Failed to update alert status. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!alertId && !accountId) return null;

  const riskScore = detail?.risk_score !== undefined
    ? Math.round(detail.risk_score > 1 ? detail.risk_score : detail.risk_score * 100)
    : 80;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-obsidian/80 backdrop-blur-md animate-fade-in font-sans">
      <div className="w-full max-w-xl bg-panel border-l border-slate-700/80 shadow-2xl h-full flex flex-col overflow-hidden text-slate-100">
        {/* Panel Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-obsidian/95">
          <div className="flex items-center gap-3">
            <span className="w-3 h-3 rounded-full bg-flare shadow-neon-flare animate-pulse" />
            <div>
              <h2 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                Fraud Investigation Workbench
              </h2>
              <p className="text-xs font-mono text-slate-400">
                Target Entity: <span className="text-teal font-semibold">{alertId || accountId}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition font-mono text-sm border border-transparent hover:border-slate-700"
          >
            ✕ Close
          </button>
        </div>

        {/* Panel Content Body */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400 font-mono text-sm">
            <svg className="w-8 h-8 animate-spin text-teal" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span>Retrieving Multi-Hop Graph Evidence…</span>
          </div>
        ) : detail ? (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Risk Assessment KPI Meter */}
            <div className="glass-card p-5 rounded-2xl border border-slate-800 flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-1">
                  Synthetic Risk Threat Assessment
                </div>
                <div className="text-2xl font-black text-white flex items-center gap-2">
                  <span className={riskScore >= 70 ? "text-flare" : riskScore >= 40 ? "text-gold" : "text-emerald"}>
                    {riskScore}%
                  </span>
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-mono uppercase font-bold ${
                    riskScore >= 70
                      ? "bg-flare/20 text-flare border border-flare/40"
                      : "bg-gold/20 text-gold border border-gold/40"
                  }`}>
                    {detail.severity || "HIGH"} SEVERITY
                  </span>
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  Pattern Type: <span className="text-teal font-mono">{detail.type || "Syndicate Smurfing"}</span>
                </div>
              </div>

              {/* Visual Radial Gauge Badge */}
              <div className="relative w-20 h-20 flex items-center justify-center rounded-full bg-obsidian border-2 border-slate-700">
                <div className={`text-center font-mono ${riskScore >= 70 ? "text-flare" : "text-gold"}`}>
                  <div className="text-lg font-black">{riskScore}</div>
                  <div className="text-[9px] text-slate-400">SCORE</div>
                </div>
              </div>
            </div>

            {/* Pattern Description */}
            <div className="glass-card p-4 rounded-xl border border-slate-800">
              <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-300 mb-2">
                Executive Pattern Summary
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed font-sans">
                {detail.description || "Complex laundering topology involving multi-layered starburst distribution and cyclical routing."}
              </p>
            </div>

            {/* AI Multi-Hop Graph Explanations */}
            {detail.explanations && detail.explanations.length > 0 && (
              <div className="glass-card p-4 rounded-xl border border-slate-800 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-300 flex items-center gap-2">
                  <span>🧠</span> AI Graph Engine Evidence Trace
                </h3>
                <div className="space-y-2">
                  {detail.explanations.map((exp, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-xs text-slate-300">
                      <span className="text-teal font-mono">▸</span>
                      <span className="font-sans leading-snug">{exp}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Connected Syndicate Accounts */}
            {detail.account_ids && detail.account_ids.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-300 flex items-center justify-between">
                  <span>Involved Syndicate Nodes ({detail.account_ids.length})</span>
                  <span className="text-[10px] text-slate-400 font-sans">Click to copy</span>
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {detail.account_ids.map((accId) => (
                    <button
                      key={accId}
                      onClick={() => copyToClipboard(accId)}
                      className="p-2.5 rounded-lg bg-obsidian border border-slate-800 text-left font-mono text-xs text-slate-300 hover:border-teal/50 hover:text-white transition flex items-center justify-between group"
                    >
                      <span className="truncate">{accId}</span>
                      <span className="text-[10px] text-slate-500 group-hover:text-teal">
                        {copiedId === accId ? "✓ Copied" : "Copy"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Analyst Disposition & Feedback Action Form */}
            <div className="p-4 rounded-2xl bg-obsidian/90 border border-slate-800 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-300 flex items-center gap-2">
                <span>⚖️</span> Compliance Analyst Disposition
              </h3>

              {feedbackMsg && (
                <div className="p-2.5 rounded-lg bg-teal/10 border border-teal/30 text-teal text-xs font-mono">
                  {feedbackMsg}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-[11px] font-mono text-slate-400">Analyst Investigation Notes:</label>
                <textarea
                  value={analystNotes}
                  onChange={(e) => setAnalystNotes(e.target.value)}
                  placeholder="Record multi-hop findings, law enforcement referral notes, or KYC verification details…"
                  rows={3}
                  className="w-full bg-ink border border-slate-700/80 rounded-xl p-3 text-xs text-slate-100 placeholder-slate-500 font-mono focus:outline-none focus:border-teal transition"
                />
              </div>

              <div className="grid grid-cols-3 gap-2 pt-2">
                <button
                  onClick={() => handleAction("CONFIRMED_FRAUD")}
                  disabled={submitting}
                  className="px-3 py-2 rounded-xl bg-flare hover:bg-flare-600 text-white font-mono text-xs font-bold shadow-neon-flare transition disabled:opacity-50"
                >
                  🚨 Confirm Fraud
                </button>
                <button
                  onClick={() => handleAction("ESCALATED")}
                  disabled={submitting}
                  className="px-3 py-2 rounded-xl bg-gold hover:bg-yellow-500 text-obsidian font-mono text-xs font-bold shadow-gold transition disabled:opacity-50"
                >
                  ⚠️ Escalate Ring
                </button>
                <button
                  onClick={() => handleAction("DISMISSED_FALSE_POSITIVE")}
                  disabled={submitting}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs font-bold border border-slate-700 transition disabled:opacity-50"
                >
                  ✅ Clear Benign
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400 font-mono text-xs">
            Alert details not found.
          </div>
        )}
      </div>
    </div>
  );
}
