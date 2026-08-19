import { useState, useEffect } from "react";
import { fetchUserProfile, updateSocialLinks, getErrorMessage } from "../api/client.js";

export default function ProfessionalProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });
  const [form, setForm] = useState({
    linkedin: "",
    twitter: "",
    github: "",
  });

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    setLoading(true);
    try {
      const { data } = await fetchUserProfile();
      setProfile(data);
      if (data.socialLinks) {
        setForm({
          linkedin: data.socialLinks.linkedin || "",
          twitter: data.socialLinks.twitter || "",
          github: data.socialLinks.github || "",
        });
      }
    } catch (err) {
      setMessage({ text: getErrorMessage(err, "Failed to load profile."), type: "error" });
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setMessage({ text: "", type: "" });

    try {
      const { data } = await updateSocialLinks(form);
      if (data.profile) {
        setProfile(data.profile);
      }
      setMessage({ text: "Professional profile & social accounts saved successfully!", type: "success" });
    } catch (err) {
      setMessage({ text: getErrorMessage(err, "Failed to save social profile links."), type: "error" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-panel/90 backdrop-blur border border-grid rounded-xl p-8 text-center text-ledger font-mono text-sm animate-pulse">
        Loading Professional Profile data…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-panel/90 backdrop-blur border border-grid rounded-xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 z-10 relative">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-teal/30 to-ink border-2 border-teal flex items-center justify-center text-2xl font-bold text-teal shadow-[0_0_20px_rgba(45,217,196,0.3)]">
              {profile?.name ? profile.name.charAt(0).toUpperCase() : "A"}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-bold text-white tracking-tight">{profile?.name || "Analyst User"}</h2>
                {profile?.verified && (
                  <span className="bg-teal/10 border border-teal/40 text-teal text-xs px-2 py-0.5 rounded-full font-mono font-medium">
                    Verified Account
                  </span>
                )}
              </div>
              <p className="text-ledger text-sm mt-0.5">{profile?.email}</p>
              <div className="flex items-center gap-2 mt-2 font-mono text-xs text-ledger">
                <span>Auth Provider: <span className="text-teal capitalize">{profile?.provider || "email"}</span></span>
                {profile?.googleId && (
                  <span className="bg-blue-500/10 border border-blue-500/30 text-blue-400 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12.545,10.239v3.821h5.445c-0.712,2.315-2.647,3.972-5.445,3.972c-3.332,0-6.033-2.701-6.033-6.032s2.701-6.032,6.033-6.032c1.498,0,2.866,0.549,3.921,1.453l2.814-2.814C17.503,2.988,15.139,2,12.545,2C7.021,2,2.543,6.477,2.543,12s4.478,10,10.002,10c8.396,0,10.249-7.85,9.426-11.761H12.545z"/>
                    </svg>
                    Google Linked
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Connected Accounts Card */}
      <div className="bg-panel/90 backdrop-blur border border-grid rounded-xl p-6 shadow-xl space-y-6">
        <div>
          <h3 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-teal shadow-[0_0_8px_rgba(45,217,196,0.8)]" />
            Social & Professional Accounts
          </h3>
          <p className="text-ledger text-xs mt-1 font-mono">
            Connect your professional networks (LinkedIn, Twitter/X, GitHub) for syndicate investigation verification.
          </p>
        </div>

        {message.text && (
          <div
            className={`text-xs font-mono px-4 py-3 rounded-lg border ${
              message.type === "error"
                ? "bg-flare/10 border-flare/30 text-flare"
                : "bg-teal/10 border-teal/30 text-teal"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Display Status Badges */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* LinkedIn Badge */}
          <div className="bg-ink/80 border border-grid rounded-lg p-4 flex flex-col justify-between space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-blue-400 font-semibold text-sm">
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                  <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z"/>
                </svg>
                LinkedIn
              </div>
              {form.linkedin ? (
                <span className="text-[10px] font-mono bg-teal/10 border border-teal/40 text-teal px-2 py-0.5 rounded">Connected</span>
              ) : (
                <span className="text-[10px] font-mono bg-grid text-ledger px-2 py-0.5 rounded">Not Linked</span>
              )}
            </div>
            {form.linkedin ? (
              <a
                href={form.linkedin.startsWith("http") ? form.linkedin : `https://${form.linkedin}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-mono text-teal truncate hover:underline"
              >
                {form.linkedin}
              </a>
            ) : (
              <span className="text-xs text-ledger/50 font-mono italic">No URL connected</span>
            )}
          </div>

          {/* Twitter / X Badge */}
          <div className="bg-ink/80 border border-grid rounded-lg p-4 flex flex-col justify-between space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-sky-400 font-semibold text-sm">
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
                Twitter / X
              </div>
              {form.twitter ? (
                <span className="text-[10px] font-mono bg-teal/10 border border-teal/40 text-teal px-2 py-0.5 rounded">Connected</span>
              ) : (
                <span className="text-[10px] font-mono bg-grid text-ledger px-2 py-0.5 rounded">Not Linked</span>
              )}
            </div>
            {form.twitter ? (
              <a
                href={form.twitter.startsWith("http") ? form.twitter : `https://${form.twitter}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-mono text-teal truncate hover:underline"
              >
                {form.twitter}
              </a>
            ) : (
              <span className="text-xs text-ledger/50 font-mono italic">No URL connected</span>
            )}
          </div>

          {/* GitHub Badge */}
          <div className="bg-ink/80 border border-grid rounded-lg p-4 flex flex-col justify-between space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-purple-400 font-semibold text-sm">
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                  <path d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.1-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z"/>
                </svg>
                GitHub
              </div>
              {form.github ? (
                <span className="text-[10px] font-mono bg-teal/10 border border-teal/40 text-teal px-2 py-0.5 rounded">Connected</span>
              ) : (
                <span className="text-[10px] font-mono bg-grid text-ledger px-2 py-0.5 rounded">Not Linked</span>
              )}
            </div>
            {form.github ? (
              <a
                href={form.github.startsWith("http") ? form.github : `https://${form.github}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-mono text-teal truncate hover:underline"
              >
                {form.github}
              </a>
            ) : (
              <span className="text-xs text-ledger/50 font-mono italic">No URL connected</span>
            )}
          </div>
        </div>

        {/* Update Form */}
        <form onSubmit={handleSubmit} className="space-y-4 pt-4 border-t border-grid/60">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-mono text-ledger uppercase tracking-wide block mb-1">
                LinkedIn Profile URL
              </label>
              <input
                type="text"
                value={form.linkedin}
                onChange={(e) => setForm({ ...form, linkedin: e.target.value })}
                className="w-full bg-ink border border-grid rounded-md px-3 py-2 outline-none focus:border-teal focus:ring-1 focus:ring-teal text-white text-sm"
                placeholder="https://linkedin.com/in/username"
              />
            </div>

            <div>
              <label className="text-xs font-mono text-ledger uppercase tracking-wide block mb-1">
                Twitter / X Profile URL
              </label>
              <input
                type="text"
                value={form.twitter}
                onChange={(e) => setForm({ ...form, twitter: e.target.value })}
                className="w-full bg-ink border border-grid rounded-md px-3 py-2 outline-none focus:border-teal focus:ring-1 focus:ring-teal text-white text-sm"
                placeholder="https://twitter.com/username"
              />
            </div>

            <div>
              <label className="text-xs font-mono text-ledger uppercase tracking-wide block mb-1">
                GitHub Profile URL
              </label>
              <input
                type="text"
                value={form.github}
                onChange={(e) => setForm({ ...form, github: e.target.value })}
                className="w-full bg-ink border border-grid rounded-md px-3 py-2 outline-none focus:border-teal focus:ring-1 focus:ring-teal text-white text-sm"
                placeholder="https://github.com/username"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="bg-teal text-ink font-semibold px-6 py-2.5 rounded-md hover:bg-teal/90 transition-colors shadow-lg disabled:opacity-50 text-sm"
            >
              {saving ? "Saving Changes…" : "Save Social Profile Links"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
