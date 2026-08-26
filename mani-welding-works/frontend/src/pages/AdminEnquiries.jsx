import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { Search, Trash2, CheckCircle, RefreshCw, Flame, ArrowLeft, Phone, Mail, Calendar } from "lucide-react";

export default function AdminEnquiries() {
  const [enquiries, setEnquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [error, setError] = useState("");

  const fetchEnquiries = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await axios.get("/api/enquiries");
      setEnquiries(res.data.enquiries || []);
    } catch (err) {
      console.error("Failed to load enquiries:", err);
      setError("Failed to connect to backend server. Make sure backend is running on port 5002.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEnquiries();
  }, []);

  const handleUpdateStatus = async (id, newStatus) => {
    try {
      await axios.patch(`/api/enquiries/${id}/status`, { status: newStatus });
      setEnquiries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, status: newStatus } : e))
      );
    } catch (err) {
      alert("Failed to update status.");
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this enquiry lead?")) return;
    try {
      await axios.delete(`/api/enquiries/${id}`);
      setEnquiries((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      alert("Failed to delete enquiry.");
    }
  };

  const filteredEnquiries = useMemo(() => {
    return enquiries.filter((e) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !q ||
        e.name.toLowerCase().includes(q) ||
        e.mobile.includes(q) ||
        (e.email && e.email.toLowerCase().includes(q)) ||
        e.service.toLowerCase().includes(q) ||
        e.message.toLowerCase().includes(q);

      const matchesStatus = statusFilter === "ALL" || e.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [enquiries, searchQuery, statusFilter]);

  const metrics = useMemo(() => {
    const total = enquiries.length;
    const newLeads = enquiries.filter((e) => e.status === "NEW").length;
    const contacted = enquiries.filter((e) => e.status === "CONTACTED").length;
    const completed = enquiries.filter((e) => e.status === "COMPLETED").length;
    return { total, newLeads, contacted, completed };
  }, [enquiries]);

  const formatDate = (ts) => {
    if (!ts) return "N/A";
    try {
      return new Date(ts).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch {
      return ts;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Navigation Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="p-2.5 rounded-xl bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors border border-slate-700"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold font-industrial tracking-tight text-white flex items-center gap-2 uppercase">
                <Flame className="w-6 h-6 text-orange-500" />
                Mani Welding <span className="text-orange-500">Lead Dashboard</span>
              </h1>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                URL: /admin/enquiries | Real-time Customer Inquiries Database
              </p>
            </div>
          </div>

          <button
            onClick={fetchEnquiries}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono font-bold transition-colors border border-slate-700 flex items-center gap-2 self-start"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh Leads</span>
          </button>
        </div>

        {/* Metrics Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="glass-card p-5 rounded-2xl border border-slate-800 shadow-lg relative overflow-hidden">
            <div className="text-xs text-slate-400 font-mono uppercase">Total Enquiries</div>
            <div className="text-3xl font-extrabold text-white mt-1 font-mono">{metrics.total}</div>
            <div className="text-[11px] text-slate-500 mt-1">All time leads received</div>
          </div>

          <div className="glass-card p-5 rounded-2xl border border-orange-500/40 shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 w-2 h-full bg-orange-500" />
            <div className="text-xs text-slate-400 font-mono uppercase">New Leads</div>
            <div className="text-3xl font-extrabold text-orange-400 mt-1 font-mono">{metrics.newLeads}</div>
            <div className="text-[11px] text-orange-300 mt-1">Awaiting initial call</div>
          </div>

          <div className="glass-card p-5 rounded-2xl border border-sky-500/40 shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 w-2 h-full bg-sky-500" />
            <div className="text-xs text-slate-400 font-mono uppercase">Contacted</div>
            <div className="text-3xl font-extrabold text-sky-400 mt-1 font-mono">{metrics.contacted}</div>
            <div className="text-[11px] text-slate-400 mt-1">Quotes in progress</div>
          </div>

          <div className="glass-card p-5 rounded-2xl border border-emerald-500/40 shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 w-2 h-full bg-emerald-500" />
            <div className="text-xs text-slate-400 font-mono uppercase">Completed</div>
            <div className="text-3xl font-extrabold text-emerald-400 mt-1 font-mono">{metrics.completed}</div>
            <div className="text-[11px] text-emerald-300 mt-1">Jobs delivered</div>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="relative w-full md:w-96">
            <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search by name, mobile, service, or message..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
            />
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            <span className="text-xs font-mono text-slate-400">Filter Status:</span>
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
              {["ALL", "NEW", "CONTACTED", "COMPLETED"].map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                    statusFilter === st ? "bg-orange-600 text-white shadow" : "text-slate-400 hover:text-white"
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-rose-500/10 border border-rose-500/40 text-rose-300 p-4 rounded-xl text-xs">
            {error}
          </div>
        )}

        {/* Enquiries Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-3.5 px-4">Customer Info</th>
                  <th className="py-3.5 px-4">Service Requested</th>
                  <th className="py-3.5 px-4">Message / Requirements</th>
                  <th className="py-3.5 px-4">Date Submitted</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filteredEnquiries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-500 text-sm">
                      No enquiries found matching criteria.
                    </td>
                  </tr>
                ) : (
                  filteredEnquiries.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-800/50 transition-colors">
                      {/* Customer Info */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-white text-sm">{e.name}</div>
                        <div className="flex items-center gap-1.5 text-emerald-400 font-mono mt-0.5">
                          <Phone className="w-3 h-3" />
                          <a href={`tel:${e.mobile}`} className="hover:underline">{e.mobile}</a>
                        </div>
                        {e.email && (
                          <div className="text-[11px] text-slate-400 mt-0.5">{e.email}</div>
                        )}
                      </td>

                      {/* Service Requested */}
                      <td className="py-3.5 px-4">
                        <span className="px-2.5 py-1 rounded-lg bg-orange-500/10 border border-orange-500/30 text-orange-400 text-[11px] font-semibold">
                          {e.service}
                        </span>
                      </td>

                      {/* Message */}
                      <td className="py-3.5 px-4 text-slate-300 max-w-xs leading-relaxed">
                        {e.message}
                      </td>

                      {/* Date */}
                      <td className="py-3.5 px-4 text-slate-400 font-mono text-[11px] whitespace-nowrap">
                        {formatDate(e.created_at)}
                      </td>

                      {/* Status Selector */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <select
                          value={e.status || "NEW"}
                          onChange={(ev) => handleUpdateStatus(e.id, ev.target.value)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold focus:outline-none border ${
                            e.status === "NEW"
                              ? "bg-orange-500/20 text-orange-400 border-orange-500/40"
                              : e.status === "CONTACTED"
                              ? "bg-sky-500/20 text-sky-400 border-sky-500/40"
                              : "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                          }`}
                        >
                          <option value="NEW" className="bg-slate-900 text-orange-400">NEW</option>
                          <option value="CONTACTED" className="bg-slate-900 text-sky-400">CONTACTED</option>
                          <option value="IN_PROGRESS" className="bg-slate-900 text-amber-400">IN PROGRESS</option>
                          <option value="COMPLETED" className="bg-slate-900 text-emerald-400">COMPLETED</option>
                        </select>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <button
                          onClick={() => handleDelete(e.id)}
                          className="p-2 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white border border-rose-500/30 transition-colors"
                          title="Delete Enquiry"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
