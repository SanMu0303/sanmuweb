import React, { useEffect, useRef, useState } from "react";
import {
  announcement,
  DEFAULT_VOICE_VOLUME,
  newVoiceSignals,
  normalizeVoiceVolume,
  spellAssetSymbol,
  speechOptions,
} from "../alerts/voice.mjs";
import { storage } from "../storage.mjs";

const VOICE_VOLUME_STORAGE_KEY = "voice-volume";

export default function VoiceAlerts({ signals, mode }) {
  const supported =
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window;
  const [enabled, setEnabled] = useState(false);
  const [volume, setVolume] = useState(() =>
    normalizeVoiceVolume(
      storage.read(VOICE_VOLUME_STORAGE_KEY, DEFAULT_VOICE_VOLUME),
    ),
  );
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [message, setMessage] = useState("开启后播报新异常；不补播历史信号");
  const volumeRef = useRef(volume);
  const state = useRef({
    seen: new Set(),
    enabledAt: 0,
    queue: [],
    speaking: false,
    generation: 0,
  });
  useEffect(() => {
    storage.write(VOICE_VOLUME_STORAGE_KEY, volume);
  }, [volume]);
  useEffect(() => {
    if (!volumeOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setVolumeOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [volumeOpen]);
  const stop = () => {
    const s = state.current;
    s.utterance = null;
    s.generation++;
    s.queue = [];
    s.speaking = false;
    s.enabledAt = 0;
    if (supported) window.speechSynthesis.cancel();
  };
  const drain = () => {
    const s = state.current;
    if (s.speaking || !s.enabledAt) return;
    s.queue = s.queue.filter((x) => Date.now() - x.at < 90000);
    const item = s.queue.shift();
    if (!item) return;
    s.speaking = true;
    const generation = s.generation;
    const utterance = new SpeechSynthesisUtterance(item.text);
    s.utterance = utterance;
    Object.assign(utterance, speechOptions(volumeRef.current));
    const voice = window.speechSynthesis
      .getVoices()
      .find((v) => v.lang.startsWith("zh"));
    if (voice) utterance.voice = voice;
    utterance.onend = () => {
      if (generation !== s.generation) return;
      s.speaking = false;
      drain();
    };
    utterance.onerror = () => {
      if (generation !== s.generation) return;
      stop();
      setEnabled(false);
      setMessage("语音播放失败，请点击重新开启");
    };
    setMessage(item.text);
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      stop();
      setEnabled(false);
      setMessage("当前浏览器无法播放语音");
    }
  };
  const enqueue = (texts) => {
    const s = state.current;
    s.queue.push(...texts.map((text) => ({ text, at: Date.now() })));
    s.queue = s.queue.slice(-5);
    drain();
  };
  const updateVolume = (value) => {
    const next = normalizeVoiceVolume(value);
    volumeRef.current = next;
    // Browsers reliably apply this to the next utterance. Updating the active
    // instance too lets engines that support live adjustment react immediately.
    if (state.current.utterance) state.current.utterance.volume = next;
    setVolume(next);
    setMessage(`语音音量 ${Math.round(next * 100)}%`);
  };
  useEffect(() => {
    const fresh = newVoiceSignals(
      signals,
      state.current.seen,
      state.current.enabledAt,
    );
    if (enabled) enqueue(fresh.map((s) => announcement(s, mode)));
  }, [signals, enabled, mode]);
  useEffect(() => () => stop(), []);
  return (
    <div
      className="voice-controls"
      title={supported ? message : "当前浏览器不支持语音播报"}
    >
      <button
        disabled={!supported}
        aria-label="语音提醒"
        aria-pressed={enabled}
        className={enabled ? "voice-enabled" : ""}
        onClick={() => {
          if (enabled) {
            stop();
            setEnabled(false);
            setMessage("语音提醒已关闭");
          } else {
            state.current.enabledAt = Date.now();
            signals.forEach((s) => state.current.seen.add(s.id));
            setEnabled(true);
            enqueue(["语音提醒已开启"]);
          }
        }}
      >
        <span aria-hidden="true">♪</span>
        <span className="voice-toggle-label">
          {enabled ? "语音开启" : "语音关闭"}
        </span>
      </button>
      {enabled && (
        <button
          type="button"
          className="voice-test"
          aria-label="试听语音提醒"
          onClick={() =>
            enqueue([
              `${mode === "DEMO" ? "模拟信号，" : "试听，"}${spellAssetSymbol("BTCUSDT")}，成交量异常`,
            ])
          }
        >
          试听
        </button>
      )}
      <button
        type="button"
        disabled={!supported}
        className="voice-volume-button"
        aria-label="调节语音音量"
        aria-expanded={volumeOpen}
        aria-haspopup="dialog"
        aria-controls="voice-volume-panel"
        onClick={() => setVolumeOpen((open) => !open)}
      >
        <span className="voice-volume-label">音量 </span>
        <span>{Math.round(volume * 100)}%</span>
      </button>
      {volumeOpen && (
        <div
          className="voice-popover"
          id="voice-volume-panel"
          role="dialog"
          aria-label="语音音量设置"
        >
          <span className="voice-status" role="status">{message}</span>
          <label>
            音量
            <input
              aria-label="语音音量"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              aria-valuetext={`音量 ${Math.round(volume * 100)}%`}
              onChange={(event) => updateVolume(event.target.value)}
            />
            <output>{Math.round(volume * 100)}%</output>
          </label>
        </div>
      )}
    </div>
  );
}
