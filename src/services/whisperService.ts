/**
 * Whisper Speech-to-Text Service
 *
 * Loads and manages a Whisper Tiny model running entirely in the browser
 * via WebAssembly using the @huggingface/transformers library.
 *
 * Key features:
 * - Lazy model loading (only when user triggers the demo)
 * - Automatic caching via the browser's Cache API (built into transformers.js)
 * - Quantized model (q8) for smaller download and faster inference
 */
import { pipeline } from '@huggingface/transformers';

// ── Types ──────────────────────────────────────────────────────────────────────

export type WhisperProgressEvent = {
  status: string;
  progress?: number;
  file?: string;
  loaded?: number;
  total?: number;
};

export type ProgressCallback = (event: WhisperProgressEvent) => void;

/**
 * Internal transcriber function type.
 * The actual pipeline returns a callable object; we type-narrow to
 * automatic-speech-recognition output.
 */
interface TranscriptionOutput {
  text: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TranscriberFn = (audio: Float32Array, options?: Record<string, any>) => Promise<TranscriptionOutput>;

// ── Singleton ──────────────────────────────────────────────────────────────────

let transcriber: TranscriberFn | null = null;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Load the Whisper Tiny model into the browser via WASM.
 *
 * On first call, the model files (~44 MB quantized) are downloaded from the
 * Hugging Face CDN. The @huggingface/transformers library automatically caches
 * them in the browser's Cache API, so subsequent loads are near-instant.
 *
 * @param onProgress - Optional callback that receives download progress events.
 */
export async function loadWhisperModel(onProgress?: ProgressCallback): Promise<void> {
  if (transcriber) return;

  const result = await pipeline(
    'automatic-speech-recognition',
    'onnx-community/whisper-tiny',
    {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: onProgress,
    } as Record<string, unknown>,
  );

  transcriber = result as unknown as TranscriberFn;
}

/**
 * Transcribe a Float32Array of audio samples (expected at 16 kHz mono).
 *
 * Automatically picks the right strategy based on audio length:
 * - Short clips (< 30 s): direct inference, no chunking overhead
 * - Long clips (≥ 30 s): chunked pipeline with stride
 */
export async function transcribeAudio(audioData: Float32Array): Promise<string> {
  if (!transcriber) {
    throw new Error('Whisper model not loaded. Call loadWhisperModel first.');
  }

  // Calculate duration at 16 kHz
  const durationSecs = audioData.length / 16_000;

  // For short clips, skip chunking entirely — much faster inference
  if (durationSecs < 28) {
    const result = await transcriber(audioData, {
      language: 'english',
      task: 'transcribe',
    });
    return result.text?.trim() ?? '';
  }

  // For longer recordings, use chunked pipeline
  const result = await transcriber(audioData, {
    language: 'english',
    task: 'transcribe',
    chunk_length_s: 30,
    stride_length_s: 5,
  });

  return result.text?.trim() ?? '';
}

/** Returns `true` if the model has already been loaded into memory. */
export function isModelLoaded(): boolean {
  return transcriber !== null;
}
