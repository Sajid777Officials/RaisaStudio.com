// Legacy standalone admin compatibility screen.
// All content management now runs through Portfolio.html#admin with Supabase
// authentication and database-enforced roles.
function LegacyAdminRedirect() {
  React.useEffect(() => {
    window.location.replace("Portfolio.html#admin");
  }, []);

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
      <div>
        <h1>Opening secure admin</h1>
        <p>The legacy browser-only admin has been disabled.</p>
        <p><a href="Portfolio.html#admin">Continue to Portfolio Admin</a></p>
      </div>
    </div>
  );
}

const legacyAdminRoot = document.getElementById("admin-root");
if (legacyAdminRoot) {
  ReactDOM.createRoot(legacyAdminRoot).render(<LegacyAdminRedirect />);
}
