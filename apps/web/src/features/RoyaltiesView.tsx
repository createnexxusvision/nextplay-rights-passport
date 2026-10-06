import { useState } from "react";
import { allocate, canonicalize, commit, formatMinor, validateSplits } from "@nextplay/core";
import { shorten } from "../midnight/config";
import { currentSeal, MAX_CONTRIBUTORS, MAX_NAME, roleLabel, ROLES, splitsOf, uid, type Contributor, type VaultAsset } from "../vault";

interface Props {
  assets: VaultAsset[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: (a: VaultAsset) => VaultAsset) => void;
  onGoToVault: () => void;
}

/**
 * Royalty Routes: who gets what when this asset is licensed. Splits are basis
 * points that must total exactly 100%; payouts use largest-remainder
 * allocation so they always add up to the cent. Simulation only — no money moves.
 */
export function RoyaltiesView({ assets, selectedId, onSelect, onUpdate, onGoToVault }: Props) {
  const asset = assets.find((a) => a.id === selectedId) ?? assets[0];
  const [fee, setFee] = useState("5000");

  if (!asset) {
    return (
      <div className="empty">
        Register an asset first, then set who gets paid when it's licensed.
        <div className="actions center"><button className="primary" onClick={onGoToVault}>Go to Rights Vault</button></div>
      </div>
    );
  }

  const assetId = asset.id;
  const splits = splitsOf(asset);
  const errors = validateSplits(splits.filter((s) => s.bps > 0));
  const splitsOk = errors.length === 0 && splits.every((s) => s.bps > 0);
  const totalPct = splits.reduce((s, x) => s + x.bps, 0) / 100;
  const currency = currentSeal(asset)?.policy.currency ?? "USD";
  const feeMinor = Math.round((Number.parseFloat(fee) || 0) * 100);
  const payouts = splitsOk && feeMinor >= 0 ? allocate(BigInt(feeMinor), splits) : null;
  const sealedMatches = asset.splitSeal ? canonicalize(asset.splitSeal.splits) === canonicalize(splits) : false;

  const patch = (id: string, p: Partial<Contributor>) =>
    onUpdate(assetId, (a) => ({ ...a, contributors: a.contributors.map((c) => (c.id === id ? { ...c, ...p } : c)) }));

  async function sealSplit() {
    const { commitment, opening } = await commit("split", splits);
    onUpdate(assetId, (a) => ({ ...a, splitSeal: { splits, commitment, opening, sealedAt: new Date().toISOString() } }));
  }

  return (
    <div className="stack">
      <div className="section-head">
        <h2>Royalty Routes</h2>
        <select aria-label="Asset" value={asset.id} onChange={(e) => onSelect(e.target.value)}>
          {assets.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
        </select>
      </div>
      <p className="hint">Set who gets paid when this asset is licensed. You keep ownership: a brand only gets the rights your sealed policy grants. Names stay private; the passport shows only how many people are credited.</p>

      <div className="layout">
        <section className="panel">
          <h3>Split</h3>
          <div className="rows">
            {asset.contributors.map((c) => (
              <div className="row" key={c.id}>
                <input aria-label="Contributor name" maxLength={MAX_NAME} value={c.name} onChange={(e) => patch(c.id, { name: e.target.value })} placeholder="Name (private)" />
                <select aria-label="Role" value={c.role} onChange={(e) => patch(c.id, { role: e.target.value as Contributor["role"] })}>
                  {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                </select>
                <span className="pct"><input aria-label="Share in percent" inputMode="decimal" maxLength={6} value={c.pct} onChange={(e) => patch(c.id, { pct: e.target.value })} />%</span>
                <button className="ghost" aria-label="Remove contributor" disabled={asset.contributors.length === 1}
                  onClick={() => onUpdate(asset.id, (a) => ({ ...a, contributors: a.contributors.filter((x) => x.id !== c.id) }))}>Remove</button>
              </div>
            ))}
          </div>
          <div className="row-foot">
            <button className="ghost" disabled={asset.contributors.length >= MAX_CONTRIBUTORS} onClick={() => onUpdate(asset.id, (a) => ({ ...a, contributors: [...a.contributors, { id: uid(), name: "", role: "filmer", pct: "0" }] }))}>Add contributor</button>
            <span className={splitsOk ? "ok" : "warn"}>{splitsOk ? "Splits add up to 100%" : `Splits add up to ${totalPct}%. They need to total 100%.`}</span>
          </div>
          <div className="actions">
            <button className="primary" disabled={!splitsOk || sealedMatches} onClick={() => void sealSplit()}>{sealedMatches ? "Split sealed" : asset.splitSeal ? "Seal updated split" : "Seal split"}</button>
          </div>
          {asset.splitSeal && (
            <p className="note">
              {sealedMatches ? "Sealed" : "Last sealed split differs from the one above"} · <code>{shorten(asset.splitSeal.commitment.commitment, 12, 8)}</code>
            </p>
          )}
        </section>

        <section className="panel payout">
          <h3>Payout simulator</h3>
          <label>If a license pays ({currency})<input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} /></label>
          {payouts ? (
            <table className="payouts">
              <thead><tr><th>Contributor</th><th>Share</th><th>Receives</th></tr></thead>
              <tbody>
                {asset.contributors.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name || roleLabel(c.role)}<small>{c.name ? ` · ${roleLabel(c.role)}` : ""}</small></td>
                    <td>{c.pct}%</td>
                    <td>{formatMinor(Number(payouts.get(c.id) ?? 0n), currency)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td>Total</td><td>100%</td><td>{formatMinor(feeMinor, currency)}</td></tr></tfoot>
            </table>
          ) : (
            <p className="warn">Fix the split to see payouts.</p>
          )}
          <p className="note">Simulation only. Royalty Routes doesn't move money in this build. Amounts always add up to the cent (largest-remainder allocation).</p>
        </section>
      </div>
    </div>
  );
}
