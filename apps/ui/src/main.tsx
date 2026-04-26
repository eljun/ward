import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  return (
    <main className="shell">
      <section className="status-panel" aria-labelledby="ward-title">
        <div>
          <p className="eyebrow">Runtime shell</p>
          <h1 id="ward-title">WARD</h1>
        </div>
        <p className="summary">
          The local runtime is serving the command center shell. Task 002 keeps
          this page intentionally small while the daemon, auth, logging, and
          migration foundation settle in.
        </p>
        <dl className="facts">
          <div>
            <dt>Bind</dt>
            <dd>127.0.0.1</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>macOS-first local</dd>
          </div>
          <div>
            <dt>Surface</dt>
            <dd>Health check</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
