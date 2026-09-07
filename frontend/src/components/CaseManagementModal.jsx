import React, { useState, useEffect } from "react";
import {
  fetchCases,
  fetchCaseDetail,
  createCase,
  addCaseNote,
  updateCaseStatus,
  exportCaseDossier,
  getErrorMessage,
} from "../api/client.js";
import { formatINR } from "../utils/currency.js";

export default function CaseManagementModal({
  isOpen,
  onClose,
  initialSuspectNode = null,
  themeMode = "dark",
}) {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedCase, setSelectedCase] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [severityFilter, setSeverityFilter] = useState("ALL");

  // New Case Form Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSuspectAcc, setNewSuspectAcc] = useState(initialSuspectNode?.id || "");
  const [newSeverity, setNewSeverity] = useState("HIGH");
  const [newAmount, setNewAmount] = useState("");
  const [newNote, setNewNote] = useState("");
  const [assignedTo, setAssignedTo] = useState("Senior AML Investigator");
  const [creating, setCreating] = useState(false);

  // Add Note state
  const [noteContent, setNoteContent] = useState("");
  const [noteAuthor, setNoteAuthor] = useState("AML Investigator");
  const [addingNote, setAddingNote] = useState(false);

  // Printable Dossier state
  const [dossierData, setDossierData] = useState(null);
  const [loadingDossier, setLoadingDossier] = useState(false);

  const loadCases = async () => {
    setLoading(true);
    try {
      const res = await fetchCases({
        status: statusFilter,
        severity: severityFilter,
        search: searchQuery,
      });
      setCases(res.data.cases || []);
      if (res.data.cases && res.data.cases.length > 0 && !selectedCase) {
        setSelectedCase(res.data.cases[0]);
      }
    } catch (err) {
      console.error("Error loading cases:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCases();
  }, [statusFilter, severityFilter, searchQuery]);

  useEffect(() => {
    if (initialSuspectNode) {
      setNewSuspectAcc(initialSuspectNode.id);
      setNewTitle(`Investigation: ${initialSuspectNode.name || initialSuspectNode.id}`);
      setShowCreateModal(true);
    }
  }, [initialSuspectNode]);

  const handleCreateCase = async (e) => {
    e.preventDefault();
    if (!newSuspectAcc.trim()) return;
    setCreating(true);
    try {
      const res = await createCase({
        suspect_account_id: newSuspectAcc.trim(),
        title: newTitle.trim() || `AML Investigation: ${newSuspectAcc.trim()}`,
        severity: newSeverity,
        total_amount_at_risk: parseFloat(newAmount) || 0.0,
        assigned_to: assignedTo,
        initial_note: newNote || "Case initialized from detection workbench.",
      });
      setShowCreateModal(false);
      setNewTitle("");
      setNewAmount("");
      setNewNote("");
      await loadCases();
      if (res.data.case) {
        setSelectedCase(res.data.case);
      }
    } catch (err) {
      alert(getErrorMessage(err, "Failed to create AML case."));
    } finally {
      setCreating(false);
    }
  };

  const handleAddNote = async () => {
    if (!selectedCase || !noteContent.trim()) return;
    setAddingNote(true);
    try {
      const res = await addCaseNote(selectedCase.case_id, {
        author: noteAuthor,
        content: noteContent.trim(),
      });
      setSelectedCase(res.data.case);
      setNoteContent("");
      setCases((prev) =>
        prev.map((c) => (c.case_id === selectedCase.case_id ? res.data.case : c))
      );
    } catch (err) {
      alert(getErrorMessage(err, "Failed to add investigator note."));
    } finally {
      setAddingNote(false);
    }
  };

  const handleStatusChange = async (newStatus) => {
    if (!selectedCase) return;
    try {
      const res = await updateCaseStatus(selectedCase.case_id, {
        status: newStatus,
        user: noteAuthor,
      });
      setSelectedCase(res.data.case);
      setCases((prev) =>
        prev.map((c) => (c.case_id === selectedCase.case_id ? res.data.case : c))
      );
    } catch (err) {
      alert(getErrorMessage(err, "Failed to update case workflow status."));
    }
  };

  const handleExportDossier = async (caseId) => {
    setLoadingDossier(true);
    try {
      const res = await exportCaseDossier(caseId);
      setDossierData(res.data);
      setTimeout(() => {
        window.print();
      }, 300);
    } catch (err) {
      alert(getErrorMessage(err, "Failed to export AML dossier."));
    } finally {
      setLoadingDossier(false);
    }
  };

  return (
    <div className="w-full space-y-4">
      {/* Top Header & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl glass-panel border border-rose-950/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-600 to-rose-950 flex items-center justify-center text-white shadow-lg border border-rose-500/40">
            📁
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              AML Case Management & Dossier System
              <span className="px-2 py-0.5 rounded-full text-[11px] bg-rose-500/20 text-rose-300 font-mono">
                {cases.length} Active Dossiers
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Track suspicious financial syndicate networks, manage investigator notes, and export compliance reports.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="text"
            placeholder="Search cases, accounts, titles..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3.5 py-1.5 text-xs rounded-xl bg-black/50 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-rose-500/60 w-56 font-mono"
          />

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-xl bg-black/50 border border-white/10 text-slate-300 focus:outline-none focus:border-rose-500/60"
          >
            <option value="ALL">All Statuses</option>
            <option value="OPEN">Open</option>
            <option value="UNDER_INVESTIGATION">Under Investigation</option>
            <option value="ESCALATED_FIU">Escalated to FIU</option>
            <option value="CLOSED_RESOLVED">Closed / Resolved</option>
            <option value="FALSE_POSITIVE">False Positive</option>
          </select>

          {/* Severity Filter */}
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-xl bg-black/50 border border-white/10 text-slate-300 focus:outline-none focus:border-rose-500/60"
          >
            <option value="ALL">All Severities</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>

          <button
            onClick={() => setShowCreateModal(true)}
            className="px-3.5 py-1.5 bg-gradient-to-r from-rose-700 to-rose-900 hover:from-rose-600 hover:to-rose-800 text-white font-semibold text-xs rounded-xl shadow-lg border border-rose-500/40 transition flex items-center gap-1.5"
          >
            + Create New Case
          </button>
        </div>
      </div>

      {/* Main Split Workbench: Case List (Left) & Case Dossier Details (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: Case Cards List */}
        <div className="lg:col-span-5 space-y-2.5 max-h-[640px] overflow-y-auto pr-1">
          {cases.length === 0 ? (
            <div className="p-8 text-center glass-panel rounded-2xl border border-white/5 text-slate-400 text-xs">
              No cases matching filter criteria. Click "+ Create New Case" to file an investigation.
            </div>
          ) : (
            cases.map((c) => {
              const isSelected = selectedCase?.case_id === c.case_id;
              const isCrit = c.severity === "CRITICAL";
              return (
                <div
                  key={c.case_id}
                  onClick={() => setSelectedCase(c)}
                  className={`p-4 rounded-2xl cursor-pointer transition-all border ${
                    isSelected
                      ? "bg-rose-950/40 border-rose-500/60 shadow-lg shadow-rose-950/40"
                      : "glass-panel border-white/5 hover:border-white/20"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <span className="text-[10px] font-mono text-rose-400 font-bold block">
                        {c.case_id}
                      </span>
                      <h4 className="text-sm font-bold text-white line-clamp-1">{c.title}</h4>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        isCrit
                          ? "bg-red-500/20 text-red-300 border border-red-500/40"
                          : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                      }`}
                    >
                      {c.severity}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-300 pt-2 border-t border-white/5">
                    <div>
                      <span className="text-[10px] text-slate-500 block">SUSPECT</span>
                      <span className="font-mono text-white font-semibold">
                        {c.suspect_account_name || c.suspect_account_id}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-500 block">AMOUNT AT RISK</span>
                      <span className="font-mono text-emerald-400 font-bold">
                        {formatINR(c.total_amount_at_risk || 0)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 mt-2 border-t border-white/5">
                    <span className="px-2 py-0.5 rounded bg-white/5 text-[10px] font-mono">
                      Status: {c.status?.replace("_", " ")}
                    </span>
                    <span>{new Date(c.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right Column: Case Dossier Detail & Activity Log */}
        <div className="lg:col-span-7">
          {selectedCase ? (
            <div className="glass-panel-elevated rounded-2xl border border-rose-950/40 p-5 space-y-4">
              {/* Dossier Header */}
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 rounded bg-rose-900/60 text-rose-200 text-xs font-mono font-bold">
                      {selectedCase.case_id}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-white/10 text-slate-200 text-xs font-mono">
                      Risk Score: {Math.round(selectedCase.risk_score || 85)}/100
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-white">{selectedCase.title}</h3>
                  <p className="text-xs text-slate-400 font-mono pt-1">
                    Assigned: {selectedCase.assigned_to} • Deadline: {new Date(selectedCase.sla_deadline).toLocaleDateString()}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleExportDossier(selectedCase.case_id)}
                    disabled={loadingDossier}
                    className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white font-semibold text-xs rounded-xl border border-white/20 transition flex items-center gap-1.5"
                  >
                    🖨️ Export PDF Dossier
                  </button>
                </div>
              </div>

              {/* Status Workflow Selector */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-black/40 border border-white/5">
                <span className="text-xs text-slate-300 font-semibold">Workflow Status:</span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "OPEN",
                    "UNDER_INVESTIGATION",
                    "ESCALATED_FIU",
                    "CLOSED_RESOLVED",
                    "FALSE_POSITIVE",
                  ].map((st) => (
                    <button
                      key={st}
                      onClick={() => handleStatusChange(st)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                        selectedCase.status === st
                          ? "bg-rose-700 text-white font-bold shadow-md"
                          : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      {st.replace("_", " ")}
                    </button>
                  ))}
                </div>
              </div>

              {/* Suspect Profile & Financial Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                <div className="p-3 rounded-xl bg-black/40 border border-white/5">
                  <span className="text-[10px] text-slate-500 block">SUSPECT ACCOUNT</span>
                  <span className="font-mono text-white font-bold">{selectedCase.suspect_account_id}</span>
                </div>
                <div className="p-3 rounded-xl bg-black/40 border border-white/5">
                  <span className="text-[10px] text-slate-500 block">BANK & BRANCH</span>
                  <span className="text-slate-200 font-medium">{selectedCase.suspect_bank || "Central Bank"}</span>
                </div>
                <div className="p-3 rounded-xl bg-black/40 border border-white/5">
                  <span className="text-[10px] text-slate-500 block">LOCATION</span>
                  <span className="text-slate-200 font-medium">{selectedCase.suspect_location || "Mumbai, India"}</span>
                </div>
                <div className="p-3 rounded-xl bg-black/40 border border-white/5">
                  <span className="text-[10px] text-slate-500 block">TOTAL AT RISK</span>
                  <span className="font-mono text-emerald-400 font-bold">
                    {formatINR(selectedCase.total_amount_at_risk || 0)}
                  </span>
                </div>
              </div>

              {/* Summary */}
              {selectedCase.summary && (
                <div className="p-3 rounded-xl bg-black/40 border border-white/5 text-xs text-slate-300">
                  <span className="text-[10px] text-slate-500 block font-bold mb-1">CASE SUMMARY</span>
                  {selectedCase.summary}
                </div>
              )}

              {/* Investigator Audit Notes & Activity Trail */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
                  <span className="text-xs font-bold text-rose-300 uppercase tracking-wider">
                    Investigation Log & Audit Trail ({selectedCase.notes_log?.length || 0})
                  </span>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {(selectedCase.notes_log || []).map((note, idx) => (
                    <div
                      key={note.id || idx}
                      className="p-3 rounded-xl bg-black/50 border border-white/5 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span className="font-bold text-rose-400">{note.author}</span>
                        <span>{new Date(note.timestamp).toLocaleString()}</span>
                      </div>
                      <p className="text-slate-200">{note.content}</p>
                    </div>
                  ))}
                </div>

                {/* Add Note Input */}
                <div className="flex gap-2 pt-2 border-t border-white/5">
                  <input
                    type="text"
                    placeholder="Append compliance finding or interview log..."
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddNote();
                    }}
                    className="flex-1 px-3 py-2 text-xs rounded-xl bg-black/60 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-rose-500/60 font-mono"
                  />
                  <button
                    onClick={handleAddNote}
                    disabled={addingNote || !noteContent.trim()}
                    className="px-4 py-2 bg-rose-800 hover:bg-rose-700 disabled:opacity-50 text-white font-semibold text-xs rounded-xl transition"
                  >
                    Add Note
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center glass-panel rounded-2xl border border-white/5 text-slate-400 text-xs">
              Select a case on the left to inspect dossier details or file a new case.
            </div>
          )}
        </div>
      </div>

      {/* Create New Case Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg glass-panel-elevated rounded-2xl border border-rose-500/40 p-6 shadow-2xl space-y-4 animate-scale-in">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>📁</span> File New AML Investigation Case
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateCase} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Case Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Operation Starburst: Smurfing Cluster into Cayman Shell"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-white focus:outline-none focus:border-rose-500/60 font-mono text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Suspect Account ID</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. SHELL_OFFSHORE_01"
                    value={newSuspectAcc}
                    onChange={(e) => setNewSuspectAcc(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-white focus:outline-none focus:border-rose-500/60 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Severity Level</label>
                  <select
                    value={newSeverity}
                    onChange={(e) => setNewSeverity(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-slate-200 focus:outline-none focus:border-rose-500/60 text-xs"
                  >
                    <option value="CRITICAL">Critical</option>
                    <option value="HIGH">High</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="LOW">Low</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Estimated Amount At Risk (₹)</label>
                  <input
                    type="number"
                    placeholder="e.g. 8175500"
                    value={newAmount}
                    onChange={(e) => setNewAmount(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-white focus:outline-none focus:border-rose-500/60 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Lead Investigator</label>
                  <input
                    type="text"
                    value={assignedTo}
                    onChange={(e) => setAssignedTo(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-white focus:outline-none focus:border-rose-500/60 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Initial Compliance Findings</label>
                <textarea
                  rows={3}
                  placeholder="Describe laundering topology, velocity spikes, or SAR threshold avoidance..."
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-white focus:outline-none focus:border-rose-500/60 text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-5 py-2 bg-gradient-to-r from-rose-700 to-rose-900 hover:from-rose-600 hover:to-rose-800 text-white font-bold rounded-xl shadow-lg border border-rose-500/40 transition"
                >
                  {creating ? "Filing Case..." : "File Official Case"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Hidden Printable AML Case Dossier HTML (Rendered during Print/PDF export) */}
      {dossierData && (
        <div className="print-only hidden p-8 text-black bg-white space-y-6 font-serif">
          <div className="border-b-2 border-black pb-4 flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold uppercase tracking-wider">
                CONFIDENTIAL FINANCIAL INTELLIGENCE DOSSIER
              </h1>
              <p className="text-sm font-mono text-gray-700">
                CASE REF: {dossierData.case?.case_id} • DATE: {new Date().toLocaleString()}
              </p>
            </div>
            <div className="text-right text-xs">
              <span className="font-bold border border-black px-2 py-1">
                SEVERITY: {dossierData.case?.severity}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-bold">1. EXECUTIVE SUMMARY</h2>
            <p className="text-sm">{dossierData.case?.title}</p>
            <p className="text-xs text-gray-800">{dossierData.case?.summary}</p>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-bold">2. PRIMARY SUSPECT PROFILE</h2>
            <table className="w-full border border-black text-xs">
              <tbody>
                <tr className="border-b border-black">
                  <td className="p-2 font-bold bg-gray-100 w-1/4">Account ID</td>
                  <td className="p-2 font-mono">{dossierData.case?.suspect_account_id}</td>
                  <td className="p-2 font-bold bg-gray-100 w-1/4">Account Holder</td>
                  <td className="p-2">{dossierData.case?.suspect_account_name}</td>
                </tr>
                <tr className="border-b border-black">
                  <td className="p-2 font-bold bg-gray-100">Financial Institution</td>
                  <td className="p-2">{dossierData.case?.suspect_bank}</td>
                  <td className="p-2 font-bold bg-gray-100">Jurisdiction / Location</td>
                  <td className="p-2">{dossierData.case?.suspect_location}</td>
                </tr>
                <tr>
                  <td className="p-2 font-bold bg-gray-100">Compliance Entity Tag</td>
                  <td className="p-2">{dossierData.case?.entity_tag}</td>
                  <td className="p-2 font-bold bg-gray-100">Total Volume At Risk</td>
                  <td className="p-2 font-bold">{formatINR(dossierData.case?.total_amount_at_risk || 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-bold">3. AUDIT NOTES & INVESTIGATION TIMELINE</h2>
            <div className="space-y-2 text-xs">
              {(dossierData.case?.notes_log || []).map((n, i) => (
                <div key={i} className="border-l-2 border-black pl-3 py-1">
                  <span className="font-bold">{n.author}</span> ({new Date(n.timestamp).toLocaleString()}):
                  <p>{n.content}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-6 border-t border-black text-[10px] text-gray-600 flex justify-between">
            <span>{dossierData.disclaimer}</span>
            <span>Page 1 of 1</span>
          </div>
        </div>
      )}
    </div>
  );
}
