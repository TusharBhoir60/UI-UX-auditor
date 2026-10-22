import { AuditUrlForm } from './components/AuditUrlForm';

const features = [
  { icon: '◈', title: 'Verifiable accessibility', description: 'Deterministic checks for measurable issues, grounded in established accessibility criteria.' },
  { icon: '⌘', title: 'Evidence before opinion', description: 'Findings are designed to connect to a screenshot region and relevant page structure.' },
  { icon: '◎', title: 'Actionable priorities', description: 'Severity, confidence, and practical recommendations help teams decide what to fix first.' },
];

export default function HomePage() {
  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="UI/UX Auditor home"><span className="brand-mark">U</span><span>UI/UX Auditor</span></a>
        <span className="pill">MVP · Foundation build</span>
      </header>
      <section className="hero" id="top">
        <div className="eyebrow">Evidence-backed website audits</div>
        <h1>Better interfaces start with <span style={{ color: 'var(--accent)' }}>clear evidence.</span></h1>
        <p className="lede">Review accessibility, visual consistency, and usability in one structured report. Separate measurable facts from AI-assisted design judgment—so teams know what to fix and why.</p>
      </section>
      <section className="panel" aria-labelledby="audit-title">
        <label className="form-label" id="audit-title" htmlFor="website-url">Start with a website URL</label>
        <AuditUrlForm />
        <p className="helper" id="audit-helper">Audit submission will be enabled after authentication, URL validation, and the asynchronous pipeline are implemented.</p>
      </section>
      <section aria-labelledby="principles-title">
        <div className="section-head"><div><h2 id="principles-title">Designed around trust</h2><p>Three principles that shape every report.</p></div><span className="pill">Core product principles</span></div>
        <div className="grid">{features.map((feature) => <article className="feature" key={feature.title}><div className="feature-icon" aria-hidden="true">{feature.icon}</div><h3>{feature.title}</h3><p>{feature.description}</p></article>)}</div>
      </section>
      <footer className="footer"><span>UI/UX Auditor · Early foundation scaffold</span><span>No audits are submitted or processed in this version.</span></footer>
    </main>
  );
}
