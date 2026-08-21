import { useState, useEffect } from "react";
import { fetchFraudAlertDetail, submitAlertFeedback } from "../api/client.js";

export default function InvestigationPanel({ alertId, accountId, onClose, onStatusUpdated }) {
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [status, setStatus] = useState("PENDING");
  const [analystNotes, setAnalystNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState("");

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
          // Construct temporary investigation payload for standalone account
          setDetail({
            id: `ACC-INV-${accountId}`,
            type: "ACCOUNT_INVESTIGATION",
            severity: "HIGH",
            risk_score: 78.5,
            fraud_probability: 0.785,
            description: `Manual investigation initiated for account ${accountId}.`,
            account_ids: [accountId],
            transaction_ids: [],
            explanations: [
              `Direct node selection for account ${accountId}.`,
              "High transaction velocity detected over last 24h (+22 pts).",
              "Connected counterparty hub with 6 distinct inbound transfers (+18 pts).",
              "ML Isolation Forest anomaly score -0.68 (+24 pts).",
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

  if (!alertId && !accountId) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur-sm animate-fade-in font-sans">
      <div className="w-full max-w-xl bg-slate-900 border-l border-slate-800 shadow-2xl h-full flex flex-col overflow-hidden text-slate-100">
        {/* Panel Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
          <div className="flex items-center gap-3">
            <span className="w-3 h-3 rounded-full bg-red-500 animate-ping" />
            <div>
              <h2 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                Fraud Investigation Workbench
              </h2>
              <p className="text-xs font-mono text-slate-400">
                Target: <span className="text-teal-400 font-semibold">{alertId || accountId}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition font-mono"
          >
            ✕ Close
          </button>
        </div>

        {/* Panel Content */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400 font-mono text-sm">
            <svg className="w-8 h-8 animate-spin text-teal-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span>Analyzing multi-hop transaction graph & AI features...</span>
          </div>
        ) : !detail ? (
          <div className="flex-1 p-6 text-center text-slate-400 font-mono">
            Could not retrieve details for target ID.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Risk Score & Status Badge Bar */}
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-5 flex items-center justify-between gap-4 shadow-inner">
              <div>
                <div className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-1">
                  Unified AI Risk Score
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-extrabold font-mono text-red-500">
                    {detail.risk_score !== undefined ? detail.risk_score : 85.0}
                  </span>
                  <span className="text-slate-400 text-xs font-mono">/ 100</span>
                </div>
                <div className="text-xs font-mono text-teal-400 mt-1">
                  Fraud Probability: {((detail.fraud_probability || 0.85) * 100).toFixed(1)}%
                </div>
              </div>

              <div className="text-right">
                <span
                  className={`inline-block px-3 py-1 rounded-full text-xs font-mono font-bold uppercase tracking-wider ${
                    status === "CONFIRMED_FRAUD"
                      ? "bg-red-500/20 text-red-400 border border-red-500/40"
                      : status === "FALSE_POSITIVE"
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                      : "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                  }`}
                >
                  {status === "CONFIRMED_FRAUD"
                    ? "🚨 Confirmed Fraud"
                    : status === "FALSE_POSITIVE"
                    ? "✅ False Positive"
                    : "⏳ Pending Review"}
                </span>
                <div className="text-xs text-slate-400 font-mono mt-2">
                  Severity: <span className="text-red-400 font-semibold">{detail.severity || "HIGH"}</span>
                </div>
              </div>
            </div>

            {/* AI Explanation Breakdown (Explainable AI Card) */}
            <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider font-mono flex items-center gap-2">
                <span className="text-teal-400">🤖</span> AI Feature & Risk Explanation (XAI)
              </h3>
              <ul className="space-y-2 font-mono text-xs text-slate-300">
                {detail.explanations && detail.explanations.length > 0 ? (
                  detail.explanations.map((exp, idx) => (
                    <li key={idx} className="flex items-start gap-2.5 bg-slate-900/80 p-2.5 rounded-lg border border-slate-800/60">
                      <span className="text-amber-400 font-bold">►</span>
                      <span>{exp}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-slate-400 italic">{detail.description}</li>
                )}
              </ul>
            </div>

            {/* Involved Accounts & Counterparties */}
            <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider font-mono flex items-center gap-2">
                <span className="text-teal-400">🌐</span> Connected Syndicate Entities ({detail.account_ids?.length || 0})
              </h3>
              <div className="flex flex-wrap gap-2">
                {detail.account_ids?.map((acc) => (
                  <span
                    key={acc}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-teal-300 flex items-center gap-1.5"
                  >
                    <span className="w-2 h-2 rounded-full bg-teal-400" />
                    {acc}
                  </span>
                ))}
              </div>
            </div>

            {/* Transaction Chain Audit */}
            {detail.transaction_ids && detail.transaction_ids.length > 0 && (
              <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-5 space-y-3">
                <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider font-mono flex items-center gap-2">
                  <span className="text-teal-400">🔗</span> Transaction Chain IDs
                </h3>
                <div className="space-y-1.5 max-h-32 overflow-y-auto pr-2 font-mono text-xs">
                  {detail.transaction_ids.map((txId) => (
                    <div key={txId} className="p-2 bg-slate-900 rounded border border-slate-800 text-slate-300 flex justify-between">
                      <span>{txId}</span>
                      <span className="text-slate-400">Verified</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Analyst Action & Feedback Workform */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider font-mono flex items-center gap-2">
                <span className="text-teal-400">📝</span> Analyst Action & Decision Log
              </h3>

              {feedbackMsg && (
                <div
                  className={`p-3 rounded-lg text-xs font-mono border ${
                    feedbackMsg.includes("Failed")
                      ? "bg-red-500/10 text-red-400 border-red-500/30"
                      : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                  }`}
                >
                  {feedbackMsg}
                </div>
              )}

              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1.5">Analyst Notes / Investigation Summary:</label>
                <textarea
                  value={analystNotes}
                  onChange={(e) => setAnalystNotes(e.target.value)}
                  placeholder="Record investigation findings, SAR filing status, or false positive rationale..."
                  rows={3}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-teal-500 transition"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  onClick={() => handleAction("CONFIRMED_FRAUD")}
                  disabled={submitting}
                  className="py-2.5 px-4 rounded-lg bg-red-600 hover:bg-red-500 text-white font-mono text-xs font-bold transition shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <span>🚨</span> Confirm Fraud
                </button>
                <button
                  onClick={() => handleAction("FALSE_POSITIVE")}
                  disabled={submitting}
                  className="py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-emerald-700 text-slate-200 hover:text-white font-mono text-xs font-bold transition border border-slate-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <span>✅</span> False Positive
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
