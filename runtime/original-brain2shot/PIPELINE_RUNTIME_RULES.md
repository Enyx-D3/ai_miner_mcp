# Persistent Executable Work Graph

Every node:
- id
- lane
- objective
- dependencies
- status: WAITING / READY / RUNNING / VERIFY / REPAIR / BLOCKED / CLOSED / SUPERSEDED / NOT_APPLICABLE
- priority
- hard_gate
- artifacts
- residuals
- blockers

Main loop:

while terminal_gate != PASS:
    reconcile_physical_state()
    discover_residual_work()
    update_dependency_graph()
    ready = executable_nodes()

    if ready:
        node = choose_highest_information_value(ready)
        execute(node)
        VEGA_verify(node)
        repair_if_safe(node)
        CONTROL_checkpoint()
        discover_residual_work()
        continue

    if independent_useful_work_exists():
        enqueue_it()
        continue

    if all_remaining_useful_work_is_blocked():
        return INCOMPLETE_WITH_EXPLICIT_BLOCKERS

    run_unknown_unknown_search()

There is no report-and-return after an ordinary node.

Checkpoint = SAVE → VEGA VERIFY → CONTROL COMMIT → CONTINUE.
