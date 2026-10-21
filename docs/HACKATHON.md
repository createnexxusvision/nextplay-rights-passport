# Hackathon build checklist

Target: **Nebius × NVIDIA hackathon, Best Apps and Agents track.** Check the official rules page for the exact deadline and requirements; this list mirrors the private planning docs.

## Requirements
- [x] Public open-source repository with a license (Apache-2.0)
- [x] README explaining the Nebius/NVIDIA usage
- [x] Uses an NVIDIA open model (Nemotron) via Nebius Token Factory (gateway code done)
- [ ] Live Nemotron run passes `npm run eval` (needs Nebius credentials)
- [x] Working demo UI (`apps/web`): full flow verified in Chromium against a stand-in model server
- [ ] Public YouTube demo under 3 minutes
- [ ] Devpost submission copy

## Milestones
1. ✅ **Foundation:** core package, API, AI gateway, tests, CI, secret scanning
2. ⏳ **AI live:** set the Nebius model, tune the prompt, eval corpus green
3. ✅ **Web:** register asset (local SHA-256) → policy editor → request → decision → Proof Passport (demo-labelled)
4. ⏳ **Saturday, Midnight:** RightsRegistry contract, Preview deploy, real anchoring (see `contracts/README.md`)
5. ⏳ **Submission:** video, Devpost copy

## Prior-work disclosure
This repository was created on 2026-10-02 for the hackathon. Earlier, separate prototypes informed its design:
- `createnexxusvision/career-asset-vault`: Midnight rights-vault UI prototype (plan dated 2026-08-28)
- `createnexxusvision/quietquote`: sealed-quote commitment prototype (tested 2026-08-31)

Code built during the hackathon period: everything in this repo, including the AI gateway, policy engine, salted commitments and eval corpus. Concepts and UI patterns were adapted from those prototypes and are credited here.
