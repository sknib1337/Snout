import { render, screen } from "@testing-library/react";
import ErrorBoundary from "./ErrorBoundary.jsx";

function Boom() { throw new Error("boom"); }

describe("ErrorBoundary", () => {
  it("renders children when there is no error", () => {
    render(<ErrorBoundary><div>hello world</div></ErrorBoundary>);
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("renders a friendly fallback when a child throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {}); // expected React error noise
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload/i })).toBeInTheDocument();
    spy.mockRestore();
  });
});
