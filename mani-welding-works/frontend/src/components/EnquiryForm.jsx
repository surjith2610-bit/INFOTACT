import React, { useState } from "react";
import axios from "axios";
import { Send, Phone, CheckCircle2, AlertCircle, Flame } from "lucide-react";

export default function EnquiryForm() {
  const [formData, setFormData] = useState({
    name: "",
    mobile: "",
    email: "",
    service: "Grill Gate Fabrication",
    message: ""
  });

  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setSuccessMsg("");
    setErrorMsg("");

    try {
      const res = await axios.post("/api/enquiry", formData);
      setSuccessMsg(res.data.message || "Enquiry submitted successfully! We will call you shortly.");
      setFormData({
        name: "",
        mobile: "",
        email: "",
        service: "Grill Gate Fabrication",
        message: ""
      });
    } catch (err) {
      console.error("Enquiry submission error:", err);
      const msg = err.response?.data?.error || "Failed to submit enquiry. Please call us directly at 6382970348.";
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section id="enquiry" className="py-20 bg-slate-950 relative">
      <div className="max-w-5xl mx-auto px-6">
        <div className="glass-card rounded-3xl p-8 sm:p-12 border border-slate-800 shadow-2xl spark-glow relative overflow-hidden">
          {/* Subtle Background Glow */}
          <div className="absolute top-0 right-0 w-72 h-72 bg-orange-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-12 items-center">
            {/* Left Description Column */}
            <div className="lg:col-span-2 space-y-6 text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/30 text-orange-400 text-xs font-semibold uppercase tracking-widest">
                <Flame className="w-3.5 h-3.5" /> Instant Estimate
              </div>

              <h2 className="text-3xl sm:text-4xl font-extrabold font-industrial uppercase text-white leading-tight">
                Request A <span className="text-orange-500">Free Quote</span>
              </h2>

              <p className="text-slate-300 text-sm leading-relaxed">
                Fill in your project details and measurements. Our master fabricator will review your inquiry and get back to you within 30 minutes with an exact estimate.
              </p>

              <div className="pt-4 border-t border-slate-800 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
                    <Phone className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs text-slate-400 font-mono">Direct Phone Call</div>
                    <a href="tel:6382970348" className="text-white font-bold text-base hover:text-orange-400 transition-colors">
                      6382970348
                    </a>
                  </div>
                </div>

                <div className="text-xs text-slate-400 font-mono">
                  📍 Workshop Address: Mani Welding Works, Main Road, Industrial Estate, Tamil Nadu
                </div>
              </div>
            </div>

            {/* Right Form Column */}
            <div className="lg:col-span-3">
              {successMsg && (
                <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 text-sm flex items-center gap-3 animate-fade-in">
                  <CheckCircle2 className="w-6 h-6 flex-shrink-0 text-emerald-400" />
                  <div>
                    <div className="font-bold">Submission Confirmed</div>
                    <div className="text-xs">{successMsg}</div>
                  </div>
                </div>
              )}

              {errorMsg && (
                <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-300 text-sm flex items-center gap-3 animate-fade-in">
                  <AlertCircle className="w-6 h-6 flex-shrink-0 text-rose-400" />
                  <div>
                    <div className="font-bold">Submission Error</div>
                    <div className="text-xs">{errorMsg}</div>
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5 text-left">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                    Your Full Name *
                  </label>
                  <input
                    type="text"
                    name="name"
                    required
                    placeholder="e.g. Ramesh Kumar"
                    value={formData.name}
                    onChange={handleChange}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 transition-colors"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Mobile Number *
                    </label>
                    <input
                      type="tel"
                      name="mobile"
                      required
                      placeholder="e.g. 9876543210"
                      value={formData.mobile}
                      onChange={handleChange}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Email Address (Optional)
                    </label>
                    <input
                      type="email"
                      name="email"
                      placeholder="e.g. ramesh@gmail.com"
                      value={formData.email}
                      onChange={handleChange}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                    Service Required *
                  </label>
                  <select
                    name="service"
                    value={formData.service}
                    onChange={handleChange}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-orange-500 transition-colors"
                  >
                    <option value="Grill Gate Fabrication">Grill Gate Fabrication</option>
                    <option value="Staircase Railings">Staircase & Balcony Railings</option>
                    <option value="Industrial Welding">Industrial Welding & Roofing Sheds</option>
                    <option value="Custom Steel Works">Custom Steel & Window Grills</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                    Project Requirements / Measurements *
                  </label>
                  <textarea
                    name="message"
                    required
                    rows={4}
                    placeholder="Describe gate dimensions (e.g. 10x6 feet), preferred design style (Laser cut, Iron), or site location..."
                    value={formData.message}
                    onChange={handleChange}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 transition-colors resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-4 rounded-xl bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white font-bold text-sm uppercase tracking-wider shadow-lg spark-glow transition-all duration-300 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <span>Submitting Enquiry...</span>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>Submit Enquiry Now</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
