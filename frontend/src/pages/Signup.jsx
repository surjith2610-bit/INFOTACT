import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import GraphBackdrop from "../components/GraphBackdrop.jsx";
import { signup, verifyOtp } from "../api/client.js";

export default function Signup() {
  const navigate = useNavigate();
  const [step, setStep] = useState("details"); // "details" | "otp"
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleDetailsSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await signup(form);
      if (data.dev_otp) {
        setInfo(`Verification code generated: ${data.dev_otp} (Auto-filled for testing)`);
        setOtp(data.dev_otp);
      } else {
        setInfo(`We sent a 6-digit code to ${form.email}. Check your inbox or backend console.`);
      }
      setStep("otp");
    } catch (err) {
      setError(err.response?.data?.detail || "Signup failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleOtpSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await verifyOtp({ email: form.email, otp });
      localStorage.setItem("fingraph_token", data.access_token);
      navigate("/dashboard");
    } catch (err) {
      setError(err.response?.data?.detail || "Invalid code.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden ledger-bg">
      <GraphBackdrop />
      <div className="relative z-10 min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <div className="inline-flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-teal shadow-[0_0_12px_2px_rgba(45,217,196,0.6)]" />
              <span className="font-mono text-xs tracking-[0.3em] text-ledger uppercase">
                Syndicate Analytics
              </span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">
              {step === "details" ? "Create an account" : "Verify your email"}
            </h1>
            <p className="text-ledger text-sm mt-1">
              {step === "details" ? "Get a seat on the analyst desk." : info}
            </p>
          </div>

          {step === "details" ? (
            <form
              onSubmit={handleDetailsSubmit}
              className="bg-panel/90 backdrop-blur border border-grid rounded-xl p-6 space-y-4"
            >
              {error && (
                <div className="text-flare text-sm font-mono bg-flare/10 border border-flare/30 rounded-md px-3 py-2">
                  {error}
                </div>
              )}
              <div>
                <label className="text-xs font-mono text-ledger uppercase tracking-wide">Full name</label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="mt-1 w-full bg-ink border border-grid rounded-md px-3 py-2 outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                  placeholder="Ada Analyst"
                />
              </div>
              <div>
                <label className="text-xs font-mono text-ledger uppercase tracking-wide">Email</label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="mt-1 w-full bg-ink border border-grid rounded-md px-3 py-2 outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                  placeholder="analyst@bank.com"
                />
              </div>
              <div>
                <label className="text-xs font-mono text-ledger uppercase tracking-wide">Password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="mt-1 w-full bg-ink border border-grid rounded-md px-3 py-2 outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                  placeholder="At least 8 characters"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-teal text-ink font-semibold rounded-md py-2.5 hover:bg-teal/90 transition-colors disabled:opacity-50"
              >
                {loading ? "Sending code…" : "Send verification code"}
              </button>
            </form>
          ) : (
            <form
              onSubmit={handleOtpSubmit}
              className="bg-panel/90 backdrop-blur border border-grid rounded-xl p-6 space-y-4"
            >
              {error && (
                <div className="text-flare text-sm font-mono bg-flare/10 border border-flare/30 rounded-md px-3 py-2">
                  {error}
                </div>
              )}
              <div>
                <label className="text-xs font-mono text-ledger uppercase tracking-wide">6-digit code</label>
                <input
                  required
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  className="mt-1 w-full bg-ink border border-grid rounded-md px-3 py-3 text-center text-2xl tracking-[0.5em] font-mono outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                  placeholder="000000"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-teal text-ink font-semibold rounded-md py-2.5 hover:bg-teal/90 transition-colors disabled:opacity-50"
              >
                {loading ? "Verifying…" : "Verify & continue"}
              </button>
              <button
                type="button"
                onClick={() => setStep("details")}
                className="w-full text-ledger text-sm hover:text-white transition-colors"
              >
                Use a different email
              </button>
            </form>
          )}

          <p className="text-center text-sm text-ledger mt-5">
            Already have an account?{" "}
            <Link to="/login" className="text-teal hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
