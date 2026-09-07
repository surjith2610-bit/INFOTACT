import React, { useState, useEffect, useRef } from "react";
import { fetchTransactionsTimeline } from "../api/client.js";
import { formatINR } from "../utils/currency.js";

export default function TimelinePlayback({
  onTimelineFiltered,
  themeMode = "dark",
}) {
  const [timelineData, setTimelineData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1); // 1x, 2x, 5x
  const [bankFilter, setBankFilter] = useState("ALL");
  const [fraudOnly, setFraudOnly] = useState(false);

  const timerRef = useRef(null);

  const loadTimeline = async () => {
    setLoading(true);
    try {
      const res = await fetchTransactionsTimeline({
        bank: bankFilter,
        fraud_only: fraudOnly,
        limit: 250,
      });
      setTimelineData(res.data);
      setCurrentIndex(0);
      if (onTimelineFiltered) {
        onTimelineFiltered(res.data);
      }
    } catch (err) {
      console.error("Error loading timeline data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTimeline();
  }, [bankFilter, fraudOnly]);

  // Playback timer loop
  useEffect(() => {
    if (isPlaying && timelineData && timelineData.transactions) {
      const intervalMs = 1200 / playbackSpeed;
      timerRef.current = setInterval(() => {
        setCurrentIndex((prev) => {
          if (prev >= timelineData.transactions.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, intervalMs);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isPlaying, playbackSpeed, timelineData]);

  const transactions = timelineData?.transactions || [];
  const currentTx = transactions[currentIndex] || null;
  const progressPercent = transactions.length > 0 ? (currentIndex / (transactions.length - 1)) * 100 : 0;

  return (
    <div className="w-full glass-panel rounded-2xl border border-rose-950/30 p-4 space-y-3">
      {/* Top Header & Playback Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
          <span className="text-xs font-bold text-white uppercase tracking-wider font-mono">
            ⏱️ Historical Timeline Playback & Scrubber
          </span>
          <span className="text-[11px] text-slate-400 font-mono">
            ({currentIndex + 1}/{transactions.length} Events)
          </span>
        </div>

        {/* Playback Controls & Speed */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
            className="p-1.5 px-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs border border-white/10"
            title="Step Backward"
          >
            ⏮
          </button>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-rose-700 to-rose-900 hover:from-rose-600 hover:to-rose-800 text-white font-bold text-xs shadow-md border border-rose-500/40 flex items-center gap-1.5"
          >
            {isPlaying ? "⏸ Pause" : "▶ Play Sequence"}
          </button>
          <button
            onClick={() => setCurrentIndex((prev) => Math.min(transactions.length - 1, prev + 1))}
            className="p-1.5 px-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs border border-white/10"
            title="Step Forward"
          >
            ⏭
          </button>

          {/* Speed Selector */}
          <div className="flex items-center bg-black/40 rounded-lg p-0.5 border border-white/10 text-[10px] font-mono">
            {[1, 2, 5].map((spd) => (
              <button
                key={spd}
                onClick={() => setPlaybackSpeed(spd)}
                className={`px-2 py-0.5 rounded transition ${
                  playbackSpeed === spd ? "bg-rose-900 text-white font-bold" : "text-slate-400 hover:text-white"
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>

          {/* Fraud Only Filter */}
          <button
            onClick={() => setFraudOnly(!fraudOnly)}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition ${
              fraudOnly
                ? "bg-red-950/80 text-red-200 border-red-500/40"
                : "bg-white/5 text-slate-400 border-white/10"
            }`}
          >
            {fraudOnly ? "🚨 Fraud Only: ON" : "⚪ Fraud Only: OFF"}
          </button>
        </div>
      </div>

      {/* Scrubbing Range Slider */}
      <div className="space-y-1.5">
        <input
          type="range"
          min={0}
          max={Math.max(0, transactions.length - 1)}
          value={currentIndex}
          onChange={(e) => setCurrentIndex(parseInt(e.target.value, 10))}
          className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-500"
        />
        <div className="flex justify-between text-[10px] font-mono text-slate-400">
          <span>{timelineData?.min_timestamp ? new Date(timelineData.min_timestamp).toLocaleString() : "Start"}</span>
          <span className="text-rose-400 font-bold">
            {currentTx ? new Date(currentTx.timestamp).toLocaleString() : "Current Scrubber"}
          </span>
          <span>{timelineData?.max_timestamp ? new Date(timelineData.max_timestamp).toLocaleString() : "End"}</span>
        </div>
      </div>

      {/* Active Time Slice Transaction HUD */}
      {currentTx && (
        <div className="p-3 rounded-xl bg-black/50 border border-white/10 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-3">
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                currentTx.is_fraud
                  ? "bg-red-500/20 text-red-300 border border-red-500/40"
                  : "bg-blue-500/20 text-blue-300 border border-blue-500/40"
              }`}
            >
              {currentTx.pattern || "TRANSACTION"}
            </span>
            <div className="font-mono text-white font-bold text-sm">
              {formatINR(currentTx.amount)}
            </div>
            <span className="text-slate-400 text-[11px] font-mono">
              Via {currentTx.channel || "IMPS"}
            </span>
          </div>

          <div className="flex items-center gap-4 text-slate-300 font-mono text-xs">
            <div>
              <span className="text-[10px] text-slate-500 block">FROM SENDER</span>
              <span className="text-white font-bold">{currentTx.sender_name || currentTx.sender}</span>
              <span className="text-[10px] text-slate-400 block">({currentTx.sender_bank || "Bank"})</span>
            </div>
            <span className="text-rose-400 text-lg">➔</span>
            <div>
              <span className="text-[10px] text-slate-500 block">TO RECEIVER</span>
              <span className="text-white font-bold">{currentTx.receiver_name || currentTx.receiver}</span>
              <span className="text-[10px] text-slate-400 block">({currentTx.receiver_bank || "Bank"})</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
