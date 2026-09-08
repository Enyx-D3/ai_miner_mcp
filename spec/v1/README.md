# Brain2 AI Miner V1 shared contracts

These schemas are the cross-repository V1 boundary for `ai-miner-web`, `ai_miner_app`, and `ai_miner_mcp`.

Key invariants:

1. Platform-local storage schema versions may differ during migration; `contractVersion` is the cross-surface compatibility version.
2. Stable identity remains `B2_ID_V9_ASIF_READER` until an explicit migration gate changes it.
3. R1 is authoritative verified state. R2 is provisional derived intelligence. R2 cannot directly mutate Current Truth.
4. Graph expansion is bounded by the B2JOB graph/evidence budget.
5. Runtime execution is capability-based. There is no arbitrary shell capability in V1.
6. A valid R1 authorization envelope is required for executable jobs.
7. Deterministic provenance verification and semantic claim verification are separate verdicts.
