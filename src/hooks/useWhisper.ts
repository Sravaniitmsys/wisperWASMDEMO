/**
 * useWhisper – React hook for browser-based speech-to-text.
 *
 * Architecture:
 * - Microphone → GainNode (3×) → AnalyserNode → ScriptProcessor → buffer
 * - Voice Activity Detection (VAD) segments audio into utterances
 * - Each utterance is sent to Whisper the moment the speaker pauses
 * - A rolling partial preview re-transcribes the current buffer every 800 ms
 *   so text appears on screen while the user is still speaking
 */
import { useState, useRef, useCallback } from 'react';
import { loadWhisperModel, transcribeAudio } from '../services/whisperService';

// ── Types ──────────────────────────────────────────────────────────────────────

export type DemoState = 'idle' | 'loading' | 'ready' | 'recording' | 'processing';

export interface LoadProgress {
  progress: number;
  file: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

/** Microphone gain multiplier – boosts quiet mics significantly */
const MIC_GAIN = 3.0;

/** RMS level below which audio is treated as silence (post-gain) */
const SILENCE_THRESHOLD = 0.012;

/** ms of silence that marks the end of an utterance → triggers transcription */
const UTTERANCE_GAP_MS = 700;

/** ms of continuous silence before auto-stopping the entire recording */
const AUTO_STOP_SILENCE_MS = 6_000;

/** Minimum audio duration (s) worth sending to Whisper */
const MIN_UTTERANCE_S = 0.4;

/** How often (ms) to produce a partial/preview transcript of in-progress audio */
const PARTIAL_INTERVAL_MS = 800;

/** Minimum audio (s) before we bother with a partial preview */
const MIN_PARTIAL_S = 0.6;

// ── Utility ────────────────────────────────────────────────────────────────────

function resampleAudio(data: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return data;
  const ratio = fromRate / toRate;
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

/** Normalise audio to use full dynamic range (peak → 0.95) */
function normaliseAudio(data: Float32Array): Float32Array {
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    if (abs > peak) peak = abs;
  }
  if (peak < 0.01) return data; // virtually silent – don't amplify noise
  const scale = 0.95 / peak;
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i] * scale;
  }
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

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useWhisper() {
  const [state, setState] = useState<DemoState>('idle');
  const [transcript, setTranscript] = useState('');
  const [partialText, setPartialText] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [loadProgress, setLoadProgress] = useState<LoadProgress>({ progress: 0, file: '' });
  const [error, setError] = useState<string | null>(null);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  /** Audio chunks for the current utterance (speech segment) */
  const utteranceChunksRef = useRef<Float32Array[]>([]);
  const isRecordingRef = useRef(false);
  const lastSoundRef = useRef(Date.now());
  const isSpeakingRef = useRef(false);
  const transcribeQueueRef = useRef<Float32Array[]>([]);
  const processingRef = useRef(false);
  const partialTimerRef = useRef(0);

  const stopRef = useRef<(() => Promise<void>) | undefined>(undefined);

  // ── Queue processor: drains committed utterances one by one ──────────────

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;

    while (transcribeQueueRef.current.length > 0) {
      const audio = transcribeQueueRef.current.shift()!;
      const sampleRate = audioCtxRef.current?.sampleRate ?? 16_000;
      const resampled = resampleAudio(audio, sampleRate, 16_000);
      const normalised = normaliseAudio(resampled);

      setIsTranscribing(true);
      try {
        const text = await transcribeAudio(normalised);
        if (text) {
          setTranscript((prev) => (prev ? `${prev} ${text}` : text));
          setPartialText(''); // clear partial once committed
        }
      } catch (err) {
        console.error('Transcription error:', err);
      } finally {
        setIsTranscribing(false);
      }
    }

    processingRef.current = false;
  }, []);

  // ── Commit current utterance to the queue ────────────────────────────────

  const commitUtterance = useCallback(() => {
    const chunks = utteranceChunksRef.current;
    if (chunks.length === 0) return;

    const combined = combineChunks(chunks);
    utteranceChunksRef.current = [];

    const sampleRate = audioCtxRef.current?.sampleRate ?? 16_000;
    if (combined.length / sampleRate < MIN_UTTERANCE_S) return;

    transcribeQueueRef.current.push(combined);
    processQueue();
  }, [processQueue]);

  // ── Partial preview: transcribe in-progress audio for live feel ──────────

  const runPartialPreview = useCallback(async () => {
    const chunks = utteranceChunksRef.current;
    if (chunks.length === 0) return;

    const combined = combineChunks(chunks);
    const sampleRate = audioCtxRef.current?.sampleRate ?? 16_000;
    if (combined.length / sampleRate < MIN_PARTIAL_S) return;

    // Don't block committed transcription
    if (processingRef.current) return;

    const resampled = resampleAudio(combined, sampleRate, 16_000);
    const normalised = normaliseAudio(resampled);

    try {
      const text = await transcribeAudio(normalised);
      // Only update partial if we're still recording (user hasn't stopped)
      if (isRecordingRef.current && text) {
        setPartialText(text);
      }
    } catch {
      // Ignore partial errors
    }
  }, []);

  // ── Tear down ────────────────────────────────────────────────────────────

  const stopRecordingInternal = useCallback(async () => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;

    if (partialTimerRef.current) {
      clearInterval(partialTimerRef.current);
      partialTimerRef.current = 0;
    }

    processorRef.current?.disconnect();
    processorRef.current = null;
    gainNodeRef.current?.disconnect();
    gainNodeRef.current = null;
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;

    // Commit any remaining utterance
    commitUtterance();

    // Wait for queue to finish
    setState('processing');
    while (processingRef.current || transcribeQueueRef.current.length > 0) {
      await new Promise((r) => setTimeout(r, 80));
    }

    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      await audioCtxRef.current.close();
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
    setPartialText('');
    setVolumeLevel(0);
    setState('ready');
  }, [commitUtterance]);

  stopRef.current = stopRecordingInternal;

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
      setPartialText('');

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16_000,
          echoCancellation: true,
          noiseSuppression: false,   // keep it OFF – lets more signal through
          autoGainControl: true,     // browser-level AGC helps a lot
        },
      });

      mediaStreamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: 16_000 });
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      // ── Gain boost ──
      const gainNode = ctx.createGain();
      gainNode.gain.value = MIC_GAIN;
      gainNodeRef.current = gainNode;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;

      const processor = ctx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;

      // Graph: source → gain → analyser → processor → silent → destination
      source.connect(gainNode);
      gainNode.connect(analyser);
      analyser.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(ctx.destination);

      utteranceChunksRef.current = [];
      transcribeQueueRef.current = [];
      isRecordingRef.current = true;
      isSpeakingRef.current = false;
      lastSoundRef.current = Date.now();

      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        if (!isRecordingRef.current) return;

        const channelData = e.inputBuffer.getChannelData(0);
        utteranceChunksRef.current.push(new Float32Array(channelData));

        // ── RMS for silence detection + UI volume meter ──
        let sum = 0;
        for (let i = 0; i < channelData.length; i++) {
          sum += channelData[i] * channelData[i];
        }
        const rms = Math.sqrt(sum / channelData.length);
        setVolumeLevel(Math.min(rms * 5, 1)); // normalise to 0-1 for UI

        const now = Date.now();

        if (rms > SILENCE_THRESHOLD) {
          // Sound detected
          lastSoundRef.current = now;
          isSpeakingRef.current = true;
        } else if (isSpeakingRef.current && now - lastSoundRef.current > UTTERANCE_GAP_MS) {
          // Speaker paused → commit utterance immediately
          isSpeakingRef.current = false;
          commitUtterance();
        }

        // Auto-stop after long silence
        if (now - lastSoundRef.current > AUTO_STOP_SILENCE_MS) {
          stopRef.current?.();
        }
      };

      setState('recording');

      // Partial preview timer
      partialTimerRef.current = window.setInterval(() => {
        if (isRecordingRef.current && utteranceChunksRef.current.length > 0) {
          runPartialPreview();
        }
      }, PARTIAL_INTERVAL_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to access microphone');
    }
  }, [commitUtterance, runPartialPreview]);

  const stopRecording = useCallback(async () => {
    await stopRecordingInternal();
  }, [stopRecordingInternal]);

  const clearTranscript = useCallback(() => {
    setTranscript('');
    setPartialText('');
  }, []);

  return {
    state,
    transcript,
    partialText,
    isTranscribing,
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
