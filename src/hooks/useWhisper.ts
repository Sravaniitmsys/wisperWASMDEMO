/**
 * useWhisper – Hybrid speech-to-text: Web Speech API + Whisper WASM
 *
 * Architecture (dual-engine for instant + accurate transcription):
 *
 *   Microphone stream
 *     ├─→ Web Speech API  → instant interim text (displayed immediately)
 *     └─→ AudioContext → GainNode → buffer
 *           └─→ Whisper WASM (background) → high-accuracy correction
 *
 *  - Web Speech API gives character-by-character instant results
 *  - Whisper WASM runs on buffered audio segments for better accuracy
 *  - When Whisper finishes a segment it replaces the Web Speech text
 *  - Result: snap-instant display + offline-capable accuracy
 */
import { useState, useRef, useCallback } from 'react';
import { loadWhisperModel, transcribeAudio } from '../services/whisperService';

export type DemoState = 'idle' | 'loading' | 'ready' | 'recording' | 'processing';

export interface LoadProgress {
  progress: number;
  file: string;
}

// ── Types & Globals ────────────────────────────────────────────────────────────

// Web Speech API type shims (not in all TS libs)
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: { transcript: string; confidence: number };
}
interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message?: string;
}
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

declare global {
  interface Window {
    webkitSpeechRecognition: SpeechRecognitionCtor;
    SpeechRecognition: SpeechRecognitionCtor;
  }
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MIC_GAIN = 2.5;
const SILENCE_THRESHOLD = 0.008;
const AUTO_STOP_SILENCE_MS = 60_000;
const WHISPER_SEGMENT_S = 8;       // buffer this much audio then run Whisper correction
const MIN_WHISPER_S = 1.0;         // minimum audio to bother sending to Whisper

// ── Utility ────────────────────────────────────────────────────────────────────

function resampleTo16k(data: Float32Array, fromRate: number): Float32Array {
  if (fromRate === 16_000) return data;
  const ratio = fromRate / 16_000;
  const len = Math.round(data.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const idx = i * ratio;
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, data.length - 1);
    const frac = idx - lo;
    out[i] = data[lo] * (1 - frac) + data[hi] * frac;
  }
  return out;
}

function normalise(data: Float32Array): Float32Array {
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    if (abs > peak) peak = abs;
  }
  if (peak < 0.01) return data;
  const scale = 0.95 / peak;
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] * scale;
  return out;
}

function combineChunks(chunks: Float32Array[]): Float32Array {
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const combined = new Float32Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Check if Web Speech API is available */
function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useWhisper() {
  const [state, setState] = useState<DemoState>('idle');
  const [transcript, setTranscript] = useState('');       // final committed text
  const [interimText, setInterimText] = useState('');     // Web Speech interim (instant)
  const [whisperText, setWhisperText] = useState('');     // Whisper corrected current segment
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [loadProgress, setLoadProgress] = useState<LoadProgress>({ progress: 0, file: '' });
  const [error, setError] = useState<string | null>(null);
  const [isWebSpeechActive, setIsWebSpeechActive] = useState(false);

  // Audio graph refs
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Web Speech API ref
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // Buffer & state refs
  const audioBufferRef = useRef<Float32Array[]>([]);
  const isRecordingRef = useRef(false);
  const lastSoundRef = useRef(Date.now());
  const whisperLoopRef = useRef(false);

  // Segment tracking: Web Speech accumulates finals per segment
  const webSpeechSegmentRef = useRef('');   // Web Speech finals for current segment
  const segmentStartTimeRef = useRef(0);

  // ── Start Web Speech API (instant results) ──────────────────────────────

  const startWebSpeech = useCallback(() => {
    const SRCtor = getSpeechRecognitionCtor();
    if (!SRCtor) return;

    const recognition = new SRCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      if (!isRecordingRef.current) return;

      let interim = '';
      let sessionFinal = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          sessionFinal += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      // Accumulate finals from Web Speech for current Whisper segment
      if (sessionFinal) {
        webSpeechSegmentRef.current += sessionFinal;
      }

      // Display: show interim text instantly
      setInterimText(interim);
    };

    recognition.onerror = (ev) => {
      // 'no-speech' and 'aborted' are not real errors
      if (ev.error === 'no-speech' || ev.error === 'aborted') return;
      console.warn('Web Speech error:', ev.error);
    };

    recognition.onend = () => {
      // Auto-restart if still recording (Web Speech sometimes stops itself)
      if (isRecordingRef.current) {
        try {
          recognition.start();
        } catch {
          // Already started or disposed
        }
      } else {
        setIsWebSpeechActive(false);
      }
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
      setIsWebSpeechActive(true);
    } catch {
      console.warn('Web Speech API unavailable');
    }
  }, []);

  const stopWebSpeech = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch { /* ignore */ }
    recognitionRef.current = null;
    setIsWebSpeechActive(false);
    setInterimText('');
  }, []);

  // ── Whisper background correction loop ───────────────────────────────────
  //
  //  Every WHISPER_SEGMENT_S seconds of audio, run Whisper on the buffered
  //  audio.  If Whisper gives a result, commit it as the "true" text for
  //  that segment (overriding the Web Speech text).  If Whisper has nothing,
  //  fall back to Web Speech's accumulated finals.

  const runWhisperLoop = useCallback(async () => {
    if (whisperLoopRef.current) return;
    whisperLoopRef.current = true;

    while (isRecordingRef.current) {
      await sleep(200);

      const chunks = audioBufferRef.current;
      if (chunks.length === 0) continue;

      const combined = combineChunks(chunks);
      const sr = audioCtxRef.current?.sampleRate ?? 44_100;
      const duration = combined.length / sr;

      if (duration < WHISPER_SEGMENT_S) continue;

      // ── Time to run Whisper on this segment ──
      // Snapshot the buffer and the Web Speech text, then reset both
      const audioSnapshot = combined;
      const webSpeechFallback = webSpeechSegmentRef.current.trim();
      audioBufferRef.current = [];
      webSpeechSegmentRef.current = '';

      if (audioSnapshot.length / sr < MIN_WHISPER_S) {
        // Too short — just commit Web Speech text if any
        if (webSpeechFallback) {
          setTranscript(prev => prev ? `${prev} ${webSpeechFallback}` : webSpeechFallback);
        }
        setWhisperText('');
        continue;
      }

      setIsTranscribing(true);
      try {
        const resampled = resampleTo16k(audioSnapshot, sr);
        const normalised = normalise(resampled);
        const whisperResult = await transcribeAudio(normalised);

        // Use Whisper's result (more accurate), fall back to Web Speech
        const finalText = whisperResult || webSpeechFallback;
        if (finalText) {
          setTranscript(prev => prev ? `${prev} ${finalText}` : finalText);
          setWhisperText('');
        }
      } catch (err) {
        console.error('Whisper error:', err);
        // Fall back to Web Speech
        if (webSpeechFallback) {
          setTranscript(prev => prev ? `${prev} ${webSpeechFallback}` : webSpeechFallback);
        }
      }
      setIsTranscribing(false);
    }

    // ── Recording ended — flush remaining audio ─────────────────────────────

    const remaining = audioBufferRef.current;
    const webSpeechRemaining = webSpeechSegmentRef.current.trim();
    audioBufferRef.current = [];
    webSpeechSegmentRef.current = '';

    if (remaining.length > 0) {
      const audio = combineChunks(remaining);
      const sr = audioCtxRef.current?.sampleRate ?? 44_100;

      if (audio.length / sr >= MIN_WHISPER_S) {
        setIsTranscribing(true);
        try {
          const text = await transcribeAudio(normalise(resampleTo16k(audio, sr)));
          const finalText = text || webSpeechRemaining;
          if (finalText) {
            setTranscript(prev => prev ? `${prev} ${finalText}` : finalText);
          }
        } catch {
          if (webSpeechRemaining) {
            setTranscript(prev => prev ? `${prev} ${webSpeechRemaining}` : webSpeechRemaining);
          }
        }
        setIsTranscribing(false);
      } else if (webSpeechRemaining) {
        setTranscript(prev => prev ? `${prev} ${webSpeechRemaining}` : webSpeechRemaining);
      }
    } else if (webSpeechRemaining) {
      setTranscript(prev => prev ? `${prev} ${webSpeechRemaining}` : webSpeechRemaining);
    }

    setWhisperText('');
    whisperLoopRef.current = false;
  }, []);

  // ── Cleanup audio graph ──────────────────────────────────────────────────

  const cleanupAudio = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    gainNodeRef.current?.disconnect();
    gainNodeRef.current = null;
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
  }, []);

  // ── Stop recording ──────────────────────────────────────────────────────

  const stopRecording = useCallback(async () => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;

    stopWebSpeech();
    cleanupAudio();
    setState('processing');

    // Wait for Whisper loop to finish flushing
    while (whisperLoopRef.current) {
      await sleep(50);
    }

    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      await audioCtxRef.current.close();
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
    setVolumeLevel(0);
    setInterimText('');
    setState('ready');
  }, [cleanupAudio, stopWebSpeech]);

  const stopRef = useRef(stopRecording);
  stopRef.current = stopRecording;

  // ── Initialise model ─────────────────────────────────────────────────────

  const initializeModel = useCallback(async () => {
    try {
      setState('loading');
      setError(null);
      setLoadProgress({ progress: 0, file: '' });

      await loadWhisperModel((event) => {
        if (event.status === 'progress') {
          setLoadProgress({
            progress: Math.round(event.progress ?? 0),
            file: event.file ?? '',
          });
        }
      });

      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load AI model');
      setState('idle');
    }
  }, []);

  // ── Start recording ──────────────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setInterimText('');
      setWhisperText('');
      webSpeechSegmentRef.current = '';
      segmentStartTimeRef.current = Date.now();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const gainNode = ctx.createGain();
      gainNode.gain.value = MIC_GAIN;
      gainNodeRef.current = gainNode;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;

      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;

      source.connect(gainNode);
      gainNode.connect(analyser);
      analyser.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(ctx.destination);

      audioBufferRef.current = [];
      isRecordingRef.current = true;
      lastSoundRef.current = Date.now();

      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        if (!isRecordingRef.current) return;

        const data = e.inputBuffer.getChannelData(0);
        audioBufferRef.current.push(new Float32Array(data));

        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        setVolumeLevel(Math.min(rms * 5, 1));

        if (rms > SILENCE_THRESHOLD) lastSoundRef.current = Date.now();
        if (Date.now() - lastSoundRef.current > AUTO_STOP_SILENCE_MS) {
          stopRef.current();
        }
      };

      setState('recording');

      // Start both engines simultaneously
      startWebSpeech();
      runWhisperLoop();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to access microphone');
    }
  }, [startWebSpeech, runWhisperLoop]);

  const clearTranscript = useCallback(() => {
    setTranscript('');
    setInterimText('');
    setWhisperText('');
    webSpeechSegmentRef.current = '';
  }, []);

  // Compute the "live" text to show: Web Speech accumulated finals + interim
  // This gives the user instant visual feedback
  const liveText = (webSpeechSegmentRef.current + ' ' + interimText).trim();

  return {
    state,
    transcript,
    interimText,
    liveText,
    whisperText,
    isTranscribing,
    isWebSpeechActive,
    volumeLevel,
    loadProgress,
    error,
    analyserRef,
    initializeModel,
    startRecording,
    stopRecording,
    clearTranscript,
  } as const;
}
