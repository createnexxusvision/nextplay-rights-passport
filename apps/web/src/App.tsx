import { useEffect, useState } from "react";
import { health } from "./api";
import logoMark from "./assets/nextplay-mark.png";
import { ProofView } from "./features/ProofView";
import { RoyaltiesView } from "./features/RoyaltiesView";
import { VaultView } from "./features/VaultView";
import { isMidnightConfigured } from "./midnight/config";
import { ExperimentalBanner } from "./midnight/ExperimentalBanner";
import { NetworkStatus, type AIStatus } from "./midnight/NetworkStatus";
import { useMidnightWallet } from "./midnight/useMidnightWallet";
import type { VaultAsset } from "./vault";

type Tab = "vault" | "proof" | "royalties";
const TABS: { id: Tab; label: string }[] = [
  { id: "vault", label: "Rights Vault" },
  { id: "proof", label: "Proof Passport" },
  { id: "royalties", label: "Royalty Routes" },
];

export function App() {
  const wallet = useMidnightWallet();
  // Live on-chain writes need a deployed RightsRegistry contract and its adapter (ADR-010/013).
  // Until both exist, every record is clearly labeled demo, even with Lace connected.
  const contractAdapterReady = false;
  const isLive = contractAdapterReady && isMidnightConfigured() && wallet.status === "connected" && !wallet.networkMismatch;

  const [ai, setAi] = useState<AIStatus>("checking");
  useEffect(() => {
    void health().then((h) => setAi(h ? h.ai : "offline"));
  }, []);

  const [tab, setTab] = useState<Tab>("vault");
  // The vault lives in memory only. The encrypted private copy is the way to keep it.
  const [assets, setAssets] = useState<VaultAsset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checksRun, setChecksRun] = useState(0);
  // Unsaved work: the vault is memory-only, so warn before a refresh or close throws it away.
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = (id: string, patch: (a: VaultAsset) => VaultAsset) => {
    setAssets((xs) => xs.map((a) => (a.id === id ? patch(a) : a)));
    setDirty(true);
  };
  const go = (t: Tab) => {
    setTab(t);
    document.getElementById("main")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <ExperimentalBanner />
      <header className="topbar">
        <div className="topbar-inner">
          <a href="/" className="brand">
            <img src={logoMark} alt="NextPlay Nexus" width={40} height={35} />
            <span>NextPlay Rights</span>
          </a>
          <nav className="nav" aria-label="Sections">
            {TABS.map((t) => (
              <button key={t.id} className={`nav-tab${tab === t.id ? " active" : ""}`} aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
          <div className="topbar-right">
            <NetworkStatus wallet={wallet} isLive={isLive} ai={ai} />
            {wallet.status === "unavailable" ? (
              <a className="btn-outline" href="https://www.lace.io/" target="_blank" rel="noreferrer noopener">Install or enable Lace</a>
            ) : wallet.status === "connected" ? (
              <button className="btn-connected" title={wallet.address} onClick={wallet.disconnect}>Lace {wallet.shortAddress} · disconnect</button>
            ) : (
              <button className="primary" disabled={wallet.status === "connecting" || wallet.status === "detecting"} onClick={() => void wallet.connect()}>
                {wallet.status === "connecting" ? "Connecting…" : wallet.status === "detecting" ? "Looking for Lace…" : "Connect Lace"}
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="shell">
        <section className="hero">
          <p className="eyebrow">For the 98% who go pro in something else</p>
          <h1>Your highlights fade. Your rights don't.</h1>
          <p>
            Turn every photo, video, phrase, design and performance into a private, provable career asset. Set who can use it and how,
            check any brand or AI request against your terms, and carry it long after the final whistle. Your private terms stay on this
            device; only sealed fingerprints are shared.
          </p>
          <div className="actions">
            <button className="primary" onClick={() => go("vault")}>Enter my vault</button>
            <button className="ghost" onClick={() => go("proof")}>Check a request</button>
          </div>
          {wallet.error && <p className="error" role="alert">{wallet.error}</p>}
        </section>

        <main id="main">
          {tab === "vault" && (
            <VaultView
              assets={assets}
              selectedId={selectedId}
              checksRun={checksRun}
              onSelect={setSelectedId}
              dirty={dirty}
              onSaved={() => setDirty(false)}
              onAdd={(a) => {
                setAssets((xs) => [...xs, a]);
                setSelectedId(a.id);
                setDirty(true);
              }}
              onUpdate={update}
              onImport={(restored) => {
                setAssets(restored);
                setSelectedId(restored[0]?.id ?? null);
                setDirty(false);
              }}
              onGoToProof={() => setTab("proof")}
            />
          )}
          {tab === "proof" && (
            <ProofView
              assets={assets}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onDisclose={(id, disclose) => update(id, (a) => ({ ...a, disclose }))}
              onChecked={() => setChecksRun((n) => n + 1)}
              onGoToVault={() => setTab("vault")}
            />
          )}
          {tab === "royalties" && (
            <RoyaltiesView assets={assets} selectedId={selectedId} onSelect={setSelectedId} onUpdate={update} onGoToVault={() => setTab("vault")} />
          )}
        </main>
      </div>

      <footer className="footer">
        <div className="footer-inner">
          <p className="footer-lead">Experimental hackathon build, AI-assisted and not audited. This is not legal advice.</p>
          <p>A passport records claims and sealed terms; it doesn't decide ownership or infringement. Registration is evidence of a submitted commitment, not government copyright registration.</p>
          <p>Minor athletes may need a parent, guardian or authorized representative. NIL rules vary by state, school, conference, league and governing body.</p>
          <p>Nothing is written to a blockchain yet, and Royalty Routes doesn't move money in this build.</p>
        </div>
      </footer>
    </>
  );
}
