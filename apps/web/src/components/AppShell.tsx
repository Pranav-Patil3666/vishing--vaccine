import { Activity, AudioLines, BookOpenCheck, LayoutDashboard, Menu, Mic2, Radio, ShieldCheck, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ApiHealthResponse } from "@vaccine/contracts";
import type { AppRoute } from "../route.js";
import { routeHash } from "../route.js";

const navigation = [
  { label: "Overview", route: { page: "dashboard" } as const, icon: LayoutDashboard },
  { label: "Training", route: { page: "scenarios" } as const, icon: BookOpenCheck },
  { label: "Scenario authoring", route: { page: "authoring" } as const, icon: Sparkles },
  { label: "Session history", route: { page: "sessions" } as const, icon: Activity },
];

export function AppShell({ route, health, healthChecked = true, children }: {
  route: AppRoute;
  health: ApiHealthResponse | null;
  healthChecked?: boolean;
  children: ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const active = route.page === "scenario" || route.page === "precall" || route.page === "live" ? "scenarios"
    : route.page === "debrief" ? "sessions" : route.page;
  const main = useRef<HTMLElement>(null);
  const hash = routeHash(route);
  const previousHash = useRef(hash);
  useEffect(() => {
    if (previousHash.current !== hash) { previousHash.current = hash; main.current?.focus(); }
  }, [hash]);

  return <div className="app-frame">
    <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); main.current?.focus(); }}>Skip to content</a>
    <div className="ambient ambient-one" aria-hidden="true" />
    <div className="ambient ambient-two" aria-hidden="true" />
    <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`} aria-label="Primary navigation">
      <a className="brand-lockup" href="#/dashboard" onClick={() => setMobileNavOpen(false)}>
        <span className="brand-mark"><ShieldCheck size={21} strokeWidth={1.8} /><AudioLines className="brand-wave" size={12} /></span>
        <span><strong>Vishing Vaccine</strong><small>VOICE SECURITY LAB</small></span>
      </a>
      <div className="sidebar-label">WORKSPACE</div>
      <nav id="workspace-navigation" className="side-nav">
        {navigation.map(({ label, route: target, icon: Icon }) => <a key={label}
          href={routeHash(target)} className={`nav-link ${active === target.page ? "nav-link-active" : ""}`}
          aria-current={active === target.page ? "page" : undefined} onClick={() => setMobileNavOpen(false)}>
          <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
        </a>)}
      </nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-system-card">
        <div className="mini-orbit"><Mic2 size={16} /></div>
        <div><strong>Safe by design</strong><span>Fictional calls · dummy data</span></div>
        <span className="system-dot" aria-label="Safety controls enabled" />
      </div>
      <div className="sidebar-footer"><span className="tiny-dot" /> Development environment <span className="footer-version">v0.1</span></div>
    </aside>
    {mobileNavOpen && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
    <div className="workspace">
      <header className="topbar">
        <button type="button" className="icon-button mobile-menu" aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileNavOpen} aria-controls="workspace-navigation" onClick={() => setMobileNavOpen(!mobileNavOpen)}>
          {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{navigation.find((item) => item.route.page === active)?.label ?? "Training session"}</strong></div>
        <div className="topbar-right">
          <span className="environment-pill"><span className="pulse-dot" /> SIMULATION ONLY</span>
          <span className={`api-pill ${health ? "api-up" : "api-down"}`}><Radio size={14} /> {!healthChecked ? "CHECKING API" : health ? "API ONLINE" : "API OFFLINE"}</span>
        </div>
      </header>
      <main id="main-content" className="main-content" tabIndex={-1} ref={main}>{children}</main>
      <footer className="workspace-footer"><span>VISHING VACCINE</span><span>SIMULATED TRAINING · NO REAL CREDENTIALS</span></footer>
    </div>
  </div>;
}
