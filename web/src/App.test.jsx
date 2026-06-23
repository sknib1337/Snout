import { render, screen } from "@testing-library/react";

// Control the API layer so the dashboard renders deterministically (no network).
const mocks = vi.hoisted(() => ({ readiness: vi.fn() }));
vi.mock("./api.js", () => ({
  getAuth: vi.fn(async () => ({ oidcEnabled: false, authenticated: true })),
  getFeatures: vi.fn(async () => ({ catalog: true })),
  getReadiness: mocks.readiness,
  listAssessments: vi.fn(async () => []),
  listDiscovered: vi.fn(async () => []),
  listAlerts: vi.fn(async () => []),
  listKb: vi.fn(async () => []),
  assess: vi.fn(),
  assessDiscovered: vi.fn(),
  deleteDiscovered: vi.fn(),
  verifyControl: vi.fn(),
  loginUrl: () => "/auth/login",
  logout: vi.fn(),
}));

import App from "./App.jsx";

const ready = (over = {}) => ({ assessReady: true, webSearch: true, provider: "anthropic", model: "m", store: "json", catalog: true, webhooks: false, oidc: false, ...over });

beforeEach(() => { localStorage.clear(); mocks.readiness.mockReset(); });

describe("App readiness/activation", () => {
  it("renders the shell without crashing", async () => {
    mocks.readiness.mockResolvedValue(ready());
    render(<App />);
    expect(await screen.findByPlaceholderText(/search or assess an app/i)).toBeInTheDocument();
  });

  it("shows 'Setup needed' + a setup banner when no provider key", async () => {
    mocks.readiness.mockResolvedValue(ready({ assessReady: false, webSearch: false }));
    render(<App />);
    expect(await screen.findByText(/setup needed/i)).toBeInTheDocument();
    expect(await screen.findByText(/finish setup/i)).toBeInTheDocument();
  });

  it("shows 'System Healthy' when ready with web search", async () => {
    mocks.readiness.mockResolvedValue(ready());
    render(<App />);
    expect(await screen.findByText(/system healthy/i)).toBeInTheDocument();
  });

  it("offers a 'Load sample data' affordance on the empty state", async () => {
    mocks.readiness.mockResolvedValue(ready({ assessReady: false, webSearch: false }));
    render(<App />);
    const hits = await screen.findAllByText(/load sample data/i);
    expect(hits.length).toBeGreaterThan(0);
  });
});
