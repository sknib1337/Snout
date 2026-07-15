import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer,
} from "recharts";
import {
  Shield, ShieldCheck, Search, Plus, ArrowLeft, ExternalLink, Check,
  AlertTriangle, X, HelpCircle, Webhook, Database, Users, LogOut, KeyRound,
  Radio, Fingerprint, Building2, Loader2, Copy, RefreshCw, Network, FileText,
  Layers, ScanSearch, ChevronRight, Sparkles, ListChecks, ShieldAlert,
  LayoutDashboard, Boxes, Clock, TerminalSquare, Radar as RadarIcon, Trash2,
} from "lucide-react";
import { assess as apiAssess, listAssessments, listDiscovered, assessDiscovered, deleteDiscovered, getFeatures, getReadiness, verifyControl, listAlerts, listKb, getAuth, loginUrl, logout } from "./api";
import { useToast } from "./toast.jsx";

/* ============================================================ *
 * Snout — Critical Enterprise SaaS Controls console
 * Visual system: "Obsidian Command" / immersive deck.
 * ============================================================ */

// Data and the agent live on the server — see ./api

// Palette — values mirror the canonical tokens in ./tokens.css (--sn-*). Kept as
// hex here (not var() strings) because dozens of call sites build alpha tints by
// concatenation (`C.x + "1a"`) and SVG attributes can't resolve var() — the same
// pattern the v2 prototype uses. tokens.css is the source of truth; change there
// first, mirror here.
const C = {
  bg: "#0b1326", scLowest: "#060e20", scLow: "#131b2e", sc: "#171f33",
  scHigh: "#222a3d", scHighest: "#2d3449", bright: "#31394d",
  on: "#dae2fd", onVar: "#c2c6d6",
  dim: "#9aa3bd",       // --sn-text-dim — minimum TEXT color (AA on raised surfaces)
  outline: "#8c909f",   // --sn-outline — DEMOTED: borders/decoration only (fails AA as text)
  outlineVar: "#424754",
  primary: "#adc6ff", primaryStrong: "#4d8eff", onPrimary: "#002e6a",
  secondary: "#4edea3", onSecondary: "#003824",
  tertiary: "#ffb95f", onTertiary: "#472a00",
  error: "#ffb4ab", onError: "#690005",
  unknown: "#9aa3bd",   // --sn-unknown — moved off #8c909f (pill failed AA)
};

const CAPS = [
  { key: "sso",            label: "Single Sign-On",      short: "SSO",          icon: Fingerprint, standard: "SAML 2.0 / OIDC" },
  { key: "ulm",            label: "User Lifecycle",      short: "Lifecycle",    icon: Users,       standard: "SCIM 2.0" },
  { key: "entitlements",   label: "Entitlements",        short: "Entitlements", icon: Layers,      standard: "SCIM groups / RBAC" },
  { key: "riskSignals",    label: "Risk Signal Sharing", short: "Signals",      icon: Radio,       standard: "CAEP / SSF" },
  { key: "logout",         label: "Logout",              short: "Logout",       icon: LogOut,      standard: "RP-initiated / SLO" },
  { key: "tokenRevocation",label: "Token Revocation",    short: "Revocation",   icon: KeyRound,    standard: "OAuth 2.0 / CAE" },
];

// Verdict rendering — glyph + label + color, always all three (color is never
// the only channel). Weights are product logic; do not touch.
const VERDICTS = {
  supported:   { label: "Supported",   g: "✓", weight: 100, pill: "pill-green", dot: C.secondary, Icon: Check },
  partial:     { label: "Partial",     g: "◐", weight: 55,  pill: "pill-amber", dot: C.tertiary,  Icon: AlertTriangle },
  unsupported: { label: "Unsupported", g: "✕", weight: 8,   pill: "pill-red",   dot: C.error,     Icon: X },
  unknown:     { label: "Unknown",     g: "?", weight: 25,  pill: "pill-gray",  dot: C.unknown,   Icon: HelpCircle },
};
const verdictOf = (v) => VERDICTS[v] || VERDICTS.unknown;

// Provenance — quiet unbordered text, per the v2 voice rule.
const PROV = {
  "kb-verified": { g: "◆", label: "kb-verified", c: "#adc6ff" },
  agent:         { g: "◇", label: "agent",       c: "#8fb5ff" },
  "kb-proposed": { g: "◇", label: "proposed",    c: "#ffb95f" },
};

const EXTENDED = [
  { key: "discoverability",    label: "Feature discoverability",         icon: ScanSearch },
  { key: "onboardingRecovery", label: "Onboarding & recovery",           icon: Users },
  { key: "enterpriseDiscovery",label: "In-enterprise discovery",         icon: Search },
  { key: "usageMonitoring",    label: "Usage monitoring & provisioning", icon: Network },
  { key: "usageRestrictions",  label: "Usage restrictions",              icon: ShieldAlert },
];
const FUNCTIONS = [
  "Sourcing", "Finance", "Requesting BU", "Third-Party Governance",
  "Third-Party Risk", "Security Architecture", "IT Engineering",
];

// Governance-outcome pill spec — glyph + label + color (mono caps, a11y exception).
function govOf(rec) {
  switch (rec) {
    case "Approve":                 return { g: "✓", short: "Approve",    c: C.secondary };
    case "Approve with conditions": return { g: "◐", short: "Conditions", c: C.tertiary };
    case "Reject":                  return { g: "✕", short: "Reject",     c: C.error };
    case "Hold":                    return { g: "◷", short: "Hold",       c: C.primary };
    default:                        return { g: "◷", short: rec || "—",   c: C.onVar };
  }
}
function GovPill({ rec, full }) {
  const o = govOf(rec);
  return <span className="pill" style={{ background: `${o.c}21`, borderColor: `${o.c}4d`, color: o.c }}><span aria-hidden="true">{o.g}</span>{full ? rec : o.short}</span>;
}
function computeScore(capabilities) {
  if (!capabilities) return 0;
  const vals = CAPS.map((c) => verdictOf(capabilities[c.key]?.verdict).weight);
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}
function readinessOf(score) {
  if (score >= 80) return { label: "Ready",     g: "✓", color: C.secondary };
  if (score >= 50) return { label: "Partial",   g: "◐", color: C.tertiary };
  return { label: "Not ready", g: "✕", color: C.error };
}
const scoreColor = (s) => (s >= 80 ? C.secondary : s >= 50 ? C.tertiary : C.error);
const fmtDate = (iso) => { try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return "just now"; if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

/* --------------------------- Styles --------------------------- */

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;700&display=swap');
html,body{background:${C.scLowest};}
.ob{min-height:100vh;background:transparent;color:${C.on};font-family:'Inter',ui-sans-serif,system-ui,-apple-system,sans-serif;position:relative;}
.ob *{box-sizing:border-box;}
.ob-bg{position:fixed;inset:0;z-index:-20;background:
  radial-gradient(1200px 800px at 70% -10%, rgba(77,142,255,0.10), transparent 60%),
  radial-gradient(900px 700px at 0% 100%, rgba(78,222,163,0.06), transparent 55%),
  linear-gradient(160deg, ${C.bg} 0%, ${C.scLowest} 100%);}
.ob-shader{position:fixed;inset:0;width:100%;height:100%;z-index:-10;display:block;}
.disp{font-family:'Hanken Grotesk','Inter',sans-serif;letter-spacing:-0.01em;}
.mono{font-family:'JetBrains Mono',ui-monospace,monospace;}
/* v2 voice: section labels are quiet Inter sentence case, not mono caps. Mono is
   reserved for data literals; verdict/governance/band pills keep mono caps via .pill. */
.caps{font-family:Inter,sans-serif;font-size:11px;font-weight:500;letter-spacing:0.01em;text-transform:none;line-height:1.3;color:#8f98b3;}
.txt-var{color:${C.onVar};}.txt-dim{color:${C.dim};}
.txt-primary{color:${C.primary};}.txt-secondary{color:${C.secondary};}.txt-tertiary{color:${C.tertiary};}.txt-error{color:${C.error};}
.brandtext{background:linear-gradient(90deg, ${C.primary}, ${C.secondary});-webkit-background-clip:text;background-clip:text;color:transparent;}
.panel{background:rgba(11,19,38,0.68);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.10);border-radius:0.5rem;}
.panel-i{background:rgba(11,19,38,0.68);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.10);border-radius:0.5rem;transition:transform .25s ease, box-shadow .25s ease, border-color .25s ease, background .15s ease;}
.panel-i:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,0.4), 0 0 15px rgba(173,198,255,0.10);border-color:rgba(255,255,255,0.20);}
.glass{background:linear-gradient(135deg,rgba(49,57,77,0.45) 0%,rgba(6,14,32,0.85) 100%);border:1px solid rgba(255,255,255,0.10);border-radius:0.5rem;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);}
.hair{border-color:rgba(255,255,255,0.08);}
.navitem{display:flex;align-items:center;justify-content:space-between;gap:0.75rem;padding:0.6rem 0.75rem;border-radius:0.5rem;color:${C.dim};cursor:pointer;width:100%;text-align:left;border:0;background:transparent;transition:background .18s,color .18s;position:relative;overflow:visible;}
.navitem:hover{background:rgba(23,31,51,0.6);color:${C.on};}
.navitem.active{color:${C.on};background:rgba(23,31,51,0.9);}
.navlabel{display:flex;align-items:center;gap:0.7rem;position:relative;z-index:2;font-family:Inter,sans-serif;font-size:13px;font-weight:500;letter-spacing:0;text-transform:none;}
.accentbar{position:absolute;left:-10px;top:6px;bottom:6px;width:3px;border-radius:2px;background:linear-gradient(180deg,${C.primary},${C.secondary});box-shadow:0 0 10px rgba(173,198,255,0.5);z-index:3;}
.dot{width:8px;height:8px;border-radius:99px;display:inline-block;}
.pulse-green{animation:pg 2s infinite;}
@keyframes pg{0%{box-shadow:0 0 0 0 rgba(78,222,163,0.7);}70%{box-shadow:0 0 0 6px rgba(78,222,163,0);}100%{box-shadow:0 0 0 0 rgba(78,222,163,0);}}
.btn-primary{display:inline-flex;align-items:center;justify-content:center;gap:0.45rem;background:${C.primary};color:${C.onPrimary};border:0;border-radius:0.5rem;font-family:Inter,sans-serif;font-size:12.5px;font-weight:600;letter-spacing:0;text-transform:none;cursor:pointer;transition:filter .12s;}
.btn-primary:hover{filter:brightness(1.08);}
.btn-primary:disabled{opacity:0.45;cursor:default;filter:none;}
.btn-ghost{display:inline-flex;align-items:center;gap:0.4rem;border:1px solid ${C.outlineVar};color:${C.onVar};background:transparent;border-radius:0.5rem;cursor:pointer;font-family:Inter,sans-serif;font-size:12px;font-weight:500;transition:background .12s,border-color .12s,color .12s;}
.btn-ghost:hover{background:${C.scHigh};border-color:${C.outline};color:${C.on};}
.inp{width:100%;background:rgba(2,6,17,0.6);border:1px solid ${C.outlineVar};border-radius:0.25rem;color:${C.on};font-size:14px;}
.inp::placeholder{color:${C.outline};}
.inp:focus{outline:none;border-color:${C.primary};}
.inp:disabled{opacity:0.5;}
/* Verdict/governance/band pills stay mono caps (accessibility exception):
   glyph + label + color on a 13% tint bg with a 30% tint border. */
.pill{display:inline-flex;align-items:center;gap:0.3rem;border-radius:999px;padding:0.14rem 0.55rem 0.14rem 0.45rem;font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;white-space:nowrap;border:1px solid transparent;}
.pill-green{background:rgba(78,222,163,0.13);color:${C.secondary};border-color:rgba(78,222,163,0.30);}
.pill-amber{background:rgba(255,185,95,0.13);color:${C.tertiary};border-color:rgba(255,185,95,0.30);}
.pill-red{background:rgba(255,180,171,0.13);color:${C.error};border-color:rgba(255,180,171,0.30);}
.pill-gray{background:rgba(154,163,189,0.13);color:${C.unknown};border-color:rgba(154,163,189,0.30);}
.pill-blue{background:rgba(143,181,255,0.13);color:#8fb5ff;border-color:rgba(143,181,255,0.30);}
.badge{font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;padding:0.1rem 0.35rem;border-radius:0.25rem;background:rgba(173,198,255,0.10);color:${C.primary};border:1px solid rgba(173,198,255,0.20);}
.chip{display:inline-flex;align-items:center;border-radius:0.25rem;padding:0.08rem 0.4rem;background:rgba(173,198,255,0.10);color:${C.primary};font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:500;}
.cite{display:inline-flex;align-items:center;gap:0.3rem;max-width:100%;padding:0.12rem 0.45rem;border-radius:0.25rem;background:rgba(2,6,17,0.5);color:${C.onVar};font-size:11px;text-decoration:none;transition:background .12s,color .12s;border:1px solid ${C.outlineVar};}
.cite:hover{background:${C.scHigh};color:${C.on};}
.rowlink{display:flex;align-items:center;gap:1rem;width:100%;text-align:left;background:transparent;border:0;cursor:pointer;transition:background .12s;}
.rowlink:hover{background:rgba(45,52,73,0.45);}
.tbl-row:hover{background:rgba(45,52,73,0.4);}
.terminal{background:rgba(2,6,17,0.8);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.10);border-radius:0.375rem;box-shadow:inset 0 1px 8px rgba(0,0,0,0.5);}
.term-input{background:transparent;border:0;outline:none;color:${C.on};width:100%;font-family:'JetBrains Mono',monospace;font-size:11px;}
.term-input::placeholder{color:${C.outlineVar};}
.ob ::-webkit-scrollbar{width:10px;height:10px;}
.ob ::-webkit-scrollbar-thumb{background:${C.outlineVar};border-radius:6px;}
.ob ::-webkit-scrollbar-thumb:hover{background:${C.outline};}
.ob ::-webkit-scrollbar-track{background:transparent;}
@keyframes spin{to{transform:rotate(360deg);}}
.spin{animation:spin 1s linear infinite;}
.codeblk{background:rgba(2,6,17,0.7);border:1px solid ${C.outlineVar};border-radius:0.375rem;overflow:hidden;}
.codeblk-bar{display:flex;align-items:center;justify-content:space-between;padding:0.4rem 0.75rem;background:rgba(11,19,38,0.6);border-bottom:1px solid ${C.outlineVar};}
@media (prefers-reduced-motion: reduce){.pulse-green{animation:none;}}
`;

function Style() { return <style dangerouslySetInnerHTML={{ __html: STYLES }} />; }

/* --------------------------- Shader background --------------------------- */

function ShaderBG() {
  const ref = useRef(null);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return; // CSS gradient fallback handles it
    const canvas = ref.current; if (!canvas) return;
    let gl, raf, prog; let mouseX = 0, mouseY = 0;
    try {
      gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (!gl) return;
      const vs = `attribute vec2 p; varying vec2 uv; void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.0,1.0); }`;
      const fs = `precision highp float; varying vec2 uv; uniform float u_time; uniform vec2 u_res; uniform vec2 u_mouse;
        void main(){
          vec2 p = uv*2.0-1.0; p.x *= u_res.x/u_res.y;
          vec3 c1 = vec3(0.043,0.075,0.149); vec3 c2 = vec3(0.024,0.055,0.125); vec3 acc = vec3(0.231,0.51,0.965);
          // v2 calm pass: time step ~40% slower, mouse glow x0.7, grid quieter.
          float t = u_time*0.12; float v = 0.0;
          v += sin(p.x*2.0+t); v += sin((p.y*1.5+t)*0.5); v += sin((p.x+p.y+t)*0.7);
          vec3 col = mix(c1,c2, v*0.5+0.5);
          vec2 m = u_mouse/u_res; vec2 mP = m*2.0-1.0; mP.x *= u_res.x/u_res.y;
          float d = length(p-mP); col += acc*(0.02/(d+0.1))*0.21;
          vec2 g = fract(uv*40.0);
          float line = smoothstep(0.0,0.05,g.x)*smoothstep(1.0,0.95,g.x)*smoothstep(0.0,0.05,g.y)*smoothstep(1.0,0.95,g.y);
          col = mix(col, col*1.1, (1.0-line)*0.06);
          gl_FragColor = vec4(col,1.0);
        }`;
      const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
      prog = gl.createProgram();
      gl.attachShader(prog, mk(gl.VERTEX_SHADER, vs));
      gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(prog); gl.useProgram(prog);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 1, 1, 1, -1, -1, 1, -1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const uT = gl.getUniformLocation(prog, "u_time"), uR = gl.getUniformLocation(prog, "u_res"), uM = gl.getUniformLocation(prog, "u_mouse");
      const onMove = (e) => { mouseX = e.clientX; mouseY = window.innerHeight - e.clientY; };
      window.addEventListener("mousemove", onMove);
      const render = (time) => {
        const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
        gl.uniform1f(uT, time * 0.001); gl.uniform2f(uR, canvas.width, canvas.height); gl.uniform2f(uM, mouseX || canvas.width * 0.7, mouseY || canvas.height * 0.5);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); raf = requestAnimationFrame(render);
      };
      raf = requestAnimationFrame(render);
      return () => { cancelAnimationFrame(raf); window.removeEventListener("mousemove", onMove); };
    } catch { /* fall back to CSS gradient */ }
  }, []);
  return <canvas ref={ref} className="ob-shader" aria-hidden="true" />;
}

/* --------------------------- UI atoms --------------------------- */

// Brand mark — single-path SVG from assets/mark.svg; the brand gradient lives
// here (and only here — buttons are solid per the v2 voice rule). The gradient
// def is rendered ONCE globally (BrandDefs) because Logo mounts in several
// places (some display:none) and duplicate ids break url() resolution.
function BrandDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <linearGradient id="sn-gsig" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#adc6ff" /><stop offset="1" stopColor="#4edea3" />
        </linearGradient>
        <path id="sn-mark" fillRule="evenodd" d="M38,20 L58,20 Q67,20 71.93,27.52 L81.07,41.48 Q86,49 81.07,56.52 L71.93,70.48 Q67,78 58,78 L38,78 Q29,78 24.07,70.48 L14.93,56.52 Q10,49 14.93,41.48 L24.07,27.52 Q29,20 38,20 Z M31.63,51.25 a6,10.5 12 1,0 11.74,2.50 a6,10.5 12 1,0 -11.74,-2.50 Z M52.63,53.75 a6,10.5 -12 1,0 11.74,-2.50 a6,10.5 -12 1,0 -11.74,2.50 Z" />
      </defs>
    </svg>
  );
}
function SnoutMark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" aria-hidden="true">
      <use href="#sn-mark" fill="url(#sn-gsig)" />
    </svg>
  );
}

function Logo({ compact }) {
  return (
    <div className="flex items-center" style={{ gap: 10 }}>
      <SnoutMark size={compact ? 24 : 28} />
      <span className="disp" style={{ fontSize: compact ? 17 : 19, fontWeight: 800, color: C.on, letterSpacing: "-0.015em" }}>snout</span>
    </div>
  );
}

function ScoreDial({ score, size = 64 }) {
  const r = size / 2 - 6, c = 2 * Math.PI * r, off = c * (1 - score / 100), col = scoreColor(score);
  return (
    <div className="relative grid place-items-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.scHigh} strokeWidth="6" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth="6" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" style={{ transition: "stroke-dashoffset .9s ease" }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="disp" style={{ color: col, fontSize: size * 0.32, fontWeight: 700 }}>{score}</span>
      </div>
    </div>
  );
}

function CapStrip({ capabilities }) {
  return (
    <div className="flex items-center gap-1.5">
      {CAPS.map((c) => {
        const v = verdictOf(capabilities?.[c.key]?.verdict);
        return <span key={c.key} title={`${c.label}: ${v.label}`} style={{ width: 9, height: 9, borderRadius: 99, background: v.dot, display: "inline-block" }} />;
      })}
    </div>
  );
}
function VerdictPill({ verdict }) { const v = verdictOf(verdict); return <span className={`pill ${v.pill}`}><span aria-hidden="true">{v.g}</span>{v.label}</span>; }

function safeHref(u) {
  try { const x = new URL(u); return (x.protocol === "http:" || x.protocol === "https:") ? x.href : null; }
  catch { return null; }
}
function Citations({ items }) {
  const safe = (items || []).map((c) => ({ ...c, href: safeHref(c.url) })).filter((c) => c.href);
  if (!safe.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {safe.map((c, i) => (
        <a key={i} href={c.href} target="_blank" rel="noopener noreferrer nofollow" className="cite">
          <ExternalLink className="w-3 h-3 shrink-0" /><span className="truncate">{c.title || c.href}</span>
        </a>
      ))}
    </div>
  );
}

function CodeBlock({ code, label }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(code); } catch { /* sandbox */ } setCopied(true); setTimeout(() => setCopied(false), 1400); };
  return (
    <div className="codeblk">
      <div className="codeblk-bar">
        <span className="mono txt-dim" style={{ fontSize: 11 }}>{label}</span>
        <button onClick={copy} className="flex items-center gap-1 txt-var" style={{ fontSize: 11, background: "transparent", border: 0, cursor: "pointer" }}><Copy className="w-3 h-3" />{copied ? "Copied" : "Copy"}</button>
      </div>
      <pre className="mono" style={{ margin: 0, padding: "0.75rem", overflowX: "auto", fontSize: 11.5, lineHeight: 1.6, color: C.on, whiteSpace: "pre" }}>{code}</pre>
    </div>
  );
}

function KpiTile({ label, value, sub, subColor, Icon }) {
  return (
    <div className="panel-i p-4 flex flex-col justify-between" style={{ minHeight: 104 }}>
      <div className="flex items-start justify-between">
        <span className="caps txt-var">{label}</span>
        {Icon && <Icon className="w-4 h-4" style={{ color: C.outlineVar }} />}
      </div>
      <div>
        <div className="disp" style={{ fontSize: 26, fontWeight: 600, color: C.on }}>{value}</div>
        {sub && <div className="mono" style={{ fontSize: 11, marginTop: 2, color: subColor || C.onVar }}>{sub}</div>}
      </div>
    </div>
  );
}

function AssessmentRow({ a, onOpen }) {
  return (
    <button onClick={() => onOpen(a.id)} className="rowlink px-4 py-3 group">
      <ScoreDial score={a.score} size={46} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="disp truncate" style={{ fontWeight: 600, fontSize: 15, color: C.on }}>{a.app}</span>
          {a.vendor && <span className="mono txt-dim truncate" style={{ fontSize: 11 }}>· {a.vendor}</span>}
        </div>
        <div className="flex items-center gap-3 mt-1.5"><CapStrip capabilities={a.capabilities} /><span className="txt-dim" style={{ fontSize: 11, fontFamily: "Inter, sans-serif" }}>{a.category}</span></div>
      </div>
      <GovPill rec={a.recommendation} />
      <span className="txt-dim hidden sm:block" style={{ fontSize: 11, width: 92, textAlign: "right", fontFamily: "Inter, sans-serif" }}>{ago(a.assessedAt)}</span>
      <ChevronRight className="w-4 h-4 txt-dim group-hover:text-white" />
    </button>
  );
}

/* --------------------------- Command Center (v2) --------------------------- */

// Short mono column headers for the coverage matrix, per control.
const MATRIX_COLS = { sso: "SSO", ulm: "SCIM", entitlements: "ENTITLE", riskSignals: "CAEP/SSF", logout: "LOGOUT", tokenRevocation: "REVOKE" };

// Vendors × controls grid — makes systemic weaknesses (one control failing
// everywhere) visible without opening each assessment.
function CoverageMatrix({ assessments, onOpen }) {
  const weakest = useMemo(() => {
    let weak = null;
    for (const c of CAPS) {
      const n = assessments.filter((a) => a.capabilities?.[c.key]?.verdict === "supported").length;
      if (!weak || n < weak.n) weak = { n, label: c.label };
    }
    return weak;
  }, [assessments]);
  return (
    <div className="panel" style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
      <div className="flex items-center gap-3 px-4 py-3 border-b hair">
        <span style={{ font: "600 13px Inter, sans-serif", color: C.on, flex: "none" }}>Control coverage</span>
        {weakest && <span className="txt-dim" style={{ marginLeft: "auto", fontSize: 11.5, textAlign: "right" }}>Weakest: {weakest.label} — supported by {weakest.n} of {assessments.length}</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr repeat(6, 1fr)", gap: "0 10px", padding: "9px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <span className="caps">Vendor</span>
        {CAPS.map((c) => <span key={c.key} className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.05em", color: "#8f98b3", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{MATRIX_COLS[c.key]}</span>)}
      </div>
      {assessments.map((a) => (
        <button key={a.id} onClick={() => onOpen(a.id)} style={{ display: "grid", gridTemplateColumns: "1.1fr repeat(6, 1fr)", gap: "0 10px", alignItems: "center", padding: "7px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)", cursor: "pointer", width: "100%", background: "transparent", border: 0, textAlign: "left" }} className="tbl-row">
          <span style={{ font: "500 12.5px Inter, sans-serif", color: C.on, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.app}</span>
          {CAPS.map((c) => {
            const cap = a.capabilities?.[c.key] || {};
            const v = verdictOf(cap.verdict);
            const conf = typeof cap.confidence === "number" ? ` · ${Math.round(cap.confidence * 100)}% conf` : "";
            return <span key={c.key} title={`${c.label}: ${v.label.toLowerCase()}${conf}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 24, borderRadius: 6, background: `${v.dot}1a`, color: v.dot, font: "700 11px 'JetBrains Mono', monospace" }}>{v.g}</span>;
          })}
        </button>
      ))}
      <div className="flex items-center flex-wrap px-4" style={{ gap: 14, padding: "9px 16px" }}>
        {Object.values(VERDICTS).map((v) => <span key={v.label} className="txt-dim" style={{ fontSize: 10.5 }}>{v.g} {v.label.toLowerCase()}</span>)}
        <span className="txt-dim" style={{ marginLeft: "auto", fontSize: 10.5 }}>Click a row for its packet</span>
      </div>
    </div>
  );
}

// Live queue of everything waiting on the operator — real state only.
function NeedsAttention({ kbPending, kbStale, discoveredUnassessed, goKnowledge, goDiscovered }) {
  const items = [
    { g: "◇", c: "#ffb95f", text: `${kbPending} KB proposal${kbPending === 1 ? "" : "s"} awaiting verification`, show: kbPending > 0, go: goKnowledge },
    { g: "◷", c: "#ffb95f", text: `${kbStale} stale evidence item${kbStale === 1 ? "" : "s"} (>180d)`, show: kbStale > 0, go: goKnowledge },
    { g: "●", c: "#8fb5ff", text: `${discoveredUnassessed} discovered vendor${discoveredUnassessed === 1 ? "" : "s"} unassessed`, show: discoveredUnassessed > 0, go: goDiscovered },
  ].filter((x) => x.show);
  return (
    <div className="panel" style={{ width: 280, flex: "none", padding: "14px 16px" }}>
      <div style={{ font: "600 12.5px Inter, sans-serif", color: C.onVar, marginBottom: 6 }}>Needs attention</div>
      {items.length === 0 ? (
        <div className="txt-dim" style={{ fontSize: 12, lineHeight: 1.5, padding: "6px 0" }}>All clear — nothing waiting on you. ✓</div>
      ) : items.map((x, i) => (
        <button key={i} onClick={x.go} className="tbl-row" style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 6px", borderRadius: 8, margin: "0 -6px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.05)", width: "calc(100% + 12px)", background: "transparent", border: 0, textAlign: "left" }}>
          <span aria-hidden="true" style={{ fontSize: 11, flex: "none", color: x.c }}>{x.g}</span>
          <span style={{ font: "400 12px/1.4 Inter, sans-serif", color: C.onVar, minWidth: 0 }}>{x.text}</span>
          <span aria-hidden="true" style={{ marginLeft: "auto", flex: "none", color: C.dim, fontSize: 11 }}>→</span>
        </button>
      ))}
    </div>
  );
}

function CommandCenter({ assessments, discovered, kbPending, kbStale, kbCount, readiness, onOpen, onNew, goCatalog, goDiscovered, goKnowledge, onAssessDiscovered, busyDomain, onDemo }) {
  const stats = useMemo(() => {
    const n = assessments.length;
    const avg = n ? Math.round(assessments.reduce((a, x) => a + x.score, 0) / n) : 0;
    const ready = assessments.filter((x) => x.score >= 80).length;
    return { n, avg, ready };
  }, [assessments]);
  const recent = useMemo(() => [...assessments].sort((a, b) => new Date(b.assessedAt) - new Date(a.assessedAt)).slice(0, 6), [assessments]);
  const unassessed = useMemo(() => (discovered || []).filter((d) => !d.assessment), [discovered]);
  const band = readinessOf(stats.avg);
  if (stats.n === 0) return <EmptyState onNew={onNew} onDemo={onDemo} />;

  return (
    <div className="space-y-4">
      {/* Hero metric */}
      <div className="panel flex items-center flex-wrap" style={{ gap: 32, borderRadius: 14, padding: "20px 26px" }}>
        <div style={{ flex: "none" }}>
          <div style={{ font: "500 12.5px Inter, sans-serif", color: C.dim }}>Portfolio trust</div>
          <div className="flex items-center" style={{ gap: 14, marginTop: 4 }}>
            <span className="disp" style={{ fontSize: 50, fontWeight: 800, lineHeight: 1, color: C.on }}>{stats.avg}</span>
            <span className="pill" style={{ background: `${band.color}21`, borderColor: `${band.color}4d`, color: band.color }}>{band.g} {band.label}</span>
          </div>
          <div style={{ font: "400 12px Inter, sans-serif", color: C.dim, marginTop: 7 }}>Mean score of {stats.n} assessed {stats.n === 1 ? "vendor" : "vendors"}</div>
        </div>
        <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.08)" }} />
        <div className="flex items-center flex-wrap" style={{ gap: 38 }}>
          <div><div className="disp" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, color: C.on }}>{stats.ready}</div><div style={{ font: "400 12px Inter, sans-serif", color: C.dim, marginTop: 5 }}>Controls Ready · ≥80</div></div>
          <div><div className="disp" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, color: C.on }}>{stats.n}</div><div style={{ font: "400 12px Inter, sans-serif", color: C.dim, marginTop: 5 }}>Assessed vendors</div></div>
          <div><div className="disp" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, color: C.tertiary }}>{unassessed.length}</div><div style={{ font: "400 12px Inter, sans-serif", color: C.dim, marginTop: 5 }}>Discovered, unassessed</div></div>
        </div>
      </div>

      {/* Recent + right rail */}
      <div className="flex flex-wrap items-start" style={{ gap: 16 }}>
        <div className="panel" style={{ flex: 1, minWidth: 320, overflow: "hidden" }}>
          <div className="flex items-center justify-between px-4 py-3 border-b hair">
            <span style={{ font: "600 13px Inter, sans-serif", color: C.on }}>Recent assessments</span>
            <button onClick={goCatalog} style={{ font: "500 12px Inter, sans-serif", color: C.primary, background: "transparent", border: 0, cursor: "pointer" }}>View all →</button>
          </div>
          <div>{recent.map((a) => <div key={a.id} className="border-b" style={{ borderColor: "rgba(255,255,255,0.05)" }}><AssessmentRow a={a} onOpen={onOpen} /></div>)}</div>
        </div>
        <div style={{ width: 280, flex: "none", display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="panel" style={{ padding: "14px 16px" }}>
            <div style={{ font: "600 12.5px Inter, sans-serif", color: C.onVar, marginBottom: 10 }}>System</div>
            <div className="flex justify-between" style={{ marginBottom: 8 }}><span style={{ font: "400 12px Inter, sans-serif", color: C.dim }}>Engine</span><span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: C.secondary, whiteSpace: "nowrap" }}>✓ v1.0.0</span></div>
            <div className="flex justify-between" style={{ marginBottom: 8 }}><span style={{ font: "400 12px Inter, sans-serif", color: C.dim }}>Grounding</span><span className="mono" style={{ fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap", color: readiness?.webSearch ? C.secondary : C.tertiary }}>{readiness?.webSearch ? "✓ Full · cited" : "◐ Reduced · capped"}</span></div>
            <div className="flex justify-between" style={{ marginBottom: 8 }}><span style={{ font: "400 12px Inter, sans-serif", color: C.dim }}>Knowledge base</span><span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: C.onVar, whiteSpace: "nowrap" }}>{kbCount != null ? `${kbCount} vendors` : "—"}</span></div>
            <div className="flex justify-between"><span style={{ font: "400 12px Inter, sans-serif", color: C.dim }}>Store</span><span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: C.onVar, whiteSpace: "nowrap" }}>{readiness?.store || "—"}</span></div>
          </div>
          <div className="panel" style={{ padding: "14px 16px" }}>
            <div className="flex items-center" style={{ marginBottom: 6 }}>
              <span style={{ font: "600 12.5px Inter, sans-serif", color: C.onVar }}>Discovery feed</span>
              <button onClick={goDiscovered} style={{ marginLeft: "auto", font: "500 12px Inter, sans-serif", color: C.primary, background: "transparent", border: 0, cursor: "pointer" }}>All →</button>
            </div>
            {unassessed.length === 0 ? (
              <div className="txt-dim" style={{ fontSize: 12, padding: "6px 0" }}>Nothing unassessed. ✓</div>
            ) : unassessed.slice(0, 2).map((d) => (
              <div key={d.domain} className="flex items-center" style={{ gap: 9, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <span className="mono" style={{ width: 26, height: 26, borderRadius: 7, background: C.scHigh, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: C.onVar, flex: "none" }}>{(d.name || d.domain).charAt(0).toUpperCase()}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", font: "500 12px Inter, sans-serif", color: C.on, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.name || d.domain}</span>
                  <span style={{ font: "500 10.5px Inter, sans-serif", color: d.methods?.sso ? C.secondary : d.methods?.password ? C.error : C.tertiary }}>{d.methods?.sso ? "✓ Corp SSO" : d.methods?.password ? "✕ Password" : "◐ Ungoverned"}</span>
                </span>
                <button onClick={() => onAssessDiscovered(d.domain)} disabled={busyDomain === d.domain} style={{ marginLeft: "auto", flex: "none", font: "500 11.5px Inter, sans-serif", color: C.primary, background: "transparent", border: 0, cursor: "pointer" }}>{busyDomain === d.domain ? "…" : "Assess →"}</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Coverage matrix + needs attention */}
      <div className="flex flex-wrap items-start" style={{ gap: 16 }}>
        <CoverageMatrix assessments={assessments} onOpen={onOpen} />
        <NeedsAttention kbPending={kbPending} kbStale={kbStale} discoveredUnassessed={unassessed.length} goKnowledge={goKnowledge} goDiscovered={goDiscovered} />
      </div>
    </div>
  );
}

function EmptyState({ onNew, onDemo }) {
  return (
    <div className="panel p-12 text-center">
      <div className="mx-auto grid place-items-center" style={{ width: 52, height: 52, borderRadius: 10, background: "rgba(173,198,255,0.08)" }}><Sparkles className="w-6 h-6 txt-primary" /></div>
      <div className="disp" style={{ fontSize: 18, fontWeight: 600, marginTop: 14, color: C.on }}>No assessments yet</div>
      <p className="txt-var mx-auto" style={{ fontSize: 13, marginTop: 6, maxWidth: 440, lineHeight: 1.6 }}>
        Name any SaaS tool — in the form, the sidebar terminal, or the search bar — and the agent researches its identity posture
        against the six IPSIE-aligned identity controls, cites its sources, and drafts a governance verdict.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2 mt-5">
        <button onClick={onNew} className="btn-primary" style={{ padding: "0.55rem 1rem", fontSize: 11 }}><Plus className="w-4 h-4" /> Run first assessment</button>
        {onDemo && <button onClick={onDemo} className="btn-ghost" style={{ padding: "0.55rem 1rem", fontSize: 11 }}><Sparkles className="w-4 h-4" /> Load sample data</button>}
      </div>
      {onDemo && <p className="txt-dim mx-auto" style={{ fontSize: 11, marginTop: 10 }}>No API key? Load sample data to explore the dashboard offline.</p>}
    </div>
  );
}

/* --------------------------- Catalog --------------------------- */

function Catalog({ assessments, onOpen, onNew, initialQuery, onDemo }) {
  const [q, setQ] = useState(initialQuery || "");
  const [sort, setSort] = useState("recent");
  useEffect(() => { if (initialQuery !== undefined) setQ(initialQuery); }, [initialQuery]);
  const rows = useMemo(() => {
    let r = assessments.filter((x) => `${x.app} ${x.vendor} ${x.category}`.toLowerCase().includes(q.toLowerCase()));
    if (sort === "recent") r = [...r].sort((a, b) => new Date(b.assessedAt) - new Date(a.assessedAt));
    if (sort === "score") r = [...r].sort((a, b) => b.score - a.score);
    if (sort === "risk") r = [...r].sort((a, b) => a.score - b.score);
    return r;
  }, [assessments, q, sort]);
  if (assessments.length === 0) return <EmptyState onNew={onNew} onDemo={onDemo} />;
  return (
    <div className="panel">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 border-b hair">
        <div className="relative flex-1">
          <Search className="w-4 h-4 txt-dim" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search apps, vendors, categories" className="inp" style={{ padding: "0.5rem 0.75rem 0.5rem 2.25rem" }} />
        </div>
        <div className="flex items-center gap-1.5">
          {[["recent", "Recent"], ["score", "Top score"], ["risk", "Riskiest"]].map(([k, l]) => (
            <button key={k} onClick={() => setSort(k)} className="caps" style={{ padding: "0.4rem 0.6rem", borderRadius: 4, cursor: "pointer", border: `1px solid ${sort === k ? C.primary : C.outlineVar}`, background: sort === k ? "rgba(173,198,255,0.08)" : "transparent", color: sort === k ? C.primary : C.onVar }}>{l}</button>
          ))}
        </div>
      </div>
      <div>{rows.map((a) => <div key={a.id} className="border-b" style={{ borderColor: "rgba(255,255,255,0.05)" }}><AssessmentRow a={a} onOpen={onOpen} /></div>)}</div>
      {rows.length === 0 && <div className="p-8 text-center txt-dim" style={{ fontSize: 13 }}>No matches for “{q}”. Use the terminal or New to assess it.</div>}
    </div>
  );
}

/* --------------------------- Assess form --------------------------- */

const EXAMPLES = ["Slack", "Salesforce", "Notion", "Zoom", "GitHub", "Snowflake", "Workday", "Figma"];
function Field({ label, required, children }) {
  return <label className="block"><span className="caps txt-var">{label}{required && <span className="txt-error"> *</span>}</span><div className="mt-1.5">{children}</div></label>;
}
function AssessForm({ onRun, busy, error, prefill }) {
  const [name, setName] = useState(prefill?.name || "");
  const [vendor, setVendor] = useState(prefill?.vendor || "");
  const [url, setUrl] = useState(prefill?.url || "");
  const [context, setContext] = useState(prefill?.context || "");
  const submit = () => { if (name.trim() && !busy) onRun({ name: name.trim(), vendor: vendor.trim(), url: url.trim(), context: context.trim() }); };
  return (
    <div className="max-w-2xl mx-auto panel p-6">
      <h2 className="disp" style={{ fontSize: 20, fontWeight: 600, color: C.on }}>Assess a SaaS tool</h2>
      <p className="txt-var" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.6 }}>The agent searches the live web — vendor docs, trust centers, and the OpenID Foundation — then scores the six IPSIE-aligned identity controls and drafts a governance verdict with citations.</p>
      <div className="mt-5 space-y-4">
        <Field label="Application name" required><input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="e.g. Notion" disabled={busy} className="inp" style={{ padding: "0.55rem 0.75rem" }} /></Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Vendor (optional)"><input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. Notion Labs" disabled={busy} className="inp" style={{ padding: "0.55rem 0.75rem" }} /></Field>
          <Field label="Official URL (optional)"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://notion.so" disabled={busy} className="inp" style={{ padding: "0.55rem 0.75rem" }} /></Field>
        </div>
        <Field label="Requesting context (optional)"><input value={context} onChange={(e) => setContext(e.target.value)} disabled={busy} placeholder="e.g. Marketing wants it for campaign docs; will hold customer PII" className="inp" style={{ padding: "0.55rem 0.75rem" }} /></Field>
        <div>
          <div className="caps txt-dim mb-2">Quick start</div>
          <div className="flex flex-wrap gap-1.5">{EXAMPLES.map((e) => <button key={e} onClick={() => setName(e)} disabled={busy} className="chip" style={{ cursor: "pointer", padding: "0.2rem 0.5rem", fontSize: 11 }}>{e}</button>)}</div>
        </div>
      </div>
      {error && <div className="mt-4 flex items-start gap-2 p-3" style={{ borderRadius: 6, background: "rgba(255,180,171,0.10)", border: `1px solid ${C.error}55`, color: C.error, fontSize: 13 }}><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span></div>}
      <button onClick={submit} disabled={!name.trim() || busy} className="btn-primary w-full mt-5" style={{ padding: "0.65rem", fontSize: 11 }}>{busy ? <><Loader2 className="w-4 h-4 spin" /> Researching live sources…</> : <><Sparkles className="w-4 h-4" /> Run assessment</>}</button>
      {busy && <p className="text-center txt-dim" style={{ fontSize: 11, marginTop: 8 }}>Searching the web and weighing evidence — this takes ~20–40 seconds.</p>}
    </div>
  );
}

/* --------------------------- Detail --------------------------- */

const VERDICT_OPTS = ["supported", "partial", "unsupported", "unknown"];

// Inline human verify/override for one control (writes to the knowledge base).
function ControlVerify({ a, controlKey, current, onVerify }) {
  const [v, setV] = useState(current || "supported");
  const [saving, setSaving] = useState(false);
  if (!onVerify) return null;
  const save = async () => {
    setSaving(true);
    await onVerify(a.kbKey || a.vendor || a.app, controlKey, v, a.vendor);
    setSaving(false);
  };
  return (
    <div className="flex items-center gap-1.5 mt-2.5">
      <span className="caps txt-dim" style={{ fontSize: 9 }}>Verify</span>
      <select value={v} onChange={(e) => setV(e.target.value)} className="inp" style={{ padding: "0.15rem 0.35rem", fontSize: 10, width: "auto" }}>
        {VERDICT_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <button onClick={save} disabled={saving} className="btn-ghost" style={{ padding: "0.2rem 0.5rem", fontSize: 10 }}>{saving ? "…" : "Save to KB"}</button>
    </div>
  );
}

// Radar affordances (color never stands alone): verdict-colored vertex dots and
// weight values in the axis labels.
function RadarDot({ cx, cy, payload }) {
  if (cx == null || cy == null) return null;
  return <circle cx={cx} cy={cy} r={3.5} fill={payload?.dotColor || C.primary} stroke={C.scLowest} strokeWidth={1} />;
}
function RadarTick({ x, y, textAnchor, payload, data }) {
  const d = data.find((r) => r.cap === payload.value);
  return (
    <text x={x} y={y} textAnchor={textAnchor} fill={C.dim} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, fontWeight: 700 }}>
      {payload.value} {d ? d.value : ""}
    </text>
  );
}

function Detail({ a, onBack, onReassess, onVerify }) {
  const radarData = CAPS.map((c) => {
    const v = verdictOf(a.capabilities?.[c.key]?.verdict);
    return { cap: c.short, value: v.weight, dotColor: v.dot };
  });
  const readiness = readinessOf(a.score); const band = scoreColor(a.score);
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 txt-var" style={{ background: "transparent", border: 0, cursor: "pointer", fontSize: 13 }}><ArrowLeft className="w-4 h-4" /> Command Center</button>
      <div className="glass p-6">
        <div className="flex flex-col md:flex-row md:items-center gap-6">
          <ScoreDial score={a.score} size={92} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="disp" style={{ fontSize: 22, fontWeight: 700, color: C.on }}>{a.app}</h1>
              {a.vendor && <span className="mono txt-dim" style={{ fontSize: 12 }}>{a.vendor}</span>}
              <span className="pill" style={{ background: `${readiness.color}21`, borderColor: `${readiness.color}4d`, color: readiness.color }}><span aria-hidden="true">{readiness.g}</span>{readiness.label}</span>
            </div>
            <p className="txt-var" style={{ fontSize: 14, marginTop: 8, lineHeight: 1.6 }}>{a.summary}</p>
            <div className="flex items-center gap-2 mono txt-dim" style={{ fontSize: 11, marginTop: 10 }}><span>{a.category}</span><span>·</span><Clock className="w-3 h-3" /><span>assessed {fmtDate(a.assessedAt)}</span></div>
          </div>
          <div className="md:w-44 shrink-0">
            <div className="panel p-3"><div className="caps">Verdict</div><div className="mt-1.5"><GovPill rec={a.recommendation} full /></div></div>
            <button onClick={onReassess} className="btn-ghost w-full mt-2 justify-center" style={{ padding: "0.4rem", fontSize: 11 }}><RefreshCw className="w-3 h-3" /> Re-assess</button>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="panel p-5">
          <h3 className="caps txt-var">Trust hexagon</h3>
          <div style={{ height: 220, marginTop: -4 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} outerRadius="72%">
                <PolarGrid stroke={C.outlineVar} />
                <PolarAngleAxis dataKey="cap" tick={<RadarTick data={radarData} />} />
                <Radar dataKey="value" stroke={band} fill={band} fillOpacity={0.18} strokeWidth={2} dot={<RadarDot />} isAnimationActive={false} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <p className="txt-dim" style={{ fontSize: 11.5, lineHeight: 1.6, marginTop: 4, fontFamily: "Inter, sans-serif" }}>Score = mean of six control weights (<span className="mono" style={{ fontSize: 10.5 }}>✓ 100 · ◐ 55 · ? 25 · ✕ 8</span>). Auditable, not a black box.</p>
        </div>
        <div className="panel p-5 lg:col-span-2">
          <h3 className="disp flex items-center gap-1.5" style={{ fontSize: 15, fontWeight: 600, color: C.on }}><ListChecks className="w-4 h-4 txt-primary" /> Governance decision packet</h3>
          <p className="txt-var" style={{ fontSize: 14, marginTop: 8, lineHeight: 1.6 }}>{a.recommendationRationale}</p>
          {a.conditions?.length > 0 && (
            <div className="mt-3"><div className="caps txt-dim mb-1.5">Conditions before approval</div>
              <ul className="space-y-1">{a.conditions.map((c, i) => <li key={i} className="flex items-start gap-2 txt-var" style={{ fontSize: 13.5 }}><Check className="w-3.5 h-3.5 txt-tertiary mt-0.5 shrink-0" />{c}</li>)}</ul></div>
          )}
          {a.risks?.length > 0 && (
            <div className="mt-3"><div className="caps txt-dim mb-1.5">Residual risks</div>
              <ul className="space-y-1">{a.risks.map((r, i) => <li key={i} className="flex items-start gap-2 txt-var" style={{ fontSize: 13.5 }}><AlertTriangle className="w-3.5 h-3.5 txt-error mt-0.5 shrink-0" />{r}</li>)}</ul></div>
          )}
        </div>
      </div>

      <div>
        <h3 className="caps txt-var mb-2.5">IPSIE-aligned identity controls</h3>
        <div className="grid md:grid-cols-2 gap-3">
          {CAPS.map((c) => {
            const cap = a.capabilities?.[c.key] || {}; const Icon = c.icon;
            return (
              <div key={c.key} className="panel p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="grid place-items-center" style={{ width: 32, height: 32, borderRadius: 6, background: C.scHigh }}><Icon className="w-4 h-4 txt-var" /></div>
                    <div><div className="disp" style={{ fontSize: 14, fontWeight: 600, color: C.on }}>{c.label}</div><div className="mono txt-dim" style={{ fontSize: 10.5 }}>{c.standard}</div></div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <VerdictPill verdict={cap.verdict} />
                    <div className="flex items-center gap-2">
                      {PROV[cap.source] && <span style={{ font: "500 11px Inter, sans-serif", color: PROV[cap.source].c }}><span aria-hidden="true">{PROV[cap.source].g}</span> {PROV[cap.source].label}</span>}
                      {typeof cap.confidence === "number" && <span style={{ font: "400 11px Inter, sans-serif", color: C.dim }}>{Math.round(cap.confidence * 100)}% conf</span>}
                    </div>
                  </div>
                </div>
                {cap.standards?.length > 0 && <div className="flex flex-wrap gap-1 mt-2.5">{cap.standards.map((s, i) => <span key={i} className="chip">{s}</span>)}</div>}
                <p className="txt-var" style={{ fontSize: 13.5, marginTop: 8, lineHeight: 1.6 }}>{cap.summary || "No evidence captured."}</p>
                <Citations items={cap.citations} />
                <ControlVerify a={a} controlKey={c.key} current={cap.verdict} onVerify={onVerify} />
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="caps txt-var mb-2.5">Operational due diligence</h3>
        <div className="panel">
          {EXTENDED.map((e) => {
            const Icon = e.icon;
            return (
              <div key={e.key} className="flex items-start gap-3 p-4 border-b" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                <div className="grid place-items-center shrink-0" style={{ width: 28, height: 28, borderRadius: 6, background: C.scHigh }}><Icon className="w-3.5 h-3.5 txt-var" /></div>
                <div className="min-w-0"><div className="disp" style={{ fontSize: 13.5, fontWeight: 600, color: C.on }}>{e.label}</div><p className="txt-var" style={{ fontSize: 13.5, marginTop: 2, lineHeight: 1.6 }}>{a.extended?.[e.key] || "—"}</p></div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="caps txt-var mb-2.5 flex items-center gap-2"><Users className="w-4 h-4 txt-primary" /> Stakeholder ownership <span className="mono txt-dim" style={{ fontSize: 10, textTransform: "none", letterSpacing: 0 }}>— who owns what, instead of a RAPID grid</span></h3>
        <div className="panel overflow-hidden">
          <table className="w-full" style={{ fontSize: 13.5 }}><tbody>
            {(a.ownerMap?.length ? a.ownerMap : FUNCTIONS.map((f) => ({ function: f, responsibility: "—" }))).map((row, i) => (
              <tr key={i} className="tbl-row border-b" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                <td className="py-2.5 px-4 mono align-top" style={{ width: 220, color: C.primary, fontSize: 12 }}>{row.function}</td>
                <td className="py-2.5 px-4 txt-var">{row.responsibility}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Integrations --------------------------- */

const MOCK_CATALOG = {
  ServiceNow: [
    { name: "Asana", vendor: "Asana Inc.", category: "Work management" },
    { name: "Lucidchart", vendor: "Lucid Software", category: "Diagramming" },
    { name: "Smartsheet", vendor: "Smartsheet Inc.", category: "Work management" },
  ],
  Okta: [
    { name: "Zoom", vendor: "Zoom Video", category: "Conferencing" },
    { name: "Atlassian", vendor: "Atlassian", category: "Dev / collaboration" },
    { name: "Snowflake", vendor: "Snowflake Inc.", category: "Data platform" },
  ],
  NetSuite: [
    { name: "DocuSign", vendor: "Docusign Inc.", category: "E-signature" },
    { name: "Coupa", vendor: "Coupa Software", category: "Procurement" },
  ],
};

const SNIPPETS = {
  inbound: `// Inbound catalog webhook — ServiceNow / Okta / NetSuite -> Snout
// Deploy as a serverless function or Express route. Verifies HMAC, normalizes
// app metadata, then queues an assessment.
${"imp" + "ort"} express from "${"expr" + "ess"}";
${"imp" + "ort"} crypto from "${"cry" + "pto"}";

const app = express();
app.use(express.json());

function verify(req, secret) {
  const sig = req.header("x-snout-signature") || "";
  const mac = crypto.createHmac("sha256", secret)
    .update(JSON.stringify(req.body)).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(mac));
}

// Normalize each source's catalog record into one shape
const normalize = {
  servicenow: (r) => ({ name: r.u_app_name, vendor: r.u_vendor, category: r.u_category, source: "ServiceNow", externalId: r.sys_id }),
  okta:       (r) => ({ name: r.label, vendor: r.vendor || "", category: r.signOnMode, source: "Okta", externalId: r.id }),
  netsuite:   (r) => ({ name: r.itemid, vendor: r.vendorname, category: r.class, source: "NetSuite", externalId: r.internalid }),
};

app.post("/webhooks/catalog/:source", (req, res) => {
  if (!verify(req, process.env.SNOUT_WEBHOOK_SECRET)) return res.status(401).end();
  const items = [].concat(req.body.records || req.body);
  const apps = items.map(normalize[req.params.source]);
  apps.forEach((a) => queueAssessment(a)); // -> calls runAgent(), persists result
  res.json({ accepted: apps.length });
});

app.listen(8787);`,

  servicenow: `# ServiceNow — push CMDB SaaS records to Snout
# Flow Designer > Action: REST step (run on insert/update of cmdb_ci_service_discovered)
POST https://snout.yourco.com/webhooks/catalog/servicenow
Headers:
  Content-Type: application/json
  x-snout-signature: \${hmac_sha256(payload, SNOUT_WEBHOOK_SECRET)}
Body:
  { "records": [ { "sys_id": "...", "u_app_name": "Asana",
                   "u_vendor": "Asana Inc.", "u_category": "Work management" } ] }`,

  okta: `// Okta — pull the app catalog on a schedule, forward to Snout
// Run in Okta Workflows (HTTP card) or a cron job using the Apps API.
const r = await fetch("https://yourco.okta.com/api/v1/apps?limit=200", {
  headers: { Authorization: "SSWS " + process.env.OKTA_API_TOKEN },
});
const apps = await r.json();
await fetch("https://snout.yourco.com/webhooks/catalog/okta", {
  method: "POST",
  headers: { "Content-Type": "application/json",
             "x-snout-signature": sign(apps) },
  body: JSON.stringify({ records: apps }),
});`,

  slack: `// Slack slash command: /snout <app name>
// Set the command's Request URL to this endpoint. Responds in-channel,
// no login to the webapp required.
${"imp" + "ort"} express from "${"expr" + "ess"}";
const app = express();
app.use(express.urlencoded({ extended: true }));

app.post("/slack/snout", async (req, res) => {
  const appName = (req.body.text || "").trim();
  res.json({ response_type: "ephemeral", text: \`Assessing *\${appName}*… one moment.\` });

  const result = await runAgent({ name: appName });        // your agent call
  const a = persist(result);                                // save to dashboard
  await fetch(req.body.response_url, {                      // delayed response
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      response_type: "in_channel",
      blocks: [
        { type: "header", text: { type: "plain_text", text: \`\${a.app} — Trust \${a.score}/100\` } },
        { type: "section", text: { type: "mrkdwn",
          text: \`*Verdict:* \${a.recommendation}\\n\${a.summary}\` } },
        { type: "actions", elements: [
          { type: "button", text: { type: "plain_text", text: "Open full report" },
            url: \`https://snout.yourco.com/a/\${a.id}\` } ] },
      ],
    }),
  });
});
app.listen(8788);`,

  teams: `// Microsoft Teams — outgoing webhook / bot
// @Snout assess Notion   ->   POST to this endpoint (HMAC in Authorization)
app.post("/teams/snout", async (req, res) => {
  const text = (req.body.text || "").replace(/<at>.*<\\/at>/, "").trim();
  const appName = text.replace(/^assess\\s+/i, "");
  const a = persist(await runAgent({ name: appName }));
  res.json({
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      content: {
        type: "AdaptiveCard", version: "1.4",
        body: [
          { type: "TextBlock", size: "Large", weight: "Bolder",
            text: \`\${a.app} — Trust \${a.score}/100\` },
          { type: "TextBlock", wrap: true, text: \`Verdict: \${a.recommendation}\` },
          { type: "TextBlock", wrap: true, isSubtle: true, text: a.summary },
        ],
        actions: [{ type: "Action.OpenUrl", title: "Open full report",
          url: \`https://snout.yourco.com/a/\${a.id}\` }],
      },
    }],
  });
});`,
};

function Integrations({ onAssessCatalog }) {
  const [imported, setImported] = useState({});
  const [tab, setTab] = useState("inbound");
  const doImport = (src) => setImported((p) => ({ ...p, [src]: MOCK_CATALOG[src] }));
  return (
    <div className="space-y-4">
      <div className="panel p-5 flex items-start gap-3">
        <div className="grid place-items-center shrink-0" style={{ width: 36, height: 36, borderRadius: 8, background: "rgba(173,198,255,0.08)" }}><Webhook className="w-5 h-5 txt-primary" /></div>
        <div>
          <h2 className="disp" style={{ fontSize: 16, fontWeight: 600, color: C.on }}>Integration architecture</h2>
          <p className="txt-var" style={{ fontSize: 13, marginTop: 4, maxWidth: 640, lineHeight: 1.6 }}>Inbound webhooks pull your app catalog from systems of record so the agent assesses what you actually run. Outbound webhooks let anyone trigger an assessment from chat. The catalog import below is a working simulation — the production handlers are real, deployable code in the tabs underneath.</p>
        </div>
      </div>
      <div className="panel p-5">
        <div className="flex items-center justify-between"><h3 className="caps txt-var flex items-center gap-1.5"><Database className="w-4 h-4 txt-dim" /> Catalog sources</h3><span className="mono txt-dim" style={{ fontSize: 10 }}>simulated import</span></div>
        <div className="grid sm:grid-cols-3 gap-3 mt-4">
          {Object.keys(MOCK_CATALOG).map((src) => (
            <div key={src} className="panel-i p-3">
              <div className="flex items-center justify-between"><span className="disp" style={{ fontSize: 14, fontWeight: 600, color: C.on }}>{src}</span><Building2 className="w-4 h-4 txt-dim" /></div>
              {imported[src] ? (
                <div className="mt-2 space-y-1">{imported[src].map((app) => (
                  <button key={app.name} onClick={() => onAssessCatalog(app)} className="rowlink px-2 py-1.5" style={{ borderRadius: 4, fontSize: 12 }}><span className="truncate txt-var flex-1">{app.name}</span><span className="mono txt-primary" style={{ fontSize: 10 }}>assess</span></button>
                ))}</div>
              ) : <button onClick={() => doImport(src)} className="btn-ghost w-full justify-center mt-3" style={{ padding: "0.4rem", fontSize: 11 }}>Import catalog</button>}
            </div>
          ))}
        </div>
        <p className="mono txt-dim" style={{ fontSize: 10.5, marginTop: 12 }}>After import, click any app to send it straight into the agent. In production this is automatic on every catalog change.</p>
      </div>
      <div className="panel p-5">
        <h3 className="caps txt-var flex items-center gap-1.5"><FileText className="w-4 h-4 txt-dim" /> Deployable handlers</h3>
        <div className="flex flex-wrap gap-1.5 mt-3 mb-4">
          {[["inbound", "Inbound webhook"], ["servicenow", "ServiceNow"], ["okta", "Okta"], ["slack", "Slack /snout"], ["teams", "Teams bot"]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className="caps" style={{ padding: "0.4rem 0.6rem", borderRadius: 4, cursor: "pointer", border: `1px solid ${tab === k ? C.primary : C.outlineVar}`, background: tab === k ? "rgba(173,198,255,0.08)" : "transparent", color: tab === k ? C.primary : C.onVar }}>{l}</button>
          ))}
        </div>
        <CodeBlock label={`${tab}.${tab === "servicenow" ? "txt" : "js"}`} code={SNIPPETS[tab]} />
        <p className="mono txt-dim" style={{ fontSize: 10.5, marginTop: 12, lineHeight: 1.7 }}>These call the same runAgent() the dashboard uses and write to the same store, so /snout Notion in Slack and a click here produce one identical record. Sign every webhook with an HMAC shared secret; scope catalog API tokens to read-only.</p>
      </div>
    </div>
  );
}

/* --------------------------- Discovered apps --------------------------- */

const METHOD_BADGES = [
  { key: "sso",        label: "Corp SSO",       cls: "pill-green" },
  { key: "social",     label: "Social IdP",     cls: "pill-amber" },
  { key: "federated",  label: "Federated",      cls: "pill-amber" },
  { key: "password",   label: "Local password", cls: "pill-red" },
  { key: "oauthGrant", label: "OAuth grant",    cls: "pill-blue" },
];
function discoveredPosture(app) {
  if (app.methods?.sso) return { label: "Sanctioned SSO", color: C.secondary };
  if (app.methods?.password) return { label: "Shadow · password", color: C.error };
  return { label: "Shadow", color: C.tertiary };
}

function Discovered({ apps, busyDomain, onAssess, onOpen, onDelete }) {
  const shadow = apps.filter((a) => !a.methods?.sso);
  const unassessed = apps.filter((a) => !a.assessment);

  if (apps.length === 0) {
    return (
      <div className="panel p-12 text-center">
        <div className="mx-auto grid place-items-center" style={{ width: 52, height: 52, borderRadius: 10, background: "rgba(173,198,255,0.08)" }}><RadarIcon className="w-6 h-6 txt-primary" /></div>
        <div className="disp" style={{ fontSize: 18, fontWeight: 600, marginTop: 14, color: C.on }}>No discovered apps yet</div>
        <p className="txt-var mx-auto" style={{ fontSize: 13, marginTop: 6, maxWidth: 480, lineHeight: 1.6 }}>
          Feed any sensor — the Snout browser extension (<b>Sync</b>), your IdP sign-in logs
          (Okta / Entra / Google → <span className="mono">/webhooks/idp/:source</span>), or forwarded
          signup emails (<span className="mono">/webhooks/email</span>). Apps, how you authenticate
          (SSO, social, local password, OAuth grants), and when they were seen show up here for triage
          and one-click assessment.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <KpiTile label="Discovered" value={apps.length} sub="from the field" Icon={RadarIcon} />
        <KpiTile label="Shadow auth" value={shadow.length} sub="no corporate SSO" subColor={C.error} Icon={ShieldAlert} />
        <KpiTile label="Unassessed" value={unassessed.length} sub="awaiting review" subColor={C.tertiary} Icon={AlertTriangle} />
      </div>
      <div className="panel">
        <div className="px-4 py-3 border-b hair"><h3 className="caps txt-var">Discovered apps</h3></div>
        <div>
          {apps.map((a) => {
            const p = discoveredPosture(a);
            const grant = a.oauth?.[0];
            const busy = busyDomain === a.domain;
            return (
              <div key={a.domain} className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                {a.assessment
                  ? <button onClick={() => onOpen(a.assessment.id)} style={{ background: "transparent", border: 0, cursor: "pointer" }}><ScoreDial score={a.assessment.score} size={44} /></button>
                  : <div className="grid place-items-center shrink-0" style={{ width: 44, height: 44, borderRadius: 99, border: `1px dashed ${C.outlineVar}`, color: C.outline }}><RadarIcon className="w-4 h-4" /></div>}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="disp truncate" style={{ fontWeight: 600, fontSize: 15, color: C.on }}>{a.name}</span>
                    <span className="mono txt-dim truncate" style={{ fontSize: 11 }}>{a.domain}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    <span className="pill" style={{ background: "transparent", color: p.color, border: `1px solid ${p.color}66` }}>{p.label}</span>
                    {a.posture?.findings?.length > 0 && (() => {
                      const rs = a.posture.riskScore || 0;
                      const col = rs >= 40 ? C.error : rs >= 20 ? C.tertiary : C.secondary;
                      return <span className="pill" title={a.posture.findings.map((x) => x.title).join(" · ")} style={{ background: `${col}1a`, color: col, border: `1px solid ${col}55` }}>⚠ risk {rs} · {a.posture.findings.length}</span>;
                    })()}
                    {METHOD_BADGES.filter((m) => a.methods?.[m.key]).map((m) => <span key={m.key} className={`pill ${m.cls}`}>{m.label}</span>)}
                  </div>
                  {grant?.scopes?.length > 0 && (
                    <div className="mono txt-dim" style={{ fontSize: 10.5, marginTop: 5, lineHeight: 1.5, wordBreak: "break-word" }}>↳ {grant.idp} · scopes: {grant.scopes.join(" ")}</div>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 mono txt-dim" style={{ fontSize: 10, marginTop: 5 }}>
                    {(a.sources || []).map((s) => <span key={s} className="chip" style={{ padding: "0.05rem 0.4rem", fontSize: 9.5 }}>{s}</span>)}
                    {a.events?.length > 0 && (() => {
                      const last = [...a.events].sort((x, y) => y.ts - x.ts)[0];
                      return <span title={`${a.events.length} event(s)`}>· last: {last.source} {last.kind} · {new Date(last.ts || a.lastSeen).toLocaleDateString()}</span>;
                    })()}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {a.assessment
                    ? <button onClick={() => onOpen(a.assessment.id)} className="btn-ghost" style={{ padding: "0.4rem 0.7rem", fontSize: 11 }}>View report</button>
                    : <button onClick={() => onAssess(a.domain)} disabled={busy} className="btn-primary" style={{ padding: "0.45rem 0.7rem", fontSize: 10 }}>{busy ? <><Loader2 className="w-3.5 h-3.5 spin" /> Assessing…</> : <><Sparkles className="w-3.5 h-3.5" /> Assess</>}</button>}
                  <button onClick={() => onDelete(a.domain)} title="Remove" className="btn-ghost" style={{ padding: "0.4rem", fontSize: 11 }}><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Knowledge base (verification queue) --------------------------- */

const STALE_MS = 180 * 864e5;

function KbRow({ v, c, saving, onVerify }) {
  const f = v.controls?.[c.key];
  const [verdict, setVerdict] = useState(f?.verdict || "supported");
  const stale = f?.source === "human" && f?.verifiedAt && Date.now() - new Date(f.verifiedAt).getTime() > STALE_MS;
  const busy = saving === v.domain + c.key;
  const prov = !f ? null
    : f.source === "human" ? { g: "◆", t: "kb-verified", c: "#adc6ff" }
    : f.source === "agent" ? { g: "◇", t: "proposed", c: "#ffb95f" }
    : { g: "◇", t: "seed", c: "#8fb5ff" };
  const staleDays = stale ? Math.round((Date.now() - new Date(f.verifiedAt).getTime()) / 864e5) : 0;
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
      <div className="shrink-0" style={{ width: 150 }}>
        <div className="disp" style={{ fontSize: 13, fontWeight: 600, color: C.on }}>{c.label}</div>
        <div className="mono txt-dim" style={{ fontSize: 10 }}>{c.standard}</div>
      </div>
      <div className="flex-1 flex items-center gap-2 flex-wrap">
        <VerdictPill verdict={f?.verdict} />
        {prov && <span style={{ font: "500 11px Inter, sans-serif", color: prov.c }}><span aria-hidden="true">{prov.g}</span> {prov.t}</span>}
        {typeof f?.confidence === "number" && <span style={{ font: "400 11px Inter, sans-serif", color: C.dim }}>{Math.round(f.confidence * 100)}%</span>}
        {stale && <span style={{ font: "500 11px Inter, sans-serif", color: C.tertiary }}>◷ stale {staleDays}d</span>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <select value={verdict} onChange={(e) => setVerdict(e.target.value)} className="inp" style={{ padding: "0.15rem 0.35rem", fontSize: 10, width: "auto" }}>
          {VERDICT_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <button onClick={() => onVerify(v.domain, v.vendor, c.key, verdict)} disabled={busy} className="btn-ghost" style={{ padding: "0.2rem 0.5rem", fontSize: 10 }}>{busy ? "…" : "Verify"}</button>
      </div>
    </div>
  );
}

function KnowledgeView({ onKbChange }) {
  const [vendors, setVendors] = useState(null);
  const [saving, setSaving] = useState(null);
  const toast = useToast();
  const load = useCallback(async () => { try { setVendors(await listKb()); } catch { setVendors([]); } }, []);
  useEffect(() => { load(); }, [load]);

  if (vendors === null) return <div className="py-24 grid place-items-center txt-dim"><Loader2 className="w-6 h-6 spin" /></div>;

  const verify = async (domain, vendor, control, verdict) => {
    setSaving(domain + control);
    try {
      await verifyControl(domain, control, { verdict, vendor, verifiedBy: "dashboard" });
      await load();
      toast("success", "Published to the knowledge base", `${vendor} · ${control} verified as ${verdict}. It's now a trusted prior for future assessments.`);
      if (onKbChange) onKbChange();
    }
    catch (e) { toast("error", "Verify failed", e.message || "The knowledge-base write did not go through."); }
    finally { setSaving(null); }
  };

  // Bulk verify: accept every not-yet-human fact for a vendor at its current verdict.
  const verifyAll = async (v) => {
    setSaving(v.domain + "*");
    try {
      let n = 0;
      for (const c of CAPS) {
        const f = v.controls?.[c.key];
        if (f && f.source !== "human") { await verifyControl(v.domain, c.key, { verdict: f.verdict, vendor: v.vendor, verifiedBy: "dashboard" }); n++; }
      }
      await load();
      toast("success", "Bulk verify complete", `${n} fact${n === 1 ? "" : "s"} for ${v.vendor} promoted to human-verified.`);
      if (onKbChange) onKbChange();
    } catch (e) { toast("error", "Bulk verify failed", e.message || "Some facts may not have been saved — the queue reflects what went through."); }
    finally { setSaving(null); }
  };

  const unverifiedOf = (v) => CAPS.filter((c) => { const f = v.controls?.[c.key]; return f && f.source !== "human"; }).length;

  let facts = 0, human = 0, pending = 0, stale = 0;
  vendors.forEach((v) => CAPS.forEach((c) => {
    const f = v.controls?.[c.key]; if (!f) return;
    facts++;
    if (f.source !== "human") pending++;
    else { human++; if (f.verifiedAt && Date.now() - new Date(f.verifiedAt).getTime() > STALE_MS) stale++; }
  }));
  const verifiedPct = facts ? Math.round((human / facts) * 100) : 0;
  // Prioritize the queue: most-unverified vendors first, then by name.
  const ordered = [...vendors].sort((a, b) => unverifiedOf(b) - unverifiedOf(a) || a.vendor.localeCompare(b.vendor));

  if (!vendors.length) return (
    <div className="panel p-12 text-center">
      <div className="mx-auto grid place-items-center" style={{ width: 52, height: 52, borderRadius: 10, background: "rgba(173,198,255,0.08)" }}><ListChecks className="w-6 h-6 txt-primary" /></div>
      <div className="disp" style={{ fontSize: 18, fontWeight: 600, marginTop: 14, color: C.on }}>Knowledge base is empty</div>
      <p className="txt-var mx-auto" style={{ fontSize: 13, marginTop: 6, maxWidth: 460, lineHeight: 1.6 }}>
        Assess apps, or run <span className="mono">npm run seed:kb</span> to batch-generate proposals. Verified facts here are reused as trusted priors in future assessments.
      </p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <KpiTile label="KB vendors" value={vendors.length} sub="in the knowledge base" Icon={ListChecks} />
        <KpiTile label="Awaiting verification" value={pending} sub="agent / seed facts" subColor={C.tertiary} Icon={AlertTriangle} />
        <KpiTile label="Stale verified" value={stale} sub="older than 180 days" subColor={C.error} Icon={Clock} />
      </div>
      <div className="panel p-4">
        <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
          <span className="caps txt-var" style={{ fontSize: 10 }}>Human-verified coverage</span>
          <span className="mono" style={{ fontSize: 12, color: C.on }}>{human}/{facts} facts · {verifiedPct}%</span>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
          <div style={{ width: `${verifiedPct}%`, height: "100%", background: C.secondary, transition: "width .3s" }} />
        </div>
      </div>
      {ordered.map((v) => {
        const nUnv = unverifiedOf(v);
        return (
          <div key={v.domain} className="panel">
            <div className="px-4 py-3 border-b hair flex items-center gap-2">
              <span className="disp" style={{ fontWeight: 600, fontSize: 15, color: C.on }}>{v.vendor}</span>
              <span className="mono txt-dim" style={{ fontSize: 11 }}>{v.domain}</span>
              <span className="flex-1" />
              {nUnv > 0 && (
                <button onClick={() => verifyAll(v)} disabled={saving === v.domain + "*"} className="btn-ghost" style={{ padding: "0.2rem 0.6rem", fontSize: 10 }}>
                  {saving === v.domain + "*" ? "Verifying…" : `Verify all (${nUnv})`}
                </button>
              )}
            </div>
            {CAPS.map((c) => <KbRow key={c.key} v={v} c={c} saving={saving} onVerify={verify} />)}
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------- Sidebar nav --------------------------- */

function NavItem({ icon: Icon, label, active, onClick, indicator }) {
  return (
    <button onClick={onClick} className={`navitem ${active ? "active" : ""}`}>
      {active && <div className="accentbar" />}
      <span className="navlabel"><Icon className="w-4 h-4" /> {label}</span>
      <span style={{ position: "relative", zIndex: 2 }}>{indicator}</span>
    </button>
  );
}

function Terminal({ busy, onRun }) {
  const [val, setVal] = useState("");
  const go = () => { const t = val.trim(); if (t && !busy) { onRun(t); setVal(""); } };
  return (
    <div className="terminal p-3">
      <div className="flex justify-between items-center" style={{ marginBottom: 6 }}><span style={{ font: "500 11px Inter, sans-serif", color: C.dim }}>Quick command</span><span className="mono" style={{ fontSize: 9.5, color: C.dim }}>v1.0</span></div>
      <div className="flex items-center gap-2">
        <span className="mono txt-secondary" style={{ animation: "pg 2s infinite", fontSize: 12 }}>{busy ? "…" : ">"}</span>
        <input className="term-input" value={val} disabled={busy} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} placeholder={busy ? "Assessing…" : "Assess an app…"} />
      </div>
    </div>
  );
}

/* --------------------------- App shell --------------------------- */

const NAV = [
  { key: "command", label: "Command Center", icon: LayoutDashboard },
  { key: "catalog", label: "Assessments", icon: Boxes },
  { key: "discovered", label: "Discovered", icon: RadarIcon },
  { key: "knowledge", label: "Knowledge", icon: ListChecks },
  { key: "integrations", label: "Integrations", icon: Network },
];
const TITLES = { command: "Command Center", catalog: "Assessments", discovered: "Discovered", knowledge: "Knowledge", assess: "New assessment", integrations: "Integrations" };

export default function App() {
  const [view, setView] = useState("command");
  const [assessments, setAssessments] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [prefill, setPrefill] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [topSearch, setTopSearch] = useState("");
  const [discovered, setDiscovered] = useState([]);
  const [busyDomain, setBusyDomain] = useState(null);
  const [features, setFeatures] = useState({ catalog: true });
  const [alerts, setAlerts] = useState([]);
  const [auth, setAuth] = useState({ oidcEnabled: false, authenticated: true });
  const [readiness, setReadiness] = useState(null); // null until loaded / when backend unreachable
  const [demoMode, setDemoMode] = useState(false);  // runtime sample-data mode (no key/server needed)
  const [kb, setKb] = useState(null);               // KB vendor list (for coverage + attention queues)
  const [events, setEvents] = useState([]);         // engine feed — REAL events only, newest first
  const toast = useToast();

  // Engine feed logger. kinds: ok ✓ · info ▸ · warn ◐ · err ✕ · disc ● · kb ◆
  const logEvent = useCallback((kind, text) => {
    const t = new Date().toLocaleTimeString("en-GB", { hour12: false });
    setEvents((ev) => [{ t, kind, text }, ...ev].slice(0, 40));
  }, []);

  const refreshDiscovered = useCallback(async () => {
    try { setDiscovered(await listDiscovered()); } catch { /* offline */ }
    try { setAlerts(await listAlerts()); } catch { /* offline */ }
  }, []);
  const refreshKb = useCallback(async () => {
    try { setKb(await listKb()); } catch { /* offline */ }
  }, []);

  // Load demo sample data into state (runtime, no server). Persisted so it survives reload.
  const enterDemo = useCallback(async () => {
    const m = await import("./demo.js");
    setAssessments([...m.DEMO_ASSESSMENTS]);
    setDiscovered([...m.DEMO_DISCOVERED]);
    setAlerts([]); setFeatures({ catalog: true });
    setReadiness({ assessReady: true, provider: "demo", model: "sample data", webSearch: true, store: "demo", catalog: true, webhooks: false, oidc: false });
    setKb([]);
    setDemoMode(true); setCurrentId(null); setView("command"); setLoaded(true);
    try { localStorage.setItem("snout_demo", "1"); } catch { /* ignore */ }
    logEvent("info", "Sample data loaded — nothing here is real");
  }, [logEvent]);
  const exitDemo = useCallback(() => {
    try { localStorage.removeItem("snout_demo"); } catch { /* ignore */ }
    window.location.reload(); // cleanly reset to live state
  }, []);

  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return; // StrictMode double-invokes effects in dev
    bootedRef.current = true;
    (async () => {
      // Sample-data mode short-circuits the live API entirely. Triggerable via a
      // persisted flag or a shareable ?demo=1 link (handy for UAT walkthroughs).
      let wantDemo = false;
      try { wantDemo = localStorage.getItem("snout_demo") === "1" || new URLSearchParams(window.location.search).get("demo") === "1"; } catch { /* ignore */ }
      if (wantDemo) { await enterDemo(); return; }

      const a = await getAuth();
      setAuth(a);
      // When OIDC is enabled but no valid session exists, stop here and show the
      // sign-in gate rather than firing API calls that would 401.
      if (a.oidcEnabled && !a.authenticated) { setLoaded(true); return; }
      const f = await getFeatures();
      setFeatures(f);
      const r = await getReadiness();
      setReadiness(r);
      if (r === null) logEvent("err", "Backend unreachable — reads unavailable");
      else if (!r.assessReady) logEvent("info", "Setup needed — provider key missing");
      else logEvent("ok", `Engine online — ${r.provider} · ${r.webSearch ? "full grounding" : "reduced grounding"}`);
      try {
        const list = await listAssessments();
        setAssessments(list);
        const id = new URLSearchParams(window.location.search).get("a");
        if (id && list.some((x) => x.id === id)) { setCurrentId(id); setView("detail"); }
      } catch { /* offline / empty */ }
      if (f.catalog) refreshDiscovered();
      refreshKb();
      setLoaded(true);
    })();
  }, [refreshDiscovered, refreshKb, enterDemo, logEvent]);

  // Honest heartbeat: a real /api/config round-trip once a minute (skipped in demo
  // mode and while the tab is hidden). Logs the measured latency — never invented.
  useEffect(() => {
    if (demoMode || !loaded) return undefined;
    const tick = async () => {
      if (document.hidden) return;
      const t0 = performance.now();
      const r = await getReadiness();
      const ms = Math.round(performance.now() - t0);
      if (r === null) { logEvent("err", "Heartbeat failed — API unreachable"); setReadiness(null); }
      else { logEvent("info", `Heartbeat OK — engine ${ms}ms`); setReadiness(r); }
    };
    const iv = setInterval(tick, 60000);
    return () => clearInterval(iv);
  }, [demoMode, loaded, logEvent]);

  const handleRun = useCallback(async (input) => {
    setBusy(true); setError(""); setView("assess");
    logEvent("info", `Assessment started: ${input.name}`);
    try {
      let record;
      if (demoMode) { const m = await import("./demo.js"); await new Promise((r) => setTimeout(r, 900)); record = m.demoSynthesize(input); }
      else record = await apiAssess(input);
      setAssessments((prev) => [record, ...prev.filter((x) => x.app.toLowerCase() !== record.app.toLowerCase())]);
      setCurrentId(record.id); setView("detail"); setPrefill(null);
      logEvent("ok", `${record.app} scored ${record.score} — packet drafted`);
      if (!demoMode) refreshKb(); // agent runs write KB proposals
    } catch (e) {
      setError(e.message || "Something went wrong while assessing this app.");
      logEvent("err", `Assessment failed: ${input.name}`);
    }
    finally { setBusy(false); }
  }, [demoMode, logEvent, refreshKb]);

  const handleAssessDiscovered = useCallback(async (domain) => {
    setBusyDomain(domain);
    try {
      if (demoMode) {
        const m = await import("./demo.js"); await new Promise((r) => setTimeout(r, 900));
        const app = discovered.find((d) => d.domain === domain);
        const record = m.demoSynthesize({ name: app?.name || domain, vendor: app?.name });
        setAssessments((prev) => [record, ...prev.filter((x) => x.app.toLowerCase() !== record.app.toLowerCase())]);
        setDiscovered((prev) => prev.map((d) => d.domain === domain ? { ...d, assessmentId: record.id, assessment: { id: record.id, score: record.score, recommendation: record.recommendation } } : d));
        setCurrentId(record.id); setView("detail"); return;
      }
      logEvent("info", `Assessment started: ${domain}`);
      const record = await assessDiscovered(domain);
      setAssessments((prev) => [record, ...prev.filter((x) => x.app.toLowerCase() !== record.app.toLowerCase())]);
      await refreshDiscovered();
      setCurrentId(record.id); setView("detail");
      logEvent("ok", `${record.app} scored ${record.score} — packet drafted`);
    } catch (e) {
      logEvent("err", `Assessment failed: ${domain}`);
      toast("error", "Assessment failed", e.message || "The assessment could not be completed. Check the engine status and try again.");
    }
    finally { setBusyDomain(null); }
  }, [refreshDiscovered, demoMode, discovered, toast, logEvent]);

  const handleDeleteDiscovered = useCallback(async (domain) => {
    try { await deleteDiscovered(domain); await refreshDiscovered(); } catch { /* ignore */ }
  }, [refreshDiscovered]);

  const handleVerify = useCallback(async (key, control, verdict, vendor) => {
    try {
      if (!demoMode) await verifyControl(key, control, { verdict, vendor });
      logEvent("kb", `KB verify: ${key} · ${control} → ${verdict}`);
      toast("success", "Saved to knowledge base", `${key} · ${control} is now human-verified as ${verdict}. Future assessments reuse it as a trusted prior.`);
      if (!demoMode) refreshKb();
      setAssessments((prev) => prev.map((a) => {
        if (a.id !== currentId) return a;
        const capabilities = { ...a.capabilities, [control]: { ...(a.capabilities?.[control] || {}), verdict, source: "kb-verified", confidence: 1 } };
        return { ...a, capabilities, score: computeScore(capabilities) };
      }));
    } catch (e) { toast("error", "Verify failed", e.message || "The knowledge-base write did not go through. Check your permissions and try again."); }
  }, [currentId, demoMode, toast, logEvent, refreshKb]);

  const current = assessments.find((a) => a.id === currentId);
  const goNew = (pf = null) => { setPrefill(pf); setError(""); setView("assess"); };
  const open = (id) => { setCurrentId(id); setView("detail"); };
  const quickRun = (name) => handleRun({ name });

  const submitTopSearch = () => {
    const v = topSearch.trim(); if (!v) return;
    const match = assessments.find((a) => a.app.toLowerCase() === v.toLowerCase());
    if (match) { open(match.id); } else { setCatalogQuery(v); setView("catalog"); }
  };

  const title = view === "detail" && current ? current.app : (TITLES[view] || "Snout");
  const navActive = (key) => view === key || ((view === "detail" || view === "assess") && key === "command");

  // Honest system status (EPIC-ACTIVATION): reflect real readiness, not a static badge.
  const ready = readiness;
  const sysStatus = demoMode
    ? { label: "Demo data", foot: "Demo data", color: C.primary, pulse: true }
    : !loaded
    ? { label: "Connecting…", foot: "Connecting…", color: C.onVar, pulse: false }
    : ready === null
    ? { label: "Backend offline", foot: "Engine offline", color: C.error, pulse: false }
    : !ready.assessReady
    ? { label: "Setup needed", foot: "Setup needed", color: C.tertiary, pulse: false }
    : !ready.webSearch
    ? { label: "Reduced grounding", foot: "Engine degraded", color: C.tertiary, pulse: true }
    : { label: "System healthy", foot: "Engine online", color: C.secondary, pulse: true };

  // Portfolio pulse — score-band distribution across assessed vendors.
  const pulse = useMemo(() => {
    const n = assessments.length;
    const bands = { ready: 0, partial: 0, notready: 0 };
    let sum = 0;
    for (const a of assessments) {
      sum += a.score;
      if (a.score >= 80) bands.ready++; else if (a.score >= 50) bands.partial++; else bands.notready++;
    }
    const pct = (x) => (n ? `${Math.round((x / n) * 100)}%` : "0%");
    return { n, avg: n ? Math.round(sum / n) : 0, wReady: pct(bands.ready), wPart: pct(bands.partial), wNot: pct(bands.notready), legend: `${bands.ready} ready · ${bands.partial} partial · ${bands.notready} not ready` };
  }, [assessments]);

  // KB-derived queues (real state, not simulated): pending proposals = facts not
  // yet human-verified; stale = human facts whose evidence is older than 180d.
  const kbStats = useMemo(() => {
    if (!kb) return { pending: 0, stale: 0, count: null };
    let pending = 0, stale = 0;
    for (const v of kb) for (const c of CAPS) {
      const f = v.controls?.[c.key];
      if (!f) continue;
      if (f.source !== "human") pending++;
      else if (f.verifiedAt && Date.now() - new Date(f.verifiedAt).getTime() > STALE_MS) stale++;
    }
    return { pending, stale, count: kb.length };
  }, [kb]);

  // OIDC sign-in gate: when login is enabled and there's no valid session, show a
  // sign-in screen instead of the app (which would only 401).
  if (auth.oidcEnabled && !auth.authenticated) {
    const failed = new URLSearchParams(window.location.search).get("login") === "failed";
    return (
      <div className="ob">
        <Style />
      <BrandDefs />
        <div className="ob-bg" aria-hidden="true" />
        <ShaderBG />
        <div className="min-h-screen grid place-items-center p-6">
          <div className="panel p-8 text-center" style={{ maxWidth: 380 }}>
            <div className="mb-5 flex justify-center"><Logo /></div>
            <h2 className="disp mb-2" style={{ fontSize: 18, fontWeight: 600, color: C.on }}>Sign in to Snout</h2>
            <p className="txt-var mb-6" style={{ fontSize: 13 }}>Authenticate with your identity provider to continue.</p>
            {failed && <p className="mb-4" style={{ fontSize: 12.5, color: C.error }}>Sign-in failed or was cancelled. Please try again.</p>}
            <a href={loginUrl()} className="btn-primary w-full" style={{ justifyContent: "center", padding: "0.6rem" }}>Sign in with SSO</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ob">
      <Style />
      <BrandDefs />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;700&display=swap" />
      <div className="ob-bg" aria-hidden="true" />
      <ShaderBG />

      {/* Mobile bar */}
      <div className="flex md:hidden items-center justify-between px-4 h-14 border-b hair" style={{ position: "sticky", top: 0, zIndex: 40, background: "rgba(6,14,32,0.85)", backdropFilter: "blur(12px)" }}>
        <Logo compact />
        <button onClick={() => goNew()} className="btn-primary" style={{ padding: "0.4rem 0.7rem", fontSize: 10 }}><Plus className="w-3.5 h-3.5" /> New</button>
      </div>
      <div className="flex md:hidden gap-1.5 px-4 py-2 overflow-x-auto border-b hair" style={{ background: "rgba(6,14,32,0.7)" }}>
        {NAV.filter((n) => features.catalog || n.key !== "discovered").map((n) => <button key={n.key} onClick={() => setView(n.key)} className="caps shrink-0" style={{ padding: "0.4rem 0.6rem", borderRadius: 4, border: `1px solid ${view === n.key ? C.primary : C.outlineVar}`, background: view === n.key ? "rgba(173,198,255,0.08)" : "transparent", color: view === n.key ? C.primary : C.onVar }}>{n.label}</button>)}
      </div>

      <div className="flex">
        <aside className="hidden md:flex flex-col shrink-0 border-r hair" style={{ width: 260, position: "sticky", top: 0, height: "100vh", background: "rgba(6,14,32,0.8)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", padding: "16px 0", boxShadow: "4px 0 24px rgba(0,0,0,0.5)" }}>
          <div className="px-5 mb-6"><Logo /></div>
          <nav className="px-4 space-y-1 shrink-0">
            <NavItem icon={LayoutDashboard} label="Command Center" active={navActive("command")} onClick={() => setView("command")} indicator={<span className="dot pulse-green" style={{ background: sysStatus.color, width: 6, height: 6 }} />} />
            <NavItem icon={Boxes} label="Assessments" active={navActive("catalog")} onClick={() => setView("catalog")} indicator={assessments.length ? <span className="badge">{assessments.length}</span> : null} />
            {features.catalog && (
              <NavItem icon={RadarIcon} label="Discovered" active={navActive("discovered")} onClick={() => setView("discovered")} indicator={(() => { const sh = discovered.filter((d) => !d.methods?.sso).length; return sh ? <span className="badge" style={{ background: "rgba(255,180,171,0.12)", color: C.error, borderColor: "rgba(255,180,171,0.25)" }}>{sh}</span> : (discovered.length ? <span className="badge">{discovered.length}</span> : null); })()} />
            )}
            <NavItem icon={ListChecks} label="Knowledge" active={navActive("knowledge")} onClick={() => setView("knowledge")} indicator={kbStats.pending ? <span className="badge" style={{ background: "rgba(255,185,95,0.12)", color: C.tertiary, borderColor: "rgba(255,185,95,0.25)" }}>{kbStats.pending}</span> : null} />
            <NavItem icon={Network} label="Integrations" active={navActive("integrations")} onClick={() => setView("integrations")} indicator={null} />
          </nav>
          <div className="px-4 shrink-0" style={{ marginTop: 14 }}>
            <button onClick={() => goNew()} className="btn-primary w-full" style={{ padding: "0.6rem" }}><Plus className="w-4 h-4" /> Run assessment</button>
            <div style={{ marginTop: 10 }}><Terminal busy={busy} onRun={quickRun} /></div>
          </div>
          {/* Portfolio pulse */}
          <div className="px-4 shrink-0" style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="flex items-baseline justify-between">
              <span style={{ font: "600 11.5px Inter, sans-serif", color: C.dim }}>Portfolio pulse</span>
              {pulse.n > 0 && <span className="mono" style={{ fontSize: 10, color: C.dim }}>{pulse.avg} avg</span>}
            </div>
            <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: C.scLow }} role="img" aria-label={pulse.n ? pulse.legend : "no assessments yet"}>
              <span style={{ width: pulse.wReady, background: C.secondary }} /><span style={{ width: pulse.wPart, background: C.tertiary }} /><span style={{ width: pulse.wNot, background: C.error }} />
            </div>
            <div style={{ font: "400 10.5px Inter, sans-serif", color: C.dim }}>{pulse.n ? pulse.legend : "No assessments yet"}</div>
          </div>
          {/* Engine feed — real events only (assessments, KB, discovery, heartbeats). */}
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", marginTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
            <div className="flex items-center" style={{ gap: 7, padding: "11px 18px 6px" }}>
              <span className={sysStatus.pulse ? "pulse-green" : ""} style={{ width: 6, height: 6, borderRadius: 99, background: sysStatus.color, display: "inline-block" }} />
              <span style={{ font: "600 11.5px Inter, sans-serif", color: C.dim }}>Engine feed</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative", padding: "0 14px" }}>
              {events.map((ev, i) => {
                const ek = { ok: ["✓", C.secondary], info: ["▸", C.primary], warn: ["◐", C.tertiary], err: ["✕", C.error], disc: ["●", "#8fb5ff"], kb: ["◆", C.primary] }[ev.kind] || ["▸", C.primary];
                return (
                  <div key={`${ev.t}-${i}`} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "5px 4px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <span className="mono" style={{ fontSize: 9.5, color: C.dim, flex: "none" }}>{ev.t}</span>
                    <span aria-hidden="true" style={{ fontSize: 10, flex: "none", color: ek[1] }}>{ek[0]}</span>
                    <span style={{ font: "400 11px/1.45 Inter, sans-serif", color: C.onVar, minWidth: 0 }}>{ev.text}</span>
                  </div>
                );
              })}
              {events.length === 0 && <div style={{ font: "400 11px Inter, sans-serif", color: C.dim, padding: "6px 4px" }}>Quiet so far — engine events land here.</div>}
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 48, background: "linear-gradient(180deg, rgba(6,14,32,0), rgba(6,14,32,0.92))", pointerEvents: "none" }} />
            </div>
          </div>
          <div className="flex items-center shrink-0" style={{ gap: 8, padding: "12px 18px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
            <span className={`dot ${sysStatus.pulse ? "pulse-green" : ""}`} style={{ background: sysStatus.color }} />
            <span style={{ font: "500 11.5px Inter, sans-serif", color: C.dim }}>{sysStatus.foot}</span>
            <span className="mono" style={{ marginLeft: "auto", fontSize: 10, color: C.dim }}>v1.0.0</span>
          </div>
        </aside>

        <main className="flex-1 min-w-0">
          <header className="hidden md:flex items-center gap-4 h-16 px-6 border-b hair" style={{ position: "sticky", top: 0, zIndex: 30, background: "rgba(11,19,38,0.7)", backdropFilter: "blur(12px)" }}>
            <h2 className="disp shrink-0" style={{ fontSize: 18, fontWeight: 600, color: C.on }}>{title}</h2>
            <div className="relative flex-1 max-w-md mx-auto">
              <Search className="w-4 h-4 txt-dim" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
              <TerminalSquare className="w-3.5 h-3.5 txt-dim" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)" }} />
              <input value={topSearch} onChange={(e) => setTopSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitTopSearch()} placeholder="Search or assess an app…" className="inp" style={{ padding: "0.45rem 2rem 0.45rem 2.25rem" }} />
            </div>
            <div className="flex items-center shrink-0" style={{ gap: 7, padding: "5px 12px", borderRadius: 99, background: `${sysStatus.color}1f`, border: `1px solid ${sysStatus.color}4d` }} title={ready ? `provider: ${ready.provider} · model: ${ready.model} · store: ${ready.store}${ready.webSearch ? "" : " · reduced grounding"}` : "Cannot reach the Snout backend"}><span className={`dot ${sysStatus.pulse ? "pulse-green" : ""}`} style={{ width: 7, height: 7, background: sysStatus.color }} /><span style={{ font: "600 11.5px Inter, sans-serif", color: sysStatus.color }}>{sysStatus.label}</span></div>
            {auth.oidcEnabled && auth.authenticated && (
              <div className="flex items-center gap-2 shrink-0 pl-3 border-l hair">
                {auth.email && <span className="txt-dim" style={{ fontSize: 11 }} title={`Role: ${auth.role} · Tenant: ${auth.tenant}`}>{auth.email}</span>}
                <button onClick={async () => { await logout(); window.location.href = window.location.pathname; }} className="caps txt-var" style={{ fontSize: 9, padding: "0.3rem 0.55rem", border: `1px solid ${C.outlineVar}`, borderRadius: 4 }}>Sign out</button>
              </div>
            )}
          </header>

          <div className="p-4 sm:p-6">
            <div className="max-w-6xl mx-auto">
              {demoMode && (
                <div className="panel p-3 mb-4 flex items-center gap-3" style={{ borderColor: `${C.primary}55`, background: `${C.primary}0d` }}>
                  <Sparkles className="w-4 h-4 shrink-0" style={{ color: C.primary }} />
                  <div className="min-w-0 flex-1">
                    <span className="disp" style={{ fontSize: 13, fontWeight: 600, color: C.on }}>Sample data</span>
                    <span className="txt-var" style={{ fontSize: 12.5, marginLeft: 8 }}>You're exploring Snout with demo assessments — nothing here is real. Add a provider key to run live research.</span>
                  </div>
                  <button onClick={exitDemo} className="btn-ghost shrink-0" style={{ padding: "0.25rem 0.6rem", fontSize: 10 }}>Exit demo</button>
                </div>
              )}
              {!demoMode && loaded && ready === null && (
                <div className="mb-4 flex items-center" style={{ gap: 11, padding: "10px 14px", borderRadius: 10, background: "rgba(255,180,171,0.08)", border: "1px solid rgba(255,180,171,0.35)" }}>
                  <span aria-hidden="true" style={{ color: C.error, fontSize: 13, flex: "none" }}>●</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ font: "600 12px Inter, sans-serif", color: C.error }}>Backend offline</span>
                    <span style={{ font: "400 12px Inter, sans-serif", color: C.onVar, marginLeft: 8 }}>The dashboard can't reach <span className="mono">/api</span> — start the server (<span className="mono">npm run dev</span> in <span className="mono">server/</span>).</span>
                  </span>
                  <button onClick={() => window.location.reload()} style={{ marginLeft: "auto", flex: "none", font: "500 12px Inter, sans-serif", color: C.primary, background: "transparent", border: 0, cursor: "pointer" }}>Retry now</button>
                </div>
              )}
              {!demoMode && loaded && ready && !ready.assessReady && (
                <div className="mb-4 flex items-center flex-wrap" style={{ gap: 11, padding: "10px 14px", borderRadius: 10, background: "rgba(173,198,255,0.07)", border: "1px solid rgba(173,198,255,0.3)" }}>
                  <span aria-hidden="true" style={{ color: C.primary, fontSize: 13, flex: "none" }}>◇</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ font: "600 12px Inter, sans-serif", color: C.primary }}>Setup needed</span>
                    <span style={{ font: "400 12px Inter, sans-serif", color: C.onVar, marginLeft: 8 }}>Set <span className="mono" style={{ background: C.scLowest, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "1px 6px", fontSize: 11 }}>ANTHROPIC_API_KEY</span> to enable agent research. Discovery, the knowledge base, and saved assessments still work.</span>
                  </span>
                  <span className="flex items-center shrink-0" style={{ gap: 12 }}>
                    <button onClick={enterDemo} className="btn-ghost" style={{ padding: "0.3rem 0.7rem", fontSize: 11, whiteSpace: "nowrap" }}><Sparkles className="w-3.5 h-3.5" /> Load sample data</button>
                    <a href="https://github.com/sknib1337/Snout#configuration" target="_blank" rel="noopener noreferrer" style={{ font: "500 12px Inter, sans-serif", color: C.primary, textDecoration: "none" }}>Docs →</a>
                  </span>
                </div>
              )}
              {!demoMode && loaded && ready && ready.assessReady && !ready.webSearch && (
                <div className="mb-4 flex items-center" style={{ gap: 11, padding: "10px 14px", borderRadius: 10, background: "rgba(255,185,95,0.07)", border: "1px solid rgba(255,185,95,0.35)" }}>
                  <span aria-hidden="true" style={{ color: C.tertiary, fontSize: 13, flex: "none" }}>◐</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ font: "600 12px Inter, sans-serif", color: C.tertiary }}>Reduced grounding</span>
                    <span style={{ font: "400 12px Inter, sans-serif", color: C.onVar, marginLeft: 8 }}>Non-Anthropic provider: citations dropped, new verdicts capped at ◐ Partial.</span>
                  </span>
                  <button onClick={() => toast("info", "Why reduced grounding?", "Only the Anthropic path has live web search. Without it the model can't retrieve evidence, so Snout deterministically drops citations and caps unproven verdicts rather than over-trusting them.")} style={{ marginLeft: "auto", flex: "none", font: "500 12px Inter, sans-serif", color: C.primary, background: "transparent", border: 0, cursor: "pointer" }}>Why →</button>
                </div>
              )}
              {alerts.length > 0 && (
                <div className="panel p-3 mb-4 flex items-center gap-3" style={{ borderColor: `${C.error}40`, background: `${C.error}0d` }}>
                  <ShieldAlert className="w-4 h-4 shrink-0" style={{ color: C.error }} />
                  <div className="min-w-0 flex-1">
                    <span className="disp" style={{ fontSize: 13, fontWeight: 600, color: C.on }}>{alerts.length} monitoring alert{alerts.length > 1 ? "s" : ""}</span>
                    <span className="txt-var" style={{ fontSize: 12.5, marginLeft: 8 }}>{alerts[0].title}</span>
                  </div>
                </div>
              )}
              {!loaded ? (
                <div className="py-24 grid place-items-center txt-dim"><Loader2 className="w-6 h-6 spin" /></div>
              ) : view === "command" ? (
                <CommandCenter assessments={assessments} discovered={discovered} kbPending={kbStats.pending} kbStale={kbStats.stale} kbCount={kbStats.count} readiness={ready} onOpen={open} onNew={() => goNew()} goCatalog={() => { setCatalogQuery(""); setView("catalog"); }} goDiscovered={() => setView("discovered")} goKnowledge={() => setView("knowledge")} onAssessDiscovered={handleAssessDiscovered} busyDomain={busyDomain} onDemo={demoMode ? undefined : enterDemo} />
              ) : view === "catalog" ? (
                <Catalog assessments={assessments} onOpen={open} onNew={() => goNew()} initialQuery={catalogQuery} onDemo={demoMode ? undefined : enterDemo} />
              ) : view === "discovered" ? (
                <Discovered apps={discovered} busyDomain={busyDomain} onAssess={handleAssessDiscovered} onOpen={open} onDelete={handleDeleteDiscovered} />
              ) : view === "assess" ? (
                <AssessForm onRun={handleRun} busy={busy} error={error} prefill={prefill} />
              ) : view === "knowledge" ? (
                <KnowledgeView onKbChange={refreshKb} />
              ) : view === "integrations" ? (
                <Integrations onAssessCatalog={(app) => goNew({ name: app.name, vendor: app.vendor })} />
              ) : view === "detail" && current ? (
                <Detail a={current} onBack={() => setView("command")} onReassess={() => goNew({ name: current.app, vendor: current.vendor })} onVerify={handleVerify} />
              ) : (
                <CommandCenter assessments={assessments} discovered={discovered} kbPending={kbStats.pending} kbStale={kbStats.stale} kbCount={kbStats.count} readiness={ready} onOpen={open} onNew={() => goNew()} goCatalog={() => setView("catalog")} goDiscovered={() => setView("discovered")} goKnowledge={() => setView("knowledge")} onAssessDiscovered={handleAssessDiscovered} busyDomain={busyDomain} onDemo={demoMode ? undefined : enterDemo} />
              )}
              <footer className="mt-8 txt-dim" style={{ fontSize: 11.5, lineHeight: 1.7, fontFamily: "Inter, sans-serif" }}>Snout scores the six IPSIE-aligned identity controls — SSO · lifecycle · entitlements · risk signals · logout · token revocation. Verdicts are evidence-backed, not advice; confirm citations before acting.</footer>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
