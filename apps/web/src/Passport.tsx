import { useEffect, useState } from "react";
import type { AnchorResult, Commitment, ReasonCode } from "@nextplay/core";
import type { CheckResult } from "./api";
import { DECISION_TEXT, OBLIGATION_TEXT, REASON_TEXT } from "./labels";

export interface PassportAsset {
  title: string;
  assetType: string;
  fileName: string;
  sizeBytes: number;
  contentHash: string;
  registeredAt: string;
}

type Disclose = { title: boolean; assetType: boolean; contributors: boolean };

interface Props {
  asset: PassportAsset | null;
  disclose: Disclose;
  onDisclose: (d: Disclose) => void;
  contributorCount: number;
  splitsOk: boolean;
  sealed: { version: number; commitment: Commitment; history: number } | null;
  result: CheckResult | null;
  /** True only after the receipt signature verified against the published keys. */
  receiptVerified: boolean;
  anchor: AnchorResult | null;
  onAnchor: () => void;
  /** Licensing state from the vault. */
  licensing?: "open" | "paused" | "revoked";
}

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;
const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export function Passport({ asset, disclose, onDisclose, contributorCount, splitsOk, sealed, result, receiptVerified, anchor, onAnchor, licensing }: Props) {
  // Re-key the stamp on every new result so it lands again.
  const [stampKey, setStampKey] = useState(0);
  useEffect(() => {
    if (result) setStampKey((k) => k + 1);
  }, [result]);

  const reasons: string[] = result
    ? [...(result.evaluation?.denials ?? []), ...(result.evaluation?.reviews ?? result.reviews ?? [])]
    : [];

  return (
    <aside className="passport" aria-label="Rights passport">
      <div className="passport-head">
        <span>Rights passport</span>
        <span className="passport-ver">{sealed ? `Policy v${sealed.version}` : "No policy yet"}</span>
      </div>

      <div className="passport-body">
        <p className="passport-title">
          {!asset ? "Register an asset to start" : disclose.title ? asset.title : "Title kept private"}
        </p>

        <dl className="facts">
          <div><dt>Type</dt><dd>{asset ? (disclose.assetType ? asset.assetType : "Private") : "—"}</dd></div>
          <div><dt>Registered</dt><dd>{asset ? date(asset.registeredAt) : "—"}</dd></div>
          <div><dt>Contributors</dt><dd>{disclose.contributors ? (splitsOk ? `${contributorCount} credited` : "Splits incomplete") : "Private"}</dd></div>
          {licensing && (
            <div><dt>Licensing</dt><dd className={licensing === "open" ? "ok" : "warn"}>{licensing === "open" ? "Open to requests" : licensing === "paused" ? "Paused" : "Revoked"}</dd></div>
          )}
          <div><dt>Fingerprint</dt><dd><code title={asset?.contentHash}>{asset?.contentHash ? short(asset.contentHash) : "—"}</code></dd></div>
          <div><dt>Policy seal</dt><dd><code title={sealed?.commitment.commitment}>{sealed ? short(sealed.commitment.commitment) : "—"}</code></dd></div>
        </dl>

        <div className="verdict" aria-live="polite">
          {result ? (
            <>
              <div key={stampKey} className={`stamp stamp-${result.decision.toLowerCase()}`}>
                {DECISION_TEXT[result.decision].stamp}
              </div>
              <p className="verdict-line">{DECISION_TEXT[result.decision].line}</p>
              {receiptVerified && result.receipt && (
                <p className="signed" title={`Receipt ${result.receipt.receipt.receiptId}, key ${result.receipt.receipt.kid}`}>
                  Signed by NextPlay rights engine
                </p>
              )}
              {result.confirmation?.required && (
                <p className="warn">Provisional. Confirm the terms the AI read before relying on this.</p>
              )}
              {reasons.length > 0 && (
                <ul className="reasons">
                  {reasons.map((r) => <li key={r}>{REASON_TEXT[r as ReasonCode] ?? r}</li>)}
                </ul>
              )}
              {result.decision !== "DENIED" &&
                result.evaluation?.obligations.map((o) => <p key={o} className="obligation">{OBLIGATION_TEXT[o]}</p>)}
              {result.ai.status === "ok" && result.ai.explanation && (
                <blockquote className="ai-read">
                  <p>{result.ai.explanation}</p>
                  <footer>How the request was read: terms from Nemotron and the text. Advisory only.</footer>
                </blockquote>
              )}
            </>
          ) : (
            <p className="verdict-empty">Check a request to see the decision land here.</p>
          )}
        </div>

        <div className="anchor">
          <button className="secondary" disabled={!asset || !sealed} onClick={onAnchor}>Record policy seal</button>
          {anchor?.status === "not_anchored" && (
            <p className="demo-label">Demo record only. Not committed to Midnight yet.</p>
          )}
          {anchor?.status === "anchored" && <p className="ok">Recorded on {anchor.network}: <code>{short(anchor.txId)}</code></p>}
          {anchor?.status === "failed" && <p className="error">Couldn't record the seal: {anchor.error}</p>}
        </div>

        <fieldset className="disclose">
          <legend>Show on the shared passport</legend>
          {(["title", "assetType", "contributors"] as const).map((k) => (
            <label key={k} className="toggle">
              <input type="checkbox" role="switch" checked={disclose[k]} onChange={(e) => onDisclose({ ...disclose, [k]: e.target.checked })} />
              <span>{k === "title" ? "Title" : k === "assetType" ? "Type" : "Contributor count"}</span>
            </label>
          ))}
        </fieldset>

        <details className="tech">
          <summary>Technical details</summary>
          <dl>
            <dt>Content fingerprint (SHA-256)</dt><dd><code>{asset?.contentHash || "—"}</code></dd>
            <dt>Policy seal ({sealed ? `${sealed.history} version${sealed.history > 1 ? "s" : ""} on record` : "none"})</dt>
            <dd><code>{sealed?.commitment.commitment ?? "—"}</code></dd>
            <dt>Seal scheme</dt><dd>SHA-256 over domain tag, 32-byte private salt and canonical JSON</dd>
            <dt>Decision engine</dt><dd>{result?.evaluation?.engineVersion ?? "—"}</dd>
            <dt>Decision receipt</dt>
            <dd>
              {!result?.receipt ? "—" : receiptVerified
                ? <>Ed25519, key <code>{result.receipt.receipt.kid}</code>, verified</>
                : "Not verified"}
            </dd>
            <dt>AI</dt>
            <dd>
              {!result ? "—" : result.ai.status === "ok"
                ? `${result.ai.model}, ${result.ai.latencyMs} ms, confidence ${Math.round((result.ai.confidence ?? 0) * 100)}%`
                : result.ai.status === "not_used" ? "Not used (form request)" : `Unavailable (${result.ai.reason ?? result.ai.status})`}
            </dd>
          </dl>
        </details>
      </div>
    </aside>
  );
}
