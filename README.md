# Browser AI Voice Demo

> Speech-to-text powered by **Whisper AI** — running entirely in your browser via **WebAssembly**. No backend server required.

---

## Overview

This is a proof-of-concept React application that demonstrates **browser-only speech recognition** using the [Whisper Tiny](https://huggingface.co/onnx-community/whisper-tiny) model running through WebAssembly.

**Key points for stakeholders:**

- The AI model runs **100% client-side** — zero data leaves the browser.
- First visit downloads ~44 MB; it is then **cached locally** for instant reloads.
- Works on any modern browser (Chrome, Edge, Firefox) without plugins or extensions.

---

## How It Works

```
User clicks "Start Voice Demo"
        │
        ▼
┌─────────────────────────────────────────────┐
│  1. Load Whisper Tiny model (~44 MB q8)     │
│     via @huggingface/transformers            │
│     → Runs ONNX Runtime in WASM             │
│     → Cached in browser Cache API           │
└─────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────┐
│  2. Request microphone via getUserMedia     │
│     → Capture mono audio via Web Audio API  │
│     → ScriptProcessorNode → Float32Array    │
└─────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────┐
│  3. Every 5 s (and on stop):                │
│     → Resample to 16 kHz                    │
│     → Feed into Whisper WASM pipeline       │
│     → Append transcript to UI               │
└─────────────────────────────────────────────┘
```

### Model Loading in the Browser

1. `@huggingface/transformers` calls the Hugging Face CDN to download model files (ONNX weights, tokenizer, config).
2. Files are stored in the browser's **Cache API** automatically — no custom IndexedDB code needed.
3. On subsequent visits the library detects the cached files and skips the network entirely.
4. The ONNX Runtime Web backend compiles the model to **WebAssembly** and runs inference locally.

---

## Installation

```bash
# Navigate to the project
cd wisperWASMDEMO

# Install dependencies
npm install

# Start the dev server
npm run dev
```

Open the URL printed by Vite (typically `http://localhost:5173`).

---

## Running Locally

```bash
npm run dev      # development with HMR
npm run build    # production build
npm run preview  # serve the production build
```

> **Note:** The first run requires an internet connection to download the model. After that the model is cached and the app works offline (assuming the built assets are served).

---

## Project Structure

```
src/
├── services/
│   └── whisperService.ts    # Loads Whisper model, transcribes audio
├── hooks/
│   └── useWhisper.ts        # React hook – state machine, mic capture, resampling
├── components/
│   ├── VoiceDemo.tsx        # Main demo (idle / loading / ready / recording / processing)
│   ├── TranscriptBox.tsx    # Transcript display with download & clear
│   ├── WaveformVisualizer.tsx # Canvas waveform during recording
│   └── LoadingProgress.tsx  # Progress bar during model download
├── App.tsx                  # Root layout
├── App.css                  # All component styles
├── index.css                # Design tokens & reset
└── main.tsx                 # React entry point
```

---

## Features

| Feature | Details |
|---|---|
| **Lazy model loading** | Model downloads only when user clicks "Start Voice Demo" |
| **Browser caching** | Cache API stores model files; future loads are instant |
| **Live transcription** | Audio is periodically transcribed every ~5 s during recording |
| **Silence detection** | Recording auto-stops after 4 s of continuous silence |
| **Waveform visualization** | Real-time canvas waveform from AnalyserNode |
| **Download transcript** | One-click `.txt` export of the transcription |
| **No backend** | All processing happens in the browser via WASM |

---

## Browser Compatibility

| Browser | Status |
|---|---|
| **Chrome 90+** | Fully supported (recommended) |
| **Edge 90+** | Fully supported |
| **Firefox 89+** | Supported (single-threaded WASM fallback) |
| **Safari 16.4+** | Partial — WebAssembly SIMD support may vary |
| **Mobile Chrome/Edge** | Works, but inference is slower on mobile hardware |

### Cross-Origin Isolation (optional performance boost)

The Vite dev server is configured with `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers to enable `SharedArrayBuffer` for **multi-threaded WASM**. If you encounter CORS issues loading the model, comment out these headers in `vite.config.ts`:

```ts
// server: {
//   headers: {
//     'Cross-Origin-Opener-Policy': 'same-origin',
//     'Cross-Origin-Embedder-Policy': 'credentialless',
//   },
// },
```

The library will fall back to single-threaded WASM automatically.

---

## Performance Notes

- **Model:** Whisper Tiny (q8 quantized) — smallest available, ~44 MB.
- **Inference time:** ~2–5 s per 5 s of audio on a modern laptop.
- **First load:** 30–60 s depending on bandwidth (model download).
- **Subsequent loads:** < 2 s (model served from browser cache).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 19 + Vite |
| AI Runtime | ONNX Runtime Web (WASM) via `@huggingface/transformers` |
| Speech Model | `onnx-community/whisper-tiny` (q8 quantized) |
| Audio Capture | Web Audio API + `getUserMedia` |
| Model Caching | Browser Cache API (built into transformers.js) |

---

## License

Internal demo — not for distribution.
