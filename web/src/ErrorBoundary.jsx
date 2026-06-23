import React from "react";

// Top-level safety net: a render error in any component shows a friendly fallback
// instead of a blank white screen. Styles are inline because App's injected <style>
// block is not present when the boundary's fallback renders in App's place.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surfaced to the console for diagnosis; never silently swallowed.
    console.error("[snout] UI error:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={{ minHeight: "100vh", background: "#060e20", color: "#e6ecff", display: "grid", placeItems: "center", padding: 24, fontFamily: "Inter, system-ui, -apple-system, sans-serif" }}>
        <div style={{ maxWidth: 460, textAlign: "center", background: "rgba(11,19,38,0.68)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, padding: 32 }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Something went wrong</div>
          <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "#aebbd9", marginBottom: 20 }}>
            The dashboard hit an unexpected error and couldn't render this view. Your data is safe on
            the server — reloading usually fixes it. If it persists, the browser console has details.
          </p>
          <button onClick={() => window.location.reload()} style={{ cursor: "pointer", background: "#adc6ff", color: "#06122e", border: 0, borderRadius: 6, padding: "0.55rem 1.1rem", fontSize: 13, fontWeight: 600 }}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
