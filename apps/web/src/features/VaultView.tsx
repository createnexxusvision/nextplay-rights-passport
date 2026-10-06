import { useState } from "react";
import { commit, contentHashStream, RightsPolicy } from "@nextplay/core";
import { PrivateCopyPanel } from "../PrivateCopyPanel";
import { shorten } from "../midnight/config";
import { ASSET_TYPE_LABEL, ASSET_TYPES, currentSeal, roleLabel, ROLES, uid, type AssetType, type Role, type VaultAsset } from "../vault";

export const MEDIA = ["social", "web", "advertising", "editorial", "broadcast", "print", "merchandise", "in_game"] as const;
export const MEDIA_LABEL: Record<(typeof MEDIA)[number], string> = {
  social: "Social", web: "Web", advertising: "Advertising", editorial: "Editorial",
  broadcast: "Broadcast", print: "Print", merchandise: "Merchandise", in_game: "In-game",
};

interface Props {
  assets: VaultAsset[];
  selectedId: string | null;
  checksRun: number;
  onSelect: (id: string) => void;
  onAdd: (a: VaultAsset) => void;
  onUpdate: (id: string, patch: (a: VaultAsset) => VaultAsset) => void;
  onImport: (assets: VaultAsset[]) => void;
  onGoToProof: () => void;
}

const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export function VaultView({ assets, selectedId, checksRun, onSelect, onAdd, onUpdate, onImport, onGoToProof }: Props) {
  const [showForm, setShowForm] = useState(assets.length === 0);
  const selected = assets.find((a) => a.id === selectedId);
  const live = assets.filter((a) => !a.revoked);

  return (
    <div className="stack">
      <div className="stats">
        <Stat label="Protected assets" value={live.length} />
        <Stat label="Policy seals" value={assets.reduce((n, a) => n + a.sealed.length, 0)} />
        <Stat label="Open to licensing" value={live.filter((a) => a.licensing === "open" && a.sealed.length > 0).length} />
        <Stat label="Requests checked" value={checksRun} note="This session" />
      </div>

      <div className="section-head">
        <h2>My vault</h2>
        <button className="primary" onClick={() => setShowForm((v) => !v)}>{showForm ? "Close" : "Register new asset"}</button>
      </div>

      {showForm && (
        <RegisterForm
          onDone={(a) => {
            onAdd(a);
            setShowForm(false);
          }}
        />
      )}

      {assets.length === 0 ? (
        !showForm && (
          <p className="empty">Nothing protected yet. Register your first career asset (a highlight, a phrase, a design) and it becomes provable everywhere in NextPlay.</p>
        )
      ) : (
        <div className="cards">
          {assets.map((a) => (
            <AssetCard
              key={a.id}
              asset={a}
              selected={a.id === selectedId}
              onSelect={() => onSelect(a.id)}
              onToggleLicensing={() => onUpdate(a.id, (x) => ({ ...x, licensing: x.licensing === "open" ? "paused" : "open" }))}
              onRevoke={() => {
                if (window.confirm(`Revoke future licensing for "${a.title}"? Requests will no longer be checked against it.`)) {
                  onUpdate(a.id, (x) => ({ ...x, revoked: true, licensing: "paused" }));
                }
              }}
            />
          ))}
        </div>
      )}

      {selected && !selected.revoked && (
        <PolicyEditor key={selected.id} asset={selected} onSealed={(s) => onUpdate(selected.id, (x) => ({ ...x, sealed: [...x.sealed, s] }))} onGoToProof={onGoToProof} />
      )}

      <section className="panel">
        <h3>Private copy</h3>
        <p className="hint">The vault lives only in this tab. Save an encrypted copy to keep it across refreshes and to prove later what each seal contains.</p>
        <PrivateCopyPanel assets={assets} onImport={onImport} />
      </section>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="stat">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {note && <p className="stat-note">{note}</p>}
    </div>
  );
}

function AssetCard({ asset: a, selected, onSelect, onToggleLicensing, onRevoke }: {
  asset: VaultAsset; selected: boolean; onSelect: () => void; onToggleLicensing: () => void; onRevoke: () => void;
}) {
  const seal = currentSeal(a);
  const status = a.revoked ? "revoked" : seal ? "sealed" : "draft";
  return (
    <article className={`card${selected ? " card-selected" : ""}`}>
      <div className="card-head">
        <button className="card-title" onClick={onSelect} aria-pressed={selected}>
          <span>{a.title}</span>
          <small>{ASSET_TYPE_LABEL[a.assetType]} · registered {date(a.registeredAt)}</small>
        </button>
        <span className={`pill pill-${status}`}>{status === "sealed" ? `Policy v${seal!.policy.version}` : status === "draft" ? "No policy yet" : "Revoked"}</span>
      </div>
      <dl className="card-facts">
        <div><dt>Licensing</dt><dd>{a.revoked ? "Revoked" : a.licensing === "open" ? "Open" : "Paused"}</dd></div>
        <div><dt>Contributors</dt><dd>{a.contributors.length}</dd></div>
        <div className="wide"><dt>Fingerprint</dt><dd><code>{a.contentHash ? shorten(a.contentHash, 12, 8) : "—"}</code></dd></div>
      </dl>
      {!a.revoked && (
        <div className="card-actions">
          <button className="ghost small" onClick={onSelect}>{seal ? "Edit policy" : "Set policy"}</button>
          <button className="ghost small" onClick={onToggleLicensing}>{a.licensing === "open" ? "Pause licensing" : "Open to licensing"}</button>
          <button className="ghost small danger" onClick={onRevoke}>Revoke future licensing</button>
        </div>
      )}
    </article>
  );
}

function RegisterForm({ onDone }: { onDone: (a: VaultAsset) => void }) {
  const [title, setTitle] = useState("");
  const [assetType, setAssetType] = useState<AssetType>("video");
  const [creatorRole, setCreatorRole] = useState<Role>("athlete");
  const [open, setOpen] = useState(true);
  const [file, setFile] = useState<{ name: string; size: number; hash: string } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setProgress(0);
    setError(null);
    try {
      // Streamed (S7): a multi-GB video is hashed chunk by chunk, never loaded whole.
      let last = 0;
      const hash = await contentHashStream(f.stream(), (n) => {
        const pct = f.size ? Math.floor((n / f.size) * 100) : 100;
        if (pct !== last) setProgress((last = pct));
      });
      setFile({ name: f.name, size: f.size, hash });
      if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ""));
    } catch {
      setError("Couldn't read that file. Try again or pick another copy.");
    } finally {
      setProgress(null);
    }
  }

  function register() {
    if (!file) return setError("Choose the file to fingerprint first.");
    onDone({
      id: uid(),
      title: title.trim() || file.name,
      assetType,
      creatorRole,
      fileName: file.name,
      sizeBytes: file.size,
      contentHash: file.hash,
      registeredAt: new Date().toISOString(),
      contributors: [{ id: uid(), name: "", role: creatorRole, pct: "100" }],
      sealed: [],
      licensing: open ? "open" : "paused",
      revoked: false,
      disclose: { title: true, assetType: true, contributors: true },
    });
  }

  return (
    <section className="panel">
      <h3>Register an asset</h3>
      <p className="hint">The file never leaves your device. Its SHA-256 fingerprint is taken here in the browser.</p>
      <div className="grid3">
        <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Game-winner vs. Central, Oct 2026" /></label>
        <label>Type
          <select value={assetType} onChange={(e) => setAssetType(e.target.value as AssetType)}>
            {ASSET_TYPES.map((t) => <option key={t} value={t}>{ASSET_TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        <label>Your role
          <select value={creatorRole} onChange={(e) => setCreatorRole(e.target.value as Role)}>
            {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>
        </label>
      </div>
      <label className="drop">
        <input type="file" onChange={(e) => void onFile(e.target.files?.[0])} />
        <strong>{progress !== null ? `Fingerprinting… ${progress}%` : file ? `Fingerprinted ${file.name}` : "Choose a file to fingerprint"}</strong>
        {progress !== null && <progress max={100} value={progress} aria-label="Fingerprinting progress" />}
        <span>{file ? <code>{file.hash}</code> : "Video, photo, audio, phrase or design file. Any size."}</span>
      </label>
      <label className="toggle inline">
        <input type="checkbox" role="switch" checked={open} onChange={(e) => setOpen(e.target.checked)} />
        <span>Open to licensing requests</span>
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button className="primary" disabled={!file || progress !== null} onClick={register}>Register asset</button>
      </div>
    </section>
  );
}

interface PolicyDraft {
  territory: string; media: string[]; durationDays: string; commercialUse: boolean; aiTraining: boolean; aiGeneration: boolean;
  likenessUse: boolean; sublicensing: boolean; attributionRequired: boolean; minimumFee: string; currency: string;
}

function draftFrom(a: VaultAsset): PolicyDraft {
  const p = currentSeal(a)?.policy;
  if (!p) {
    return { territory: "US", media: ["social", "web", "advertising"], durationDays: "90", commercialUse: true, aiTraining: false,
      aiGeneration: false, likenessUse: false, sublicensing: false, attributionRequired: true, minimumFee: "1000", currency: "USD" };
  }
  return {
    territory: p.territory.join(", "), media: [...p.media], durationDays: p.durationDays ? String(p.durationDays) : "",
    commercialUse: p.commercialUse, aiTraining: p.aiTraining, aiGeneration: p.aiGeneration, likenessUse: p.likenessUse,
    sublicensing: p.sublicensing, attributionRequired: p.attributionRequired,
    minimumFee: p.minimumFeeMinor !== undefined ? String(p.minimumFeeMinor / 100) : "", currency: p.currency ?? "USD",
  };
}

function PolicyEditor({ asset, onSealed, onGoToProof }: { asset: VaultAsset; onSealed: (s: VaultAsset["sealed"][number]) => void; onGoToProof: () => void }) {
  const [draft, setDraft] = useState<PolicyDraft>(() => draftFrom(asset));
  const [error, setError] = useState<string | null>(null);
  const current = currentSeal(asset);
  const set = <K extends keyof PolicyDraft>(k: K, v: PolicyDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  async function seal() {
    const fee = draft.minimumFee.trim();
    const parsed = RightsPolicy.safeParse({
      version: (current?.policy.version ?? 0) + 1,
      territory: draft.territory.split(/[\s,]+/).filter(Boolean),
      media: draft.media,
      durationDays: draft.durationDays ? Number(draft.durationDays) : undefined,
      commercialUse: draft.commercialUse, aiTraining: draft.aiTraining, aiGeneration: draft.aiGeneration,
      likenessUse: draft.likenessUse, sublicensing: draft.sublicensing, attributionRequired: draft.attributionRequired,
      minimumFeeMinor: fee ? Math.round(Number(fee) * 100) : undefined,
      currency: fee ? draft.currency : undefined,
    });
    if (!parsed.success) {
      return setError("Check the policy: countries must be 2-letter codes (or WORLD), pick at least one channel, and use whole numbers for days.");
    }
    setError(null);
    const { commitment, opening } = await commit("rights-policy", parsed.data);
    onSealed({ policy: parsed.data, commitment, opening, sealedAt: new Date().toISOString() });
  }

  return (
    <section className="panel">
      <h3>Rights policy · {asset.title}</h3>
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
            ["commercialUse", "Commercial use"], ["attributionRequired", "Require credit"], ["likenessUse", "Face, voice and likeness"],
            ["aiGeneration", "AI-generated content"], ["aiTraining", "AI model training"], ["sublicensing", "Sublicensing"],
          ] as const).map(([k, label]) => (
            <label key={k} className="toggle">
              <input type="checkbox" role="switch" checked={draft[k]} onChange={(e) => set(k, e.target.checked)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button className="primary" onClick={() => void seal()}>{current ? `Seal as version ${current.policy.version + 1}` : "Seal policy"}</button>
        {current && <button className="ghost" onClick={onGoToProof}>Check a request against v{current.policy.version}</button>}
      </div>
      {current && <p className="note">Version {current.policy.version} sealed · <code>{shorten(current.commitment.commitment, 12, 8)}</code></p>}
    </section>
  );
}
