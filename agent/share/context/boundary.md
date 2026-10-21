# Boundary (runtime and human reference — never sent to the model)

1. The policy engine (`packages/core/src/policy-engine.ts`) is the only component that decides.
   The model reads requests; it never sees the policy, never sees engine results, and never approves.
2. The AI can only make an outcome more cautious: low confidence, conflicts, repairs or
   disagreeing readings move ALLOWED to NEEDS_REVIEW. Nothing moves anything toward ALLOWED.
3. An AI-derived ALLOWED is provisional until the requester confirms the exact structured terms.
4. Fee and duration come only from the request text, read by code. The model is not asked for them.
5. Model output that fails its schema is discarded; the request goes to a person or the form.
6. No tool calling by the model. The runtime runs a fixed loop of allowlisted steps (`bin/`).
7. The request text, the policy and salts are never logged or written to disk.
8. Budgets are hard limits: when a daily cap is reached the AI path turns off and the form still works.
