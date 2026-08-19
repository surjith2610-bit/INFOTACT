import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import GraphBackdrop from "../components/GraphBackdrop.jsx";

export default function GoogleCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");
    const err = searchParams.get("error");

    if (err) {
      setError("Google authentication failed. " + err);
      setTimeout(() => navigate("/login"), 3000);
      return;
    }

    if (token) {
      localStorage.setItem("fingraph_token", token);
      navigate("/dashboard");
    } else {
      setError("No authentication token received from Google callback.");
      setTimeout(() => navigate("/login"), 3000);
    }
  }, [searchParams, navigate]);

  return (
    <div className="relative min-h-screen overflow-hidden ledger-bg flex items-center justify-center">
      <GraphBackdrop />
      <div className="relative z-10 bg-panel/90 backdrop-blur border border-grid rounded-xl p-8 max-w-md w-full text-center space-y-4 shadow-2xl">
        <div className="w-12 h-12 rounded-full bg-teal/20 text-teal flex items-center justify-center mx-auto border border-teal/40 animate-pulse">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        {error ? (
          <div>
            <h2 className="text-xl font-bold text-flare">Authentication Error</h2>
            <p className="text-ledger text-sm mt-2">{error}</p>
            <p className="text-xs text-ledger/60 mt-4">Redirecting to sign in page…</p>
          </div>
        ) : (
          <div>
            <h2 className="text-xl font-bold text-white">Completing Google Sign-In</h2>
            <p className="text-ledger text-sm mt-2">Authenticating your profile and setting up session token…</p>
          </div>
        )}
      </div>
    </div>
  );
}
