interface TranscriptBoxProps {
  transcript: string;
  liveText: string;
  onClear: () => void;
  isTranscribing?: boolean;
}

export default function TranscriptBox({
  transcript,
  liveText,
  onClear,
  isTranscribing = false,
}: TranscriptBoxProps) {
  const fullText = transcript + (liveText ? '' : '');

  const handleDownload = () => {
    const downloadText = transcript + (liveText ? ' ' + liveText : '');
    const blob = new Blob([downloadText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transcript.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasContent = transcript || liveText;

  return (
    <div className="transcript-box">
      <div className="transcript-header">
        <h3>Live Transcript</h3>
        <div className="transcript-actions">
          {fullText && (
            <>
              <button onClick={handleDownload} className="btn btn-small btn-secondary">
                Download
              </button>
              <button onClick={onClear} className="btn btn-small btn-danger">
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      <div className="transcript-content">
        {hasContent ? (
          <p>
            {transcript && <span className="final-text">{transcript} </span>}
            {liveText && <span className="live-text">{liveText}</span>}
            {isTranscribing && (
              <span className="typing-indicator">
                <span />
                <span />
                <span />
              </span>
            )}
          </p>
        ) : (
          <p className="transcript-placeholder">
            {isTranscribing ? (
              <>
                Listening&hellip;{' '}
                <span className="typing-indicator">
                  <span />
                  <span />
                  <span />
                </span>
              </>
            ) : (
              <>Your transcription will appear here&hellip;</>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
