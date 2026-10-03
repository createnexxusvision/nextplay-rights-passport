import { useState } from "react";
import { exportPrivateCopy, importPrivateCopy, MIN_PASSPHRASE, type Sealed } from "./privateCopy";
import type { PassportAsset } from "./Passport";

interface Props {
  asset: PassportAsset | null;
  sealed: Sealed[];
  onImport: (data: { asset: PassportAsset | null; sealed: Sealed[] }) => void;
}

function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Save / import the passphrase-encrypted private copy (S6). */
export function PrivateCopyPanel({ asset, sealed, onImport }: Props) {
  const [mode, setMode] = useState<"closed" | "save" | "import">("closed");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const reset = (next: typeof mode) => {
    setMode(next);
    setPass("");
    setPass2("");
    setFile(null);
    setMsg(null);
  };

  async function save() {
    if (pass.length < MIN_PASSPHRASE) return setMsg({ kind: "error", text: `Use at least ${MIN_PASSPHRASE} characters.` });
    if (pass !== pass2) return setMsg({ kind: "error", text: "The passphrases don't match." });
    setBusy(true);
    try {
      const vault = await exportPrivateCopy(asset, sealed, pass);
      downloadJson(`nextplay-private-copy-v${sealed.at(-1)!.policy.version}.npvault.json`, vault);
      reset("closed");
      setMsg({ kind: "ok", text: "Encrypted private copy saved. Without the passphrase nobody, including you, can open it." });
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Couldn't save the private copy." });
    } finally {
      setBusy(false);
    }
  }

  async function load() {
    if (!file) return setMsg({ kind: "error", text: "Choose a private copy file." });
    setBusy(true);
    try {
      const data = await importPrivateCopy(await file.text(), pass);
      onImport(data);
      reset("closed");
      setMsg({ kind: "ok", text: `Restored ${data.sealed.length} sealed version${data.sealed.length > 1 ? "s" : ""}. Every seal was re-checked against its terms.` });
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Couldn't open the private copy." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="private-copy">
      <div className="actions">
        {sealed.length > 0 && <button className="ghost" onClick={() => reset(mode === "save" ? "closed" : "save")}>Save private copy</button>}
        <button className="ghost" onClick={() => reset(mode === "import" ? "closed" : "import")}>Import private copy</button>
      </div>
      {mode === "save" && (
        <div className="vault-form">
          <p className="hint">The copy holds your private terms and the salts that open each seal. It's encrypted with this passphrase (AES-256-GCM). There is no recovery if you lose it.</p>
          <label>Passphrase<input type="password" autoComplete="new-password" minLength={MIN_PASSPHRASE} value={pass} onChange={(e) => setPass(e.target.value)} /></label>
          <label>Repeat passphrase<input type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} /></label>
          <button className="primary" disabled={busy} onClick={() => void save()}>{busy ? "Encrypting…" : "Encrypt and save"}</button>
        </div>
      )}
      {mode === "import" && (
        <div className="vault-form">
          <label>Private copy file<input type="file" accept=".json,application/json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          <label>Passphrase<input type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} /></label>
          <button className="primary" disabled={busy} onClick={() => void load()}>{busy ? "Decrypting…" : "Import"}</button>
        </div>
      )}
      {msg && <p className={msg.kind === "ok" ? "note" : "error"} role={msg.kind === "error" ? "alert" : "status"}>{msg.text}</p>}
    </div>
  );
}
