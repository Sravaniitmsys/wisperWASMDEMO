interface TranscriptBoxProps {
  transcript: string;
  liveText: string;
  interimText: string;
  onClear: () => void;
  isTranscribing?: boolean;
  isWebSpeechActive?: boolean;
}

export default function TranscriptBox({
  transcript,
  liveText,
  interimText,
  onClear,
  isTranscribing = false,
  isWebSpeechActive = false,
}: TranscriptBoxProps) {
  const handleDownload = () => {
    const all = transcript + (liveText ? ' ' + liveText : '');
    const blob = new Blob([all], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transcript.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasContent = transcript || liveText || interimText;
  const isActive = isTranscribing || isWebSpeechActive;

  return (
    <div className={`transcript-box ${isActive ? 'active' : ''}`}>
      <div className="transcript-header">
        <div className="transcript-title-row">
          <h3>Transcript</h3>
          {isActive && (
            <div className="live-badge">
              <span className="live-dot" />
              LIVE
            </div>
          )}
        </div>
        <div className="transcript-actions">
          {(transcript || liveText) && (
            <>
              <button onClick={handleDownload} className="btn btn-icon" title="Download">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
              <button onClick={onClear} className="btn btn-icon btn-icon-danger" title="Clear">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      <div className="transcript-content">
        {hasContent ? (
          <p>
            {transcript && <span className="final-text">{transcript}</span>}
            {liveText && <span className="live-text"> {liveText}</span>}
            {interimText && !liveText && (
              <span className="interim-text"> {interimText}</span>
            )}
            {isActive && (
              <span className="cursor-blink">|</span>
            )}
          </p>
        ) : (
          <p className="transcript-placeholder">
            {isActive ? (
              <>
                Listening
                <span className="typing-indicator">
                  <span /><span /><span />
                </span>
              </>
            ) : (
              'Start recording to see transcription here...'
            )}
          </p>
        )}
      </div>
    </div>
  );
}
