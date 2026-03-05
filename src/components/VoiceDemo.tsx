import { useWhisper } from '../hooks/useWhisper';
import LoadingProgress from './LoadingProgress';
import WaveformVisualizer from './WaveformVisualizer';
import TranscriptBox from './TranscriptBox';

export default function VoiceDemo() {
  const {
    state,
    transcript,
    interimText,
    liveText,
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
  } = useWhisper();

  const isSupported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof AudioContext !== 'undefined' &&
    typeof WebAssembly !== 'undefined';

  if (!isSupported) {
    return (
      <div className="voice-demo">
        <div className="glass-card error-card">
          <p>Your browser does not support the required APIs. Please use Chrome, Edge, or Firefox.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="voice-demo">
      {/* ── Idle ── */}
      {state === 'idle' && (
        <div className="demo-section fade-in">
          <div className="glass-card hero-card">
            <div className="hero-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </div>
            <h2>Ultra-Fast Voice Transcription</h2>
            <p className="hero-desc">
              Dual-engine: instant Web Speech API + Whisper AI correction.
              Everything runs in your browser.
            </p>
            <button onClick={initializeModel} className="btn btn-glow btn-large">
              Initialize AI Engine
            </button>
            <div className="engine-badges">
              <span className="engine-badge web-speech">Web Speech API</span>
              <span className="engine-badge whisper">Whisper Base WASM</span>
              <span className="engine-badge offline">Offline Ready</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Loading ── */}
      {state === 'loading' && (
        <div className="demo-section fade-in">
          <div className="glass-card">
            <LoadingProgress progress={loadProgress.progress} file={loadProgress.file} />
          </div>
        </div>
      )}

      {/* ── Ready ── */}
      {state === 'ready' && (
        <div className="demo-section fade-in">
          <div className="glass-card ready-card">
            <div className="ready-indicator">
              <div className="ready-dot" />
              <span>Engines Ready</span>
            </div>
            <button onClick={startRecording} className="btn btn-record-pulse btn-large">
              <span className="mic-icon">🎤</span>
              Start Recording
            </button>
          </div>
          <TranscriptBox
            transcript={transcript}
            liveText=""
            interimText=""
            onClear={clearTranscript}
            isTranscribing={false}
            isWebSpeechActive={false}
          />
        </div>
      )}

      {/* ── Recording ── */}
      {state === 'recording' && (
        <div className="demo-section fade-in">
          <div className="glass-card recording-card">
            {/* Engine status row */}
            <div className="engine-status-row">
              <div className={`engine-pill ${isWebSpeechActive ? 'active' : 'inactive'}`}>
                <span className="pill-dot" />
                Web Speech
              </div>
              <div className={`engine-pill ${isTranscribing ? 'active whisper' : 'standby'}`}>
                <span className="pill-dot" />
                Whisper AI
              </div>
            </div>

            {/* Volume visualizer */}
            <div className="volume-ring-container">
              <div
                className="volume-ring"
                style={{
                  '--vol': `${Math.round(volumeLevel * 100)}%`,
                  '--scale': `${1 + volumeLevel * 0.3}`,
                } as React.CSSProperties}
              >
                <div className="volume-ring-inner">
                  <span className="rec-dot" />
                </div>
              </div>
            </div>

            <WaveformVisualizer analyserRef={analyserRef} isRecording />

            <button onClick={stopRecording} className="btn btn-stop-modern btn-large">
              ⏹ Stop
            </button>
          </div>

          <TranscriptBox
            transcript={transcript}
            liveText={liveText}
            interimText={interimText}
            onClear={clearTranscript}
            isTranscribing={isTranscribing}
            isWebSpeechActive={isWebSpeechActive}
          />
        </div>
      )}

      {/* ── Processing ── */}
      {state === 'processing' && (
        <div className="demo-section fade-in">
          <div className="glass-card">
            <div className="processing-state">
              <div className="processing-ring" />
              <span>Finishing transcription&hellip;</span>
            </div>
          </div>
          <TranscriptBox
            transcript={transcript}
            liveText=""
            interimText=""
            onClear={clearTranscript}
            isTranscribing
            isWebSpeechActive={false}
          />
        </div>
      )}

      {error && (
        <div className="glass-card error-card fade-in">
          <p>⚠️ {error}</p>
        </div>
      )}
    </div>
  );
}
