interface LoadingProgressProps {
  progress: number;
  file: string;
}

export default function LoadingProgress({ progress, file }: LoadingProgressProps) {
  const fileName = file ? file.split('/').pop() ?? file : '';

  return (
    <div className="loading-progress">
      <div className="loading-spinner" />
      <p className="loading-text">Loading Whisper Base&hellip;</p>
      <p className="loading-hint">
        First load downloads ~77 MB (cached for future&nbsp;use)
      </p>

      <div className="progress-bar-container">
        <div
          className="progress-bar-fill"
          style={{ width: `${Math.max(progress, 2)}%` }}
        />
      </div>

      {fileName && <p className="loading-file">{fileName}</p>}
      <p className="loading-status">{progress}% complete</p>
    </div>
  );
}
