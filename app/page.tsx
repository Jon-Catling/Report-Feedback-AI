"use client";

import { ChangeEvent, DragEvent, useRef, useState } from "react";
import { EmailGate } from "./email-gate";
import { currentUserEmail, recordTokenUsage, TokenCounter } from "./token-counter";

type Feedback = {
  grade: string;
  gradeRationale: string;
  aiUseProbability: number;
  noticed: string;
  whyMark: string;
  improve: string;
};

const ACCEPTED = ".pdf,.doc,.docx,.rtf,.odt,.txt,.md";

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const criteriaInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [criteriaFile, setCriteriaFile] = useState<File | null>(null);
  const [scheme, setScheme] = useState("UK university percentage");
  const [level, setLevel] = useState("Undergraduate");
  const [criteria, setCriteria] = useState("");
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [error, setError] = useState("");

  function chooseFile(next?: File) {
    if (!next) return;
    if (next.size > 20 * 1024 * 1024) {
      setError("Please choose a file smaller than 20 MB.");
      return;
    }
    setFile(next);
    setFeedback(null);
    setError("");
  }

  function chooseCriteriaFile(next?: File) {
    if (!next) return;
    if (next.size > 10 * 1024 * 1024) {
      setError("Please choose a marking-criteria file smaller than 10 MB.");
      return;
    }
    setCriteriaFile(next);
    setFeedback(null);
    setError("");
  }

  function clearReport() {
    setFile(null);
    setFeedback(null);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function clearCriteriaFile() {
    setCriteriaFile(null);
    setFeedback(null);
    setError("");
    if (criteriaInputRef.current) criteriaInputRef.current.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files[0]);
  }

  async function generate() {
    if (!file) {
      setError("Please upload a report first.");
      return;
    }
    setLoading(true);
    setError("");
    setFeedback(null);
    const body = new FormData();
    body.append("report", file);
    body.append("scheme", scheme);
    body.append("level", level);
    body.append("criteria", criteria);
    if (criteriaFile) body.append("criteriaFile", criteriaFile);

    try {
      const response = await fetch("/api/feedback", { method: "POST", body, headers: { "x-user-email": currentUserEmail() } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Feedback could not be generated.");
      void recordTokenUsage(
        currentUserEmail(),
        Number(response.headers.get("x-openai-total-tokens") || 0),
        response.headers.get("x-openai-response-id") || "",
      );
      setFeedback(data);
      requestAnimationFrame(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Feedback could not be generated.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setFile(null);
    setFeedback(null);
    setError("");
    setCriteria("");
    setCriteriaFile(null);
    if (inputRef.current) inputRef.current.value = "";
    if (criteriaInputRef.current) criteriaInputRef.current.value = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <EmailGate><main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Report Feedback AI home">
          <span className="brand-mark">R</span>
          <span>Report Feedback <b>AI</b></span>
        </a>
        <div className="header-actions"><TokenCounter /><span className="header-note">Quantitative research reports</span></div>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow"><span /> Thoughtful, specific feedback</div>
        <h1>Turn a research report into<br /><em>useful feedback.</em></h1>
        <p className="hero-copy">Upload a quantitative research report to receive an indicative grade and concise, constructive feedback that students can act on.</p>
      </section>

      <section className="workspace" aria-label="Report feedback form">
        <div className="step-heading">
          <span>01</span>
          <div><h2>Upload the report</h2><p>PDF, Word or text document · maximum 20 MB</p></div>
        </div>

        <input ref={inputRef} type="file" accept={ACCEPTED} hidden onChange={(e: ChangeEvent<HTMLInputElement>) => chooseFile(e.target.files?.[0])} />
        <div
          className={`dropzone ${dragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        >
          <div className="upload-icon">{file ? "✓" : "↑"}</div>
          {file ? <><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(2)} MB · click to replace</span></> : <><strong>Drop your report here</strong><span>or <u>browse your files</u></span></>}
        </div>
        {file && <button type="button" className="clear-upload" onClick={clearReport}>Clear report upload</button>}

        <div className="divider" />
        <div className="step-heading">
          <span>02</span>
          <div><h2>Set the context</h2><p>This helps the feedback match the assessment</p></div>
        </div>

        <div className="control-grid">
          <label>Study level<select value={level} onChange={(e) => setLevel(e.target.value)}><option>Undergraduate</option><option>Postgraduate taught</option><option>Foundation year</option></select></label>
          <label>Grade format<select value={scheme} onChange={(e) => setScheme(e.target.value)}><option>UK university percentage</option><option>Letter grade (A–F)</option><option>Pass / Merit / Distinction</option></select></label>
        </div>
        <label className="criteria-label">Marking criteria or learning outcomes <span>optional</span>
          <textarea value={criteria} onChange={(e) => setCriteria(e.target.value)} maxLength={4000} placeholder="Paste any assignment-specific criteria here. If left blank, standard quantitative research-report criteria will be used." />
        </label>
        <div className="criteria-upload">
          <div><strong>Or upload marking criteria</strong><span>PDF, Word or text document · maximum 10 MB</span></div>
          <input ref={criteriaInputRef} type="file" accept={ACCEPTED} hidden onChange={(e: ChangeEvent<HTMLInputElement>) => chooseCriteriaFile(e.target.files?.[0])} />
          {criteriaFile ? <div className="criteria-file"><span><b>✓</b> {criteriaFile.name}</span><button type="button" onClick={clearCriteriaFile}>Clear criteria upload</button></div> : <button type="button" className="criteria-button" onClick={() => criteriaInputRef.current?.click()}>Upload marking criteria</button>}
        </div>

        {error && <div className="error" role="alert">{error}</div>}
        <button className="generate" onClick={generate} disabled={loading}>{loading ? <><span className="spinner" /> Reading and assessing your report…</> : <>Generate feedback <span>→</span></>}</button>
        <p className="privacy">Your report is used only to generate this feedback and is not stored by this site.</p>
      </section>

      {feedback && <section className="results" id="results">
        <div className="results-head"><div><span className="result-kicker">Indicative assessment</span><h2>Your report feedback</h2></div><button onClick={reset}>Assess another report</button></div>
        <div className="grade-card">
          <div><span>Indicative grade</span><strong>{feedback.grade}</strong></div>
          <div><span>Estimated probability of AI use</span><strong>{feedback.aiUseProbability}%</strong><small>Pattern-based estimate only — not proof of AI use</small></div>
          <p>{feedback.gradeRationale}</p>
        </div>
        <div className="feedback-grid">
          <article><span className="number">01</span><h3>I noticed about your work…</h3><p>{feedback.noticed}</p></article>
          <article><span className="number">02</span><h3>What you did well…</h3><p>{feedback.whyMark}</p></article>
          <article><span className="number">03</span><h3>To improve your work…</h3><p>{feedback.improve}</p></article>
        </div>
        <p className="disclaimer">This is an AI-generated indicative assessment, not an official mark. The AI-use probability is an uncertain, pattern-based estimate and must not be used alone for an academic-integrity decision. A tutor should review the report and feedback before it is shared with a student.</p>
      </section>}

      <footer><span>Report Feedback AI</span><p>Clear feedback. Practical feedforward.</p></footer>
    </main></EmailGate>
  );
}
