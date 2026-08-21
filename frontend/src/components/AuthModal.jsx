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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-fade-in font-sans">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6 text-slate-100 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 text-sm font-mono"
        >
          ✕
        </button>

        <div className="space-y-1">
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-teal-400" />
            FinGraph Enterprise Portal
          </h2>
          <p className="text-xs text-slate-400 font-mono">
            {isLogin ? "Sign in to access real-time fraud intelligence" : "Register a new analyst account"}
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs font-mono text-red-400">
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
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-teal-500"
              />
            </div>
          )}

          <div>
            <label className="block text-slate-400 mb-1">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-teal-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-teal-500"
            />
          </div>

          {!isLogin && (
            <div>
              <label className="block text-slate-400 mb-1">Access Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-teal-500"
              >
                <option value="ANALYST">Fraud Analyst</option>
                <option value="ADMIN">Security Administrator</option>
              </select>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold rounded-lg transition shadow-lg disabled:opacity-50 mt-2"
          >
            {loading ? "Processing..." : isLogin ? "Sign In" : "Register Account"}
          </button>
        </form>

        <div className="pt-2 border-t border-slate-800 flex justify-between items-center text-xs font-mono text-slate-400">
          <span>{isLogin ? "Need an account?" : "Already have an account?"}</span>
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-teal-400 hover:underline font-semibold"
          >
            {isLogin ? "Register" : "Sign In"}
          </button>
        </div>
      </div>
    </div>
  );
}
