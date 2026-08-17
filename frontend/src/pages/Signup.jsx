import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import GraphBackdrop from "../components/GraphBackdrop.jsx";
import GoogleAuthButton from "../components/GoogleAuthButton.jsx";
import { signup, verifyOtp, resendOtp, getErrorMessage } from "../api/client.js";

function maskEmail(email) {
  if (!email || !email.includes("@")) return email;
  const [local, domain] = email.split("@");
  if (local.length <= 2) {
    return `${local[0]}*@${domain}`;
  }
  return `${local[0]}${"*".repeat(Math.max(local.length - 2, 3))}${local[local.length - 1]}@${domain}`;
}

export default function Signup() {
  const navigate = useNavigate();
  const [step, setStep] = useState("details"); // "details" | "otp"
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });
  const [otpDigits, setOtpDigits] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(60);

  const inputRefs = useRef([]);

  // Countdown timer for Resend Code button
  useEffect(() => {
    let timer;
    if (step === "otp" && cooldown > 0) {
      timer = setInterval(() => {
        setCooldown((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [step, cooldown]);

  // Focus first input box when step changes to OTP
  useEffect(() => {
    if (step === "otp" && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [step]);

  async function handleDetailsSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    if (!form.name.trim()) {
      setError("Please enter your full name.");
      return;
    }

    if (form.password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match. Please re-enter your password.");
      return;
    }

    setLoading(true);
    try {
      const { data } = await signup({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
      });
      setStep("otp");
      setOtpDigits(["", "", "", "", "", ""]);
      setCooldown(60);
      
      let msg = "Verification code sent successfully.";
      if (data.otp_debug) {
        msg += ` [DEV CODE: ${data.otp_debug}]`;
        // Pre-fill digits in dev mode if present
        setOtpDigits(data.otp_debug.split(""));
      }
      setSuccessMsg(msg);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to create account. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  async function handleOtpSubmit(e) {
    e.preventDefault();
    const code = otpDigits.join("");
    if (code.length !== 6) {
      setError("Please enter all 6 digits of the verification code.");
      return;
    }

    setError("");
    setSuccessMsg("");
    setLoading(true);

    try {
      const { data } = await verifyOtp({
        email: form.email.trim().toLowerCase(),
        otp: code,
      });
      if (data.access_token) {
        localStorage.setItem("fingraph_token", data.access_token);
      }
      navigate("/dashboard");
    } catch (err) {
      setError(getErrorMessage(err, "Invalid verification code. Please check your email and try again."));
    } finally {
      setLoading(false);
    }
  }

  async function handleResendCode() {
    if (cooldown > 0 || resending) return;
    setError("");
    setSuccessMsg("");
    setResending(true);

    try {
      const { data } = await resendOtp({ email: form.email.trim().toLowerCase() });
      setOtpDigits(["", "", "", "", "", ""]);
      setCooldown(60);
      let msg = "A new verification code has been sent to your email.";
      if (data.otp_debug) {
        msg += ` [DEV CODE: ${data.otp_debug}]`;
        setOtpDigits(data.otp_debug.split(""));
      }
      setSuccessMsg(msg);
      if (inputRefs.current[0]) {
        inputRefs.current[0].focus();
      }
    } catch (err) {
      setError(getErrorMessage(err, "Failed to resend verification code. Please try again."));
    } finally {
      setResending(false);
    }
  }

  function handleDigitChange(index, value) {
    const numericVal = value.replace(/\D/g, "");
    if (!numericVal && value !== "") return;

    const updated = [...otpDigits];
    updated[index] = numericVal.slice(-1);
    setOtpDigits(updated);
    setError("");

    if (numericVal && index < 5 && inputRefs.current[index + 1]) {
      inputRefs.current[index + 1].focus();
    }
  }

  function handleKeyDown(index, e) {
    if (e.key === "Backspace") {
      if (!otpDigits[index] && index > 0 && inputRefs.current[index - 1]) {
        inputRefs.current[index - 1].focus();
      }
    }
  }

  function handlePaste(e) {
    e.preventDefault();
    const pasteData = e.clipboardData.getData("text").trim().replace(/\D/g, "");
    if (pasteData.length === 6) {
      const digits = pasteData.split("");
      setOtpDigits(digits);
      setError("");
      if (inputRefs.current[5]) {
        inputRefs.current[5].focus();
      }
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
              {step === "details" ? "Create your FinGraph account" : "Verify your email"}
            </h1>
            <p className="text-ledger text-sm mt-1">
              {step === "details" ? (
                "Start monitoring financial transaction networks."
              ) : (
                <>
                  We&apos;ve sent a 6-digit verification code to{" "}
                  <span className="font-mono text-teal">{maskEmail(form.email)}</span>.
                </>
              )}
            </p>
          </div>

          {step === "details" ? (
            <div className="bg-panel/90 backdrop-blur border border-grid rounded-xl p-6 space-y-5 shadow-2xl">
              {error && (
                <div className="text-flare text-sm font-mono bg-flare/10 border border-flare/30 rounded-md px-3 py-2">
                  {error}
                </div>
              )}

              {/* Google Authentication */}
              <GoogleAuthButton
                label="Continue with Google"
                onSuccess={() => navigate("/dashboard")}
                onError={(err) => setError(err)}
              />

              <div className="flex items-center gap-3 py-1">
                <div className="h-px flex-1 bg-grid" />
                <span className="text-ledger text-xs font-mono uppercase tracking-widest">or</span>
                <div className="h-px flex-1 bg-grid" />
              </div>

              <form onSubmit={handleDetailsSubmit} className="space-y-4">
                <div>
                  <label className="text-xs font-mono text-ledger uppercase tracking-wide">Full Name</label>
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="mt-1 w-full bg-ink border border-grid rounded-md px-3 py-2 outline-none focus:border-teal focus:ring-1 focus:ring-teal text-white"
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
                    className="mt-1 w-full bg-ink border border-grid rounded-md px-3 py-2 outline-none focus:border-teal focus:ring-1 focus:ring-teal text-white"
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
                    className="mt-1 w-full bg-ink border border-grid rounded-md px-3 py-2 outline-none focus:border-teal focus:ring-1 focus:ring-teal text-white"
                    placeholder="At least 8 characters"
                  />
                </div>
                <div>
                  <label className="text-xs font-mono text-ledger uppercase tracking-wide">Confirm Password</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={form.confirmPassword}
                    onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                    className="mt-1 w-full bg-ink border border-grid rounded-md px-3 py-2 outline-none focus:border-teal focus:ring-1 focus:ring-teal text-white"
                    placeholder="Re-enter password"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-teal text-ink font-semibold rounded-md py-2.5 hover:bg-teal/90 transition-colors disabled:opacity-50"
                >
                  {loading ? "Sending code…" : "Create Account"}
                </button>
              </form>
            </div>
          ) : (
            <form
              onSubmit={handleOtpSubmit}
              className="bg-panel/90 backdrop-blur border border-grid rounded-xl p-6 space-y-5 shadow-2xl"
            >
              {error && (
                <div className="text-flare text-sm font-mono bg-flare/10 border border-flare/30 rounded-md px-3 py-2">
                  {error}
                </div>
              )}
              {successMsg && (
                <div className="text-teal text-sm font-mono bg-teal/10 border border-teal/30 rounded-md px-3 py-2">
                  {successMsg}
                </div>
              )}

              <div>
                <label className="text-xs font-mono text-ledger uppercase tracking-wide block mb-3 text-center">
                  Verification Code
                </label>
                <div className="flex items-center justify-between gap-2" onPaste={handlePaste}>
                  {otpDigits.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={(el) => (inputRefs.current[idx] = el)}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleDigitChange(idx, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(idx, e)}
                      className="w-11 h-13 text-center text-xl font-bold font-mono bg-ink border border-grid rounded-lg outline-none focus:border-teal focus:ring-2 focus:ring-teal/50 text-white transition-all"
                    />
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || otpDigits.join("").length !== 6}
                className="w-full bg-teal text-ink font-semibold rounded-md py-2.5 hover:bg-teal/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? "Verifying…" : "Verify & Continue"}
              </button>

              <div className="flex items-center justify-between text-xs pt-1 border-t border-grid/50">
                <div className="text-ledger">
                  Didn&apos;t receive the code?{" "}
                  <button
                    type="button"
                    onClick={handleResendCode}
                    disabled={cooldown > 0 || resending}
                    className="text-teal font-mono hover:underline disabled:text-ledger disabled:no-underline disabled:cursor-not-allowed transition-colors"
                  >
                    {resending
                      ? "Sending…"
                      : cooldown > 0
                      ? `Resend available in ${cooldown}s`
                      : "Resend Code"}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setStep("details");
                    setError("");
                    setSuccessMsg("");
                  }}
                  className="text-ledger hover:text-white transition-colors"
                >
                  Use a Different Email
                </button>
              </div>
            </form>
          )}

          <p className="text-center text-sm text-ledger mt-5">
            Already have an account?{" "}
            <Link to="/login" className="text-teal hover:underline">
              Sign In
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

