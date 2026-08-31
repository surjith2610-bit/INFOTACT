import { useState } from "react";
import { loginUser, registerUser, getErrorMessage } from "../api/client.js";

export default function AuthModal({ isOpen, onClose, onAuthSuccess }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("admin@fingraph.io");
  const [password, setPassword] = useState("admin123");
  const [name, setName] = useState("Security Administrator");
  const [role, setRole] = useState("ADMIN");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      let res;
      if (isLogin) {
        res = await loginUser(email, password);
      } else {
        res = await registerUser(email, password, name, role);
      }

      const { access_token, user } = res.data;
      localStorage.setItem("fingraph_token", access_token);
      localStorage.setItem("fingraph_user", JSON.stringify(user));
      
      if (onAuthSuccess) onAuthSuccess(user);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "Authentication failed. Please verify credentials."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-obsidian/85 backdrop-blur-md p-4 animate-fade-in font-sans">
      <div className="w-full max-w-md bg-panel border border-slate-700/80 rounded-2xl p-6 shadow-2xl space-y-6 text-slate-100 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 text-sm font-mono hover:bg-slate-800 rounded-lg"
        >
          ✕
        </button>

        <div className="space-y-1">
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-teal shadow-neon-teal animate-pulse" />
            FinGraph Enterprise Command
          </h2>
          <p className="text-xs text-slate-400 font-mono">
            {isLogin ? "Sign in to access real-time graph intelligence" : "Provision a new security analyst seat"}
          </p>
        </div>

        {error && (
          <div className="p-3 bg-flare/10 border border-flare/30 rounded-xl text-xs font-mono text-flare">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 font-mono text-xs">
          {!isLogin && (
            <div>
              <label className="block text-slate-400 mb-1">Full Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-obsidian border border-slate-700/80 rounded-xl p-2.5 text-white focus:outline-none focus:border-teal transition"
              />
            </div>
          )}

          <div>
            <label className="block text-slate-400 mb-1">Analyst Work Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-obsidian border border-slate-700/80 rounded-xl p-2.5 text-white focus:outline-none focus:border-teal transition"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-obsidian border border-slate-700/80 rounded-xl p-2.5 text-white focus:outline-none focus:border-teal transition"
            />
          </div>

          {!isLogin && (
            <div>
              <label className="block text-slate-400 mb-1">Assigned Security Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full bg-obsidian border border-slate-700/80 rounded-xl p-2.5 text-white focus:outline-none focus:border-teal transition"
              >
                <option value="ANALYST">Fraud Compliance Analyst</option>
                <option value="ADMIN">Lead Security Administrator</option>
              </select>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-teal hover:bg-teal-400 text-obsidian font-bold rounded-xl transition shadow-neon-teal disabled:opacity-50 mt-2 font-mono text-xs"
          >
            {loading ? "Verifying Credentials…" : isLogin ? "Authenticate Analyst" : "Provision Account"}
          </button>
        </form>

        <div className="pt-3 border-t border-slate-800 flex justify-between items-center text-xs font-mono text-slate-400">
          <span>{isLogin ? "Need new credentials?" : "Already provisioned?"}</span>
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-teal hover:underline font-semibold"
          >
            {isLogin ? "Register" : "Sign In"}
          </button>
        </div>
      </div>
    </div>
  );
}
