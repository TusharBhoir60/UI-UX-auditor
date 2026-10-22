'use client';

export function AuditUrlForm() {
  return (
    <form className="audit-form" action="#audit-preview" onSubmit={(event) => event.preventDefault()}>
      <input id="website-url" type="url" placeholder="https://example.com" aria-describedby="audit-helper" disabled />
      <button type="submit" disabled>Audit website ↗</button>
    </form>
  );
}
