import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ReCAPTCHA from "react-google-recaptcha";
import GraphBackdrop from "../components/GraphBackdrop.jsx";
import { login, googleLogin } from "../api/client.js";

const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY || "";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

export default function Login() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [captchaToken, setCaptchaToken] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (RECAPTCHA_SITE_KEY && !captchaToken) {
      setError("Please complete the captcha.");
      return;
    }
    setLoading(true);
    try {
      const { data } = await login({ ...form, captcha_token: captchaToken || "dev-bypass" });
      localStorage.setItem("fingraph_token", data.access_token);
      navigate("/dashboard");
    } catch (err) {
      setError(err.response?.data?.detail || "Login failed. Check your credentials.");
    } finally {
      setLoading(false);
    }
  }

  // Renders Google's real button when a client ID is configured; otherwise
  // shows a disabled placeholder so the UI still communicates the feature.
  function handleGoogleCredential(response) {
    googleLogin(response.credential)
      .then(({ data }) => {
        localStorage.setItem("fingraph_token", data.access_token);
        navigate("/dashboard");
      })
      .catch(() => setError("Google sign-in failed."));
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
            <h1 className="text-3xl font-bold tracking-tight">FinGraph</h1>
            <p className="text-ledger text-sm mt-1">Sign in to trace the flow.</p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="bg-panel/90 backdrop-blur border border-grid rounded-xl p-6 space-y-4"
          >
            {error && (
              <div className="text-flare text-sm font-mono bg-flare/10 border border-flare/30 rounded-md px-3 py-2">
                {error}
              </div>
            )}

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
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="mt-1 w-full bg-ink border border-grid rounded-md px-3 py-2 outline-none focus:border-teal focus:ring-1 focus:ring-teal"
                placeholder="••••••••"
              />
            </div>

            {RECAPTCHA_SITE_KEY ? (
              <ReCAPTCHA sitekey={RECAPTCHA_SITE_KEY} onChange={setCaptchaToken} theme="dark" />
            ) : (
              <div className="text-xs font-mono text-ledger border border-dashed border-grid rounded-md px-3 py-2">
                Captcha widget renders here once VITE_RECAPTCHA_SITE_KEY is set in .env
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-teal text-ink font-semibold rounded-md py-2.5 hover:bg-teal/90 transition-colors disabled:opacity-50"
            >
              {loading ? "Verifying…" : "Sign in"}
            </button>

            <div className="flex items-center gap-3 py-1">
              <div className="h-px flex-1 bg-grid" />
              <span className="text-ledger text-xs font-mono">or</span>
              <div className="h-px flex-1 bg-grid" />
            </div>

            {GOOGLE_CLIENT_ID ? (
              <div id="google-signin-button" className="flex justify-center" />
            ) : (
              <button
                type="button"
                disabled
                title="Set VITE_GOOGLE_CLIENT_ID to enable"
                className="w-full border border-grid rounded-md py-2.5 text-sm text-ledger cursor-not-allowed"
              >
                Continue with Google
              </button>
            )}
          </form>

          <p className="text-center text-sm text-ledger mt-5">
            No account?{" "}
            <Link to="/signup" className="text-teal hover:underline">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
