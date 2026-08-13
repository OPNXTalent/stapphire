// Minimal, static config-error state - no data fetching, nothing
// sensitive rendered. Shown only in production when SITE_PASSWORD
// isn't set, so the gate can fail closed with an honest explanation
// instead of a login form that can never actually succeed.
export default function GateConfigErrorPage() {
  return (
    <div style={{ maxWidth: 420, margin: '60px auto 0' }}>
      <div className="card">
        <h1 style={{ fontSize: 22, marginBottom: 4 }}>Configuration required</h1>
        <p className="muted">
          This workspace isn't fully configured yet. Please contact the administrator.
        </p>
      </div>
    </div>
  );
}
