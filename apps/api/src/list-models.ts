/**
 * Lists the NVIDIA / Nemotron models available to your Nebius Token Factory key,
 * so NEBIUS_MODEL is set to an exact, current ID (catalogs change).
 *   npm run models
 */
const base = (process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1").replace(/\/$/, "");
const key = process.env.NEBIUS_API_KEY;
if (!key) {
  console.error("Set NEBIUS_API_KEY (in .env or your shell) first.");
  process.exit(1);
}
const res = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${key}` } });
if (!res.ok) {
  console.error(`Model list failed: HTTP ${res.status}`);
  process.exit(1);
}
const { data } = (await res.json()) as { data: Array<{ id: string }> };
const nvidia = data.map((m) => m.id).filter((id) => /nemotron|nvidia/i.test(id)).sort();
console.log(nvidia.length ? nvidia.join("\n") : "No NVIDIA/Nemotron models visible to this key.");
console.log(`\n(${data.length} models total) — copy one into NEBIUS_MODEL`);
