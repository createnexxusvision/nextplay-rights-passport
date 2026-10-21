import { useEffect, useState } from "react";
import { DemoLedger, UseRequest, validateSplits, verifyReceipt, type AnchorResult } from "@nextplay/core";
import { analyze, evaluateStructured, receiptKeys, UseFormError, type CheckResult } from "../api";
import { Passport } from "../Passport";
import { ASSET_TYPE_LABEL, CLAIM_SHORT, confirmedDaysAgo, currentSeal, splitsOf, STALE_DAYS, type Disclose, type Sealed, type VaultAsset } from "../vault";
import { MEDIA, MEDIA_LABEL } from "./VaultView";

// Demo ledger until a Midnight contract is deployed: it can never return a txId (ADR-010).
const ledger = new DemoLedger();

const EXAMPLES = [
  { label: "Instagram repost", text: "We'd like to repost the game-winner clip on Instagram and our website in the US for 30 days, crediting the athlete. Fee: $1,500." },
  { label: "AI-generated ad", text: "Our agency wants to generate an AI video ad using the athlete's face and voice for a 60-day US campaign. Budget $5,000." },
  { label: "Vague request", text: "Can we use the photo in some marketing? We'll pay something fair." },
];

const sealOf = (s: Sealed) => ({ commitment: s.commitment.commitment, salt: s.opening.salt });

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

interface Props {
  assets: VaultAsset[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDisclose: (id: string, d: Disclose) => void;
  onChecked: () => void;
  onGoToVault: () => void;
}

export function ProofView({ assets, selectedId, onSelect, onDisclose, onChecked, onGoToVault }: Props) {
  const asset = assets.find((a) => a.id === selectedId) ?? assets[0];
  const current = currentSeal(asset);

  const [mode, setMode] = useState<"text" | "form">("text");
  const [requestText, setRequestText] = useState(EXAMPLES[0]!.text);
  const [form, setForm] = useState({
    useType: "advertising", media: ["advertising"] as string[], territory: "US", durationDays: "30",
    commercial: true, aiTraining: false, aiGeneration: false, likeness: false, sublicensing: false, fee: "1500",
  });
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [anchor, setAnchor] = useState<AnchorResult | null>(null);
  const [receiptOk, setReceiptOk] = useState(false);

  // A result belongs to one asset and one policy version: clear it when either changes.
  const resultKey = `${asset?.id}:${current?.policy.version}`;
  useEffect(() => {
    setResult(null);
    setAnchor(null);
    setCheckError(null);
  }, [resultKey]);

  // C2/S9: the "signed" badge appears only after the receipt verifies locally
  // AND says exactly what is on screen: this seal, this version, this decision.
  useEffect(() => {
    setReceiptOk(false);
    const signed = result?.receipt;
    if (!signed || !current) return;
    let live = true;
    void receiptKeys().then((keys) => {
      const r = signed.receipt;
      const ok = verifyReceipt(signed, keys).ok && r.policyCommitment === current.commitment.commitment.toLowerCase() &&
        r.policyVersion === current.policy.version && r.decision === result.decision;
      if (live) setReceiptOk(ok);
    });
    return () => {
      live = false;
    };
  }, [result, current]);

  if (!asset) {
    return (
      <div className="empty">
        Register an asset in your vault to generate a Proof Passport.
        <div className="actions center"><button className="primary" onClick={onGoToVault}>Go to Rights Vault</button></div>
      </div>
    );
  }

  const blocked = asset.revoked ? "Licensing for this asset was revoked." : asset.licensing === "paused" ? "Licensing is paused for this asset. Open it in Rights Vault." : !current ? "Seal a policy for this asset first." : null;

  async function run(fn: () => Promise<CheckResult>) {
    setChecking(true);
    setCheckError(null);
    try {
      setResult(await fn());
      onChecked();
    } catch (e) {
      if (e instanceof UseFormError) setMode("form");
      setCheckError(e instanceof Error ? e.message : "The check didn't finish.");
    } finally {
      setChecking(false);
    }
  }

  function runCheck() {
    if (!current) return;
    if (mode === "text") return void run(() => analyze(current.policy, requestText, sealOf(current)));
    const req = UseRequest.safeParse({
      useType: form.useType, media: form.media, territory: form.territory.split(/[\s,]+/).filter(Boolean),
      durationDays: form.durationDays ? Number(form.durationDays) : undefined,
      commercial: form.commercial, aiTraining: form.aiTraining, aiGeneration: form.aiGeneration, likeness: form.likeness, sublicensing: form.sublicensing,
      offeredFeeMinor: form.fee ? Math.round(Number(form.fee) * 100) : undefined,
      currency: form.fee ? current.policy.currency ?? "USD" : undefined,
    });
    if (!req.success) return setCheckError("Check the request: countries must be 2-letter codes and days a whole number.");
    void run(() => evaluateStructured(current.policy, req.data, sealOf(current)));
  }

  // An AI-read ALLOWED is provisional: it only covers the terms the AI extracted.
  const pendingTerms = result?.confirmation?.required ? result.confirmation.terms : null;
  const splits = splitsOf(asset);
  const splitsOk = validateSplits(splits).length === 0;

  return (
    <div className="stack">
      <div className="section-head">
        <h2>Proof Passport</h2>
        <select aria-label="Asset" value={asset.id} onChange={(e) => onSelect(e.target.value)}>
          {assets.map((a) => <option key={a.id} value={a.id}>{a.title}{a.revoked ? " (revoked)" : ""}</option>)}
        </select>
      </div>
      <p className="hint">Check what a brand or AI agent is asking for. The AI only reads the request; the decision comes from your sealed policy. Share proof of the terms without revealing who you are or what you were paid.</p>

      <div className="layout">
        <section className="panel">
          <h3>Check a request</h3>
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={mode === "text"} onClick={() => setMode("text")}>Describe it</button>
            <button role="tab" aria-selected={mode === "form"} onClick={() => setMode("form")}>Fill in the details</button>
          </div>
          {mode === "text" ? (
            <>
              <div className="examples">
                {EXAMPLES.map((ex) => <button key={ex.label} className="ghost small" onClick={() => setRequestText(ex.text)}>{ex.label}</button>)}
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
              <ul className="terms">{describeTerms(pendingTerms).map((t) => <li key={t}>{t}</li>)}</ul>
              <div className="actions">
                <button className="primary" disabled={checking} onClick={() => current && void run(() => evaluateStructured(current.policy, pendingTerms, sealOf(current)))}>Confirm these terms</button>
                <button className="ghost" onClick={() => setMode("form")}>Edit in the form</button>
              </div>
            </div>
          )}
          <div className="actions">
            <button className="primary" disabled={Boolean(blocked) || checking} onClick={runCheck}>{checking ? "Checking…" : "Check request"}</button>
            {blocked && <span className="warn">{blocked}</span>}
            {!blocked && (confirmedDaysAgo(asset) ?? 0) > STALE_DAYS && (
              <span className="warn">Rights last confirmed over {STALE_DAYS} days ago. Reconfirm in Rights Vault if nothing was assigned elsewhere.</span>
            )}
          </div>
        </section>

        <Passport
          asset={{ title: asset.title, assetType: ASSET_TYPE_LABEL[asset.assetType], fileName: asset.fileName, sizeBytes: asset.sizeBytes, contentHash: asset.contentHash, registeredAt: asset.registeredAt }}
          disclose={asset.disclose}
          onDisclose={(d) => onDisclose(asset.id, d)}
          contributorCount={splits.length}
          splitsOk={splitsOk}
          sealed={current ? { version: current.policy.version, commitment: current.commitment, history: asset.sealed.length } : null}
          result={result}
          receiptVerified={receiptOk}
          anchor={anchor}
          licensing={asset.revoked ? "revoked" : asset.licensing}
          claim={current ? CLAIM_SHORT[current.policy.claimBasis ?? "original"] : undefined}
          confirmed={(() => {
            const d = confirmedDaysAgo(asset);
            return d === null ? null : { days: d, stale: d > STALE_DAYS };
          })()}
          onAnchor={() => {
            if (!current || !asset.contentHash) return;
            void ledger
              .anchor({ recordId: asset.contentHash.slice(2, 18), commitment: current.commitment, idempotencyKey: current.commitment.commitment })
              .then(setAnchor);
          }}
        />
      </div>
    </div>
  );
}
