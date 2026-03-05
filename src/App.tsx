import VoiceDemo from './components/VoiceDemo';
import './App.css';

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Voice Transcription Engine</h1>
        <p className="subtitle">
          Dual-engine: instant Web Speech API + Whisper AI accuracy &mdash; 100% browser-based
        </p>
      </header>

      <main className="app-main">
        <VoiceDemo />
      </main>

      <footer className="app-footer">
        <p>
          Powered by{' '}
          <a href="https://huggingface.co/docs/transformers.js" target="_blank" rel="noopener noreferrer">
            Transformers.js
          </a>
          {' '}&middot; Whisper Base (WASM) &middot; Web Speech API &middot; All processing local
        </p>
      </footer>
    </div>
  );
}

export default App;
