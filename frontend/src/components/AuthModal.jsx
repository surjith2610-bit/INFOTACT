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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-fade-in font-sans">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 shadow-2xl space-y-6 text-slate-800 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 p-1 text-sm font-mono hover:bg-slate-100 rounded-lg"
        >
          ✕
        </button>

        <div className="space-y-1">
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-blue-600 shadow-sm animate-pulse" />
            FinGraph Enterprise Command
          </h2>
          <p className="text-xs text-slate-500 font-mono">
            {isLogin ? "Sign in to access real-time graph intelligence" : "Provision a new security analyst seat"}
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-mono text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 font-mono text-xs">
          {!isLogin && (
            <div>
              <label className="block text-slate-600 mb-1 font-semibold">Full Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition shadow-sm"
              />
            </div>
          )}

          <div>
            <label className="block text-slate-600 mb-1 font-semibold">Analyst Work Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition shadow-sm"
            />
          </div>

          <div>
            <label className="block text-slate-600 mb-1 font-semibold">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition shadow-sm"
            />
          </div>

          {!isLogin && (
            <div>
              <label className="block text-slate-600 mb-1 font-semibold">Assigned Security Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition shadow-sm"
              >
                <option value="ANALYST">Fraud Compliance Analyst</option>
                <option value="ADMIN">Lead Security Administrator</option>
              </select>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition shadow-sm disabled:opacity-50 mt-2 font-mono text-xs"
          >
            {loading ? "Verifying Credentials…" : isLogin ? "Authenticate Analyst" : "Provision Account"}
          </button>
        </form>

        <div className="pt-3 border-t border-slate-200 flex justify-between items-center text-xs font-mono text-slate-500">
          <span>{isLogin ? "Need new credentials?" : "Already provisioned?"}</span>
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-blue-600 hover:underline font-bold"
          >
            {isLogin ? "Register" : "Sign In"}
          </button>
        </div>
      </div>
    </div>
  );
}
