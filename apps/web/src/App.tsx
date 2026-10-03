import { useEffect, useMemo, useState } from "react";
import {
  commit,
  contentHash,
  DemoLedger,
  RightsPolicy,
  UseRequest,
  validateSplits,
  type AnchorResult,
  type SplitEntry,
} from "@nextplay/core";
import { analyze, evaluateStructured, health, UseFormError, type CheckResult } from "./api";
import { Passport, type PassportAsset } from "./Passport";
import { PrivateCopyPanel } from "./PrivateCopyPanel";
import type { Sealed } from "./privateCopy";

const ledger = new DemoLedger();

const MEDIA = ["social", "web", "advertising", "editorial", "broadcast", "print", "merchandise", "in_game"] as const;
const MEDIA_LABEL: Record<(typeof MEDIA)[number], string> = {
  social: "Social",
  web: "Web",
  advertising: "Advertising",
  editorial: "Editorial",
  broadcast: "Broadcast",
  print: "Print",
  merchandise: "Merchandise",
  in_game: "In-game",
};
const ROLES = ["athlete", "creator", "filmer", "editor", "producer", "agent", "other"] as const;
const ASSET_TYPES = ["Highlight video", "Photo", "Audio", "Design", "Other"] as const;

const EXAMPLES = [
  {
    label: "Instagram repost",
    text: "We'd like to repost the game-winner clip on Instagram and our website in the US for 30 days, crediting the athlete. Fee: $1,500.",
  },
  {
    label: "AI-generated ad",
    text: "Our agency wants to generate an AI video ad using the athlete's face and voice for a 60-day US campaign. Budget $5,000.",
  },
  {
    label: "Vague request",
    text: "Can we use the photo in some marketing? We'll pay something fair.",
  },
];

type Contributor = { id: string; name: string; role: (typeof ROLES)[number]; pct: string };

interface PolicyDraft {
  territory: string;
  media: string[];
  durationDays: string;
  commercialUse: boolean;
  aiTraining: boolean;
  aiGeneration: boolean;
  likenessUse: boolean;
  sublicensing: boolean;
  attributionRequired: boolean;
  minimumFee: string;
  currency: string;
}

const uid = () => crypto.randomUUID().slice(0, 8);

function describeTerms(r: UseRequest): string[] {
  const yesNo = (b: boolean) => (b ? "yes" : "no");
  return [
    `Use: ${r.useType.replace("_", " ")}`,
    `Channels: ${r.media.length ? r.media.map((m) => MEDIA_LABEL[m]).join(", ") : "not stated"}`,
    `Countries: ${r.territory.length ? r.territory.join(", ") : "not stated"}`,
    `Length: ${r.durationDays !== undefined ? `${r.durationDays} days` : "not stated"}`,
    `Fee: ${r.offeredFeeMinor !== undefined ? `${(r.offeredFeeMinor / 100).toFixed(2)} ${r.currency ?? ""}`.trim() : "not stated"}`,
    `Commercial: ${yesNo(r.commercial)} · Likeness: ${yesNo(r.likeness)} · AI generation: ${yesNo(r.aiGeneration)} · AI training: ${yesNo(r.aiTraining)} · Sublicensing: ${yesNo(r.sublicensing)}`,
  ];
}

export function App() {
  const [aiStatus, setAiStatus] = useState<"enabled" | "disabled" | "offline" | "checking">("checking");
  useEffect(() => {
    void health().then((h) => setAiStatus(h ? h.ai : "offline"));
  }, []);

  // 1 — Asset
  const [asset, setAsset] = useState<PassportAsset | null>(null);
  const [title, setTitle] = useState("");
  const [assetType, setAssetType] = useState<string>(ASSET_TYPES[0]);
  const [hashing, setHashing] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setHashing(true);
    const hash = await contentHash(new Uint8Array(await file.arrayBuffer()));
    setHashing(false);
    setAsset({
      title: title.trim() || file.name.replace(/\.[^.]+$/, ""),
      assetType,
      fileName: file.name,
      sizeBytes: file.size,
      contentHash: hash,
      registeredAt: new Date().toISOString(),
    });
    if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ""));
  }

  // 2 — Contributors
  const [contributors, setContributors] = useState<Contributor[]>([
    { id: uid(), name: "", role: "athlete", pct: "70" },
    { id: uid(), name: "", role: "filmer", pct: "30" },
  ]);
  const splits: SplitEntry[] = contributors.map((c) => ({
    contributorRef: c.id,
    role: c.role,
    bps: Math.round((Number.parseFloat(c.pct) || 0) * 100),
  }));
  const splitErrors = validateSplits(splits.filter((s) => s.bps > 0));
  const totalPct = splits.reduce((s, x) => s + x.bps, 0) / 100;
  const splitsOk = splitErrors.length === 0 && splits.every((s) => s.bps > 0);
  const patchContributor = (id: string, patch: Partial<Contributor>) =>
    setContributors((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  // 3 — Policy
  const [draft, setDraft] = useState<PolicyDraft>({
    territory: "US",
    media: ["social", "web", "advertising"],
    durationDays: "90",
    commercialUse: true,
    aiTraining: false,
    aiGeneration: false,
    likenessUse: false,
    sublicensing: false,
    attributionRequired: true,
    minimumFee: "1000",
    currency: "USD",
  });
  const [sealed, setSealed] = useState<Sealed[]>([]);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const current = sealed.at(-1);
  const set = <K extends keyof PolicyDraft>(k: K, v: PolicyDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  async function sealPolicy() {
    const fee = draft.minimumFee.trim();
    const parsed = RightsPolicy.safeParse({
      version: (current?.policy.version ?? 0) + 1,
      territory: draft.territory.split(/[\s,]+/).filter(Boolean),
      media: draft.media,
      durationDays: draft.durationDays ? Number(draft.durationDays) : undefined,
      commercialUse: draft.commercialUse,
      aiTraining: draft.aiTraining,
      aiGeneration: draft.aiGeneration,
      likenessUse: draft.likenessUse,
      sublicensing: draft.sublicensing,
      attributionRequired: draft.attributionRequired,
      minimumFeeMinor: fee ? Math.round(Number(fee) * 100) : undefined,
      currency: fee ? draft.currency : undefined,
    });
    if (!parsed.success) {
      setPolicyError("Check the policy: countries must be 2-letter codes (or WORLD), pick at least one channel, and use whole numbers for days.");
      return;
    }
    setPolicyError(null);
    const { commitment, opening } = await commit("rights-policy", parsed.data);
    setSealed((s) => [...s, { policy: parsed.data, commitment, opening, sealedAt: new Date().toISOString() }]);
    setResult(null);
    setAnchor(null);
  }

  // 4 — Request
  const [mode, setMode] = useState<"text" | "form">("text");
  const [requestText, setRequestText] = useState(EXAMPLES[1]!.text);
  const [form, setForm] = useState({
    useType: "advertising",
    media: ["advertising"] as string[],
    territory: "US",
    durationDays: "30",
    commercial: true,
    aiTraining: false,
    aiGeneration: false,
    likeness: false,
    sublicensing: false,
    fee: "1500",
  });
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);

  async function runCheck() {
    if (!current) return;
    setChecking(true);
    setCheckError(null);
    try {
      if (mode === "text") {
        setResult(await analyze(current.policy, requestText));
      } else {
        const req = UseRequest.safeParse({
          useType: form.useType,
          media: form.media,
          territory: form.territory.split(/[\s,]+/).filter(Boolean),
          durationDays: form.durationDays ? Number(form.durationDays) : undefined,
          commercial: form.commercial,
          aiTraining: form.aiTraining,
          aiGeneration: form.aiGeneration,
          likeness: form.likeness,
          sublicensing: form.sublicensing,
          offeredFeeMinor: form.fee ? Math.round(Number(form.fee) * 100) : undefined,
          currency: form.fee ? current.policy.currency ?? "USD" : undefined,
        });
        if (!req.success) throw new Error("Check the request: countries must be 2-letter codes and days a whole number.");
        setResult(await evaluateStructured(current.policy, req.data));
      }
    } catch (e) {
      if (e instanceof UseFormError) setMode("form");
      setCheckError(e instanceof Error ? e.message : "The check didn't finish.");
    } finally {
      setChecking(false);
    }
  }

  // An AI-read ALLOWED is provisional: it only covers the terms the AI extracted.
  // The requester confirms those exact terms and the engine re-checks them directly.
  const pendingTerms = result?.confirmation?.required ? result.confirmation.terms : null;
  async function confirmTerms() {
    if (!current || !pendingTerms) return;
    setChecking(true);
    setCheckError(null);
    try {
      setResult(await evaluateStructured(current.policy, pendingTerms));
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : "The check didn't finish.");
    } finally {
      setChecking(false);
    }
  }

  // Passport anchoring (demo ledger until the Midnight milestone)
  const [anchor, setAnchor] = useState<AnchorResult | null>(null);
  async function anchorPolicy() {
    if (!current || !asset) return;
    setAnchor(
      await ledger.anchor({
        recordId: asset.contentHash.slice(2, 18),
        commitment: current.commitment,
        idempotencyKey: current.commitment.commitment,
      }),
    );
  }

  const [disclose, setDisclose] = useState({ title: true, assetType: true, contributors: true });
  const contributorCount = useMemo(() => splits.filter((s) => s.bps > 0).length, [splits]);

  return (
    <div className="shell">
      <header className="masthead">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">NP</span>
          <span>NextPlay Rights Passport</span>
        </div>
        <p className={`status status-${aiStatus}`} role="status">
          {aiStatus === "checking" && "Connecting to the rights API"}
          {aiStatus === "enabled" && "Nemotron reading is on"}
          {aiStatus === "disabled" && "AI reading is off. Use the request form."}
          {aiStatus === "offline" && "Rights API offline. Run npm run dev:api"}
        </p>
      </header>

      <section className="hero">
        <h1>Your highlights fade. Your rights don't.</h1>
        <p>
          Register a moment, set who can use it and how, then check any brand or AI request against your terms.
          Your private terms stay on this device. Only a sealed fingerprint of them is shared.
        </p>
      </section>

      <main className="layout">
        <ol className="steps">
          <li className="step">
            <h2><span className="step-n">1</span>Register the asset</h2>
            <p className="hint">The file never leaves your device. We take its fingerprint (SHA-256) here in the browser.</p>
            <div className="grid2">
              <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Game-winner vs. Central, Oct 2026" /></label>
              <label>Type
                <select value={assetType} onChange={(e) => setAssetType(e.target.value)}>
                  {ASSET_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </label>
            </div>
            <label className="drop">
              <input type="file" onChange={(e) => void onFile(e.target.files?.[0])} />
              <strong>{hashing ? "Fingerprinting…" : asset ? `Fingerprinted ${asset.fileName}` : "Choose a file to fingerprint"}</strong>
              <span>{asset ? <code>{asset.contentHash}</code> : "Video, photo, audio or design file. Any size."}</span>
            </label>
          </li>

          <li className="step">
            <h2><span className="step-n">2</span>Credit the contributors</h2>
            <p className="hint">Splits must add up to exactly 100%. Names stay private; the passport only shows how many people are credited.</p>
            <div className="rows">
              {contributors.map((c) => (
                <div className="row" key={c.id}>
                  <input aria-label="Contributor name" value={c.name} onChange={(e) => patchContributor(c.id, { name: e.target.value })} placeholder="Name" />
                  <select aria-label="Role" value={c.role} onChange={(e) => patchContributor(c.id, { role: e.target.value as Contributor["role"] })}>
                    {ROLES.map((r) => <option key={r} value={r}>{r[0]!.toUpperCase() + r.slice(1)}</option>)}
                  </select>
                  <span className="pct"><input aria-label="Share in percent" inputMode="decimal" value={c.pct} onChange={(e) => patchContributor(c.id, { pct: e.target.value })} />%</span>
                  <button className="ghost" aria-label="Remove contributor" disabled={contributors.length === 1} onClick={() => setContributors((cs) => cs.filter((x) => x.id !== c.id))}>Remove</button>
                </div>
              ))}
            </div>
            <div className="row-foot">
              <button className="ghost" onClick={() => setContributors((cs) => [...cs, { id: uid(), name: "", role: "creator", pct: "0" }])}>Add contributor</button>
              <span className={splitsOk ? "ok" : "warn"}>{splitsOk ? "Splits add up to 100%" : `Splits add up to ${totalPct}%. They need to total 100%.`}</span>
            </div>
          </li>

          <li className="step">
            <h2><span className="step-n">3</span>Set the rights policy</h2>
            <p className="hint">Sealing creates a new version. Earlier versions stay on record, so nothing is silently rewritten.</p>
            <div className="grid2">
              <label>Countries<input value={draft.territory} onChange={(e) => set("territory", e.target.value)} placeholder="US, CA or WORLD" /></label>
              <label>Longest use (days)<input inputMode="numeric" value={draft.durationDays} onChange={(e) => set("durationDays", e.target.value)} placeholder="Leave blank for no limit" /></label>
              <label>Minimum fee<input inputMode="decimal" value={draft.minimumFee} onChange={(e) => set("minimumFee", e.target.value)} placeholder="Leave blank for none" /></label>
              <label>Currency<input value={draft.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></label>
            </div>
            <fieldset>
              <legend>Channels</legend>
              <div className="chips">
                {MEDIA.map((m) => (
                  <label key={m} className="chip">
                    <input type="checkbox" checked={draft.media.includes(m)} onChange={(e) => set("media", e.target.checked ? [...draft.media, m] : draft.media.filter((x) => x !== m))} />
                    {MEDIA_LABEL[m]}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Permissions</legend>
              <div className="toggles">
                {([
                  ["commercialUse", "Commercial use"],
                  ["attributionRequired", "Require credit"],
                  ["likenessUse", "Face, voice and likeness"],
                  ["aiGeneration", "AI-generated content"],
                  ["aiTraining", "AI model training"],
                  ["sublicensing", "Sublicensing"],
                ] as const).map(([k, label]) => (
                  <label key={k} className="toggle">
                    <input type="checkbox" role="switch" checked={draft[k]} onChange={(e) => set(k, e.target.checked)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {policyError && <p className="error" role="alert">{policyError}</p>}
            <div className="actions">
              <button className="primary" onClick={() => void sealPolicy()}>{current ? `Seal as version ${current.policy.version + 1}` : "Seal policy"}</button>
            </div>
            <PrivateCopyPanel
              asset={asset}
              sealed={sealed}
              onImport={(data) => {
                setSealed(data.sealed);
                if (data.asset) {
                  setAsset(data.asset);
                  setTitle(data.asset.title);
                }
                setResult(null);
                setAnchor(null);
              }}
            />
            {current && (
              <p className="note">
                Version {current.policy.version} sealed. Save an encrypted private copy: it's the only way to prove what this seal contains later, and it survives a page refresh.
              </p>
            )}
          </li>

          <li className="step">
            <h2><span className="step-n">4</span>Check a request to use it</h2>
            <p className="hint">Paste what a brand or AI agent is asking for. The AI only reads it; the decision comes from your policy.</p>
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={mode === "text"} onClick={() => setMode("text")}>Describe it</button>
              <button role="tab" aria-selected={mode === "form"} onClick={() => setMode("form")}>Fill in the details</button>
            </div>
            {mode === "text" ? (
              <>
                <div className="examples">
                  {EXAMPLES.map((ex) => (
                    <button key={ex.label} className="ghost small" onClick={() => setRequestText(ex.text)}>{ex.label}</button>
                  ))}
                </div>
                <label className="sr-only" htmlFor="req">Request</label>
                <textarea id="req" rows={4} maxLength={4000} value={requestText} onChange={(e) => setRequestText(e.target.value)} />
              </>
            ) : (
              <div className="grid2">
                <label>Use
                  <select value={form.useType} onChange={(e) => setForm({ ...form, useType: e.target.value })}>
                    {["social", "editorial", "advertising", "merchandising", "ai_generation", "ai_training", "other"].map((u) => <option key={u} value={u}>{u.replace("_", " ")}</option>)}
                  </select>
                </label>
                <label>Channel
                  <select value={form.media[0]} onChange={(e) => setForm({ ...form, media: [e.target.value] })}>
                    {MEDIA.map((m) => <option key={m} value={m}>{MEDIA_LABEL[m]}</option>)}
                  </select>
                </label>
                <label>Countries<input value={form.territory} onChange={(e) => setForm({ ...form, territory: e.target.value })} /></label>
                <label>Days<input inputMode="numeric" value={form.durationDays} onChange={(e) => setForm({ ...form, durationDays: e.target.value })} /></label>
                <label>Fee offered<input inputMode="decimal" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} /></label>
                <div className="toggles compact">
                  {([["commercial", "Commercial"], ["likeness", "Likeness"], ["aiGeneration", "AI generation"], ["aiTraining", "AI training"]] as const).map(([k, l]) => (
                    <label key={k} className="toggle"><input type="checkbox" role="switch" checked={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} /><span>{l}</span></label>
                  ))}
                </div>
              </div>
            )}
            {checkError && <p className="error" role="alert">{checkError}</p>}
            {pendingTerms && (
              <div className="confirm" role="region" aria-label="Confirm these terms">
                <h3>Confirm these terms</h3>
                <p className="hint">The AI read the request as the terms below. The approval only covers these terms, not the wording of the request.</p>
                <ul className="terms">
                  {describeTerms(pendingTerms).map((t) => <li key={t}>{t}</li>)}
                </ul>
                <div className="actions">
                  <button className="primary" disabled={checking} onClick={() => void confirmTerms()}>Confirm these terms</button>
                  <button className="ghost" onClick={() => setMode("form")}>Edit in the form</button>
                </div>
              </div>
            )}
            <div className="actions">
              <button className="primary" disabled={!current || checking} onClick={() => void runCheck()}>
                {checking ? "Checking…" : "Check request"}
              </button>
              {!current && <span className="warn">Seal a policy first.</span>}
            </div>
          </li>
        </ol>

        <Passport
          asset={asset}
          disclose={disclose}
          onDisclose={setDisclose}
          contributorCount={contributorCount}
          splitsOk={splitsOk}
          sealed={current ? { version: current.policy.version, commitment: current.commitment, history: sealed.length } : null}
          result={result}
          anchor={anchor}
          onAnchor={() => void anchorPolicy()}
        />
      </main>

      <footer className="footer">
        Experimental hackathon build, not audited and not legal advice. A passport records claims and sealed terms; it doesn't decide
        ownership or infringement. Nothing is written to a blockchain yet.
      </footer>
    </div>
  );
}
