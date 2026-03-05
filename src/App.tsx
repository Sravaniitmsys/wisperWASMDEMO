import VoiceDemo from './components/VoiceDemo';
import './App.css';

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Browser AI Voice Demo</h1>
        <p className="subtitle">
          Speech-to-text powered by Whisper AI — running entirely in your
          browser
        </p>
        <div className="tech-badges">
          <span className="badge">WebAssembly</span>
          <span className="badge">Whisper Tiny</span>
          <span className="badge">No Server Required</span>
        </div>
      </header>

      <main className="app-main">
        <VoiceDemo />
      </main>

      <footer className="app-footer">
        <p>
          Powered by{' '}
          <a
            href="https://huggingface.co/docs/transformers.js"
            target="_blank"
            rel="noopener noreferrer"
          >
            Transformers.js
          </a>{' '}
          · Model: onnx-community/whisper-tiny · All processing happens locally
        </p>
      </footer>
    </div>
  );
}

export default App;
