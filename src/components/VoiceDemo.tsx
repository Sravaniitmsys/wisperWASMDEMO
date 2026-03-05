import { useWhisper } from '../hooks/useWhisper';
import LoadingProgress from './LoadingProgress';
import WaveformVisualizer from './WaveformVisualizer';
import TranscriptBox from './TranscriptBox';

export default function VoiceDemo() {
  const {
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
  } = useWhisper();

  // ── Browser capability check ─────────────────────────────────────────────
  const isSupported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof AudioContext !== 'undefined' &&
    typeof WebAssembly !== 'undefined';

  if (!isSupported) {
    return (
      <div className="voice-demo">
        <div className="error-message">
          <p>
            Your browser does not support the required APIs (getUserMedia, Web
            Audio, WebAssembly). Please use a recent version of Chrome, Edge, or
            Firefox.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="voice-demo">
      {/* ── Idle state ──────────────────────────────────────────────────── */}
      {state === 'idle' && (
        <div className="demo-section fade-in">
          <button onClick={initializeModel} className="btn btn-primary btn-large">
            🎙️ Start Voice Demo
          </button>
          <p className="hint">
            Click to load the Whisper AI model into your browser
          </p>
        </div>
      )}

      {/* ── Loading state ───────────────────────────────────────────────── */}
      {state === 'loading' && (
        <div className="demo-section fade-in">
          <LoadingProgress
            progress={loadProgress.progress}
            file={loadProgress.file}
          />
        </div>
      )}

      {/* ── Ready state ─────────────────────────────────────────────────── */}
      {state === 'ready' && (
        <div className="demo-section fade-in">
          <div className="status-badge ready">✓ Voice AI Ready</div>
          <button onClick={startRecording} className="btn btn-record btn-large">
            🎤 Start Recording
          </button>
          <TranscriptBox
            transcript={transcript}
            partialText=""
            onClear={clearTranscript}
            isTranscribing={false}
          />
        </div>
      )}

      {/* ── Recording state ─────────────────────────────────────────────── */}
      {state === 'recording' && (
        <div className="demo-section fade-in">
          <div className="recording-status-row">
            <div className="status-badge recording">
              <span className="recording-dot" />
              Recording
            </div>
            {isTranscribing && (
              <div className="status-badge transcribing">
                <span className="transcribing-spinner" />
                Transcribing
              </div>
            )}
          </div>

          {/* Volume meter */}
          <div className="volume-meter">
            <div
              className="volume-meter-fill"
              style={{ width: `${Math.round(volumeLevel * 100)}%` }}
            />
            <span className="volume-meter-label">
              {volumeLevel > 0.3 ? '🔊' : volumeLevel > 0.05 ? '🔉' : '🔈'} Mic Level
            </span>
          </div>

          <WaveformVisualizer analyserRef={analyserRef} isRecording />
          <button onClick={stopRecording} className="btn btn-stop btn-large">
            ⏹ Stop Recording
          </button>
          <p className="hint">
            Speak clearly — text appears as you pause · auto-stops after 6 s of silence
          </p>
          <TranscriptBox
            transcript={transcript}
            partialText={partialText}
            onClear={clearTranscript}
            isTranscribing={isTranscribing}
          />
        </div>
      )}

      {/* ── Processing state ────────────────────────────────────────────── */}
      {state === 'processing' && (
        <div className="demo-section fade-in">
          <div className="status-badge processing">
            Finishing transcription&hellip;
          </div>
          <div className="processing-spinner" />
          <TranscriptBox
            transcript={transcript}
            partialText=""
            onClear={clearTranscript}
            isTranscribing
          />
        </div>
      )}

      {/* ── Error display ───────────────────────────────────────────────── */}
      {error && (
        <div className="error-message fade-in">
          <p>⚠️ {error}</p>
        </div>
      )}
    </div>
  );
}
