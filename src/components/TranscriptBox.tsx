interface TranscriptBoxProps {
  transcript: string;
  partialText: string;
  onClear: () => void;
  isTranscribing?: boolean;
}

export default function TranscriptBox({
  transcript,
  partialText,
  onClear,
  isTranscribing = false,
}: TranscriptBoxProps) {
  const handleDownload = () => {
    const blob = new Blob([transcript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transcript.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasContent = transcript || partialText;

  return (
    <div className="transcript-box">
      <div className="transcript-header">
        <h3>Live Transcript</h3>
        <div className="transcript-actions">
          {transcript && (
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
            {transcript && <span>{transcript} </span>}
            {partialText && (
              <span className="partial-text">{partialText}</span>
            )}
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
