/**
 * useWhisper – React hook for browser-based speech-to-text.
 *
 * Architecture  (sliding-window with cross-packet correction):
 *   Microphone → GainNode → AnalyserNode → ScriptProcessor → growing buffer
 *
 *   A tight async loop continuously re-transcribes the *entire* current
 *   window.  Because Whisper sees more context each pass, earlier words
 *   get corrected automatically – just like the Web Speech API's interim
 *   results.  When the window grows past MAX_WINDOW_S the current text is
 *   committed as final and the buffer resets.
 */
import { useState, useRef, useCallback } from 'react';
import { loadWhisperModel, transcribeAudio } from '../services/whisperService';

export type DemoState = 'idle' | 'loading' | 'ready' | 'recording' | 'processing';

export interface LoadProgress {
  progress: number;
  file: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MIC_GAIN = 2.5;
const MIN_AUDIO_S = 0.5;          // don't bother transcribing less than this
const MAX_WINDOW_S = 10;          // commit & reset when buffer exceeds this
const SILENCE_THRESHOLD = 0.008;
const AUTO_STOP_SILENCE_MS = 30_000;

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

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useWhisper() {
  const [state, setState] = useState<DemoState>('idle');
  const [transcript, setTranscript] = useState('');
  const [liveText, setLiveText] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [loadProgress, setLoadProgress] = useState<LoadProgress>({ progress: 0, file: '' });
  const [error, setError] = useState<string | null>(null);

  // Audio graph refs
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Buffer & loop state
  const audioBufferRef = useRef<Float32Array[]>([]);
  const isRecordingRef = useRef(false);
  const loopRunningRef = useRef(false);
  const liveTextRef = useRef('');
  const lastSoundRef = useRef(Date.now());

  // ── Commit liveText → transcript and reset the buffer ────────────────────

  const commitLiveText = useCallback(() => {
    const text = liveTextRef.current.trim();
    if (text) {
      setTranscript((prev) => (prev ? `${prev} ${text}` : text));
    }
    liveTextRef.current = '';
    setLiveText('');
    audioBufferRef.current = [];
  }, []);

  // ── Continuous transcription loop ────────────────────────────────────────
  //
  // Runs as a tight async loop while recording.  Each pass:
  //   1. Combine entire pending buffer
  //   2. If buffer is short → wait a bit and retry
  //   3. If buffer exceeds MAX_WINDOW_S → commit & reset
  //   4. Otherwise → transcribe the whole window, update liveText
  //
  // Because the window *grows* between passes, Whisper sees progressively
  // more context and self-corrects earlier words (cross-packet correction).

  const runTranscriptionLoop = useCallback(async () => {
    if (loopRunningRef.current) return;
    loopRunningRef.current = true;

    while (isRecordingRef.current) {
      const chunks = audioBufferRef.current;
      if (chunks.length === 0) {
        await sleep(100);
        continue;
      }

      const combined = combineChunks(chunks);
      const sampleRate = audioCtxRef.current?.sampleRate ?? 44_100;
      const duration = combined.length / sampleRate;

      // Not enough audio yet – wait a bit
      if (duration < MIN_AUDIO_S) {
        await sleep(100);
        continue;
      }

      // Window too large → commit current text and start fresh
      if (duration > MAX_WINDOW_S) {
        commitLiveText();
        continue;
      }

      // ── Transcribe the entire current window ──
      const resampled = resampleTo16k(combined, sampleRate);
      const normalised = normalise(resampled);

      setIsTranscribing(true);
      try {
        const text = await transcribeAudio(normalised);
        if (text && isRecordingRef.current) {
          liveTextRef.current = text;
          setLiveText(text);
        }
      } catch (err) {
        console.error('Transcription error:', err);
      }
      setIsTranscribing(false);

      // Small breather so we don't starve the main thread
      await sleep(50);
    }

    // ── Recording stopped – handle remaining audio ──────────────────────────

    const remaining = audioBufferRef.current;
    if (remaining.length > 0) {
      const audio = combineChunks(remaining);
      const sr = audioCtxRef.current?.sampleRate ?? 44_100;
      if (audio.length / sr >= MIN_AUDIO_S) {
        setIsTranscribing(true);
        try {
          const text = await transcribeAudio(
            normalise(resampleTo16k(audio, sr)),
          );
          if (text) {
            setTranscript((prev) => (prev ? `${prev} ${text}` : text));
          }
        } catch (err) {
          console.error('Final transcription error:', err);
        }
        setIsTranscribing(false);
      }
      audioBufferRef.current = [];
    } else if (liveTextRef.current) {
      commitLiveText();
    }

    liveTextRef.current = '';
    setLiveText('');
    loopRunningRef.current = false;
  }, [commitLiveText]);

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

    cleanupAudio();
    setState('processing');

    // Wait for the transcription loop to finish its final pass
    while (loopRunningRef.current) {
      await sleep(50);
    }

    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      await audioCtxRef.current.close();
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
    setVolumeLevel(0);
    setState('ready');
  }, [cleanupAudio]);

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
      setLiveText('');
      liveTextRef.current = '';

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      // Use the browser's native sample rate – we resample to 16 kHz ourselves
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

      // source → gain → analyser → processor → silent → destination
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

        // Volume meter + silence detection
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

      // Fire-and-forget: start the continuous transcription loop
      runTranscriptionLoop();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to access microphone');
    }
  }, [runTranscriptionLoop]);

  const clearTranscript = useCallback(() => {
    setTranscript('');
    setLiveText('');
    liveTextRef.current = '';
  }, []);

  return {
    state,
    transcript,
    liveText,
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
