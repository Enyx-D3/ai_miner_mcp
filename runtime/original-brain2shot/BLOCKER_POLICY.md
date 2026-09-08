# Branch-Local Blocker Policy

1. Record exact blocker/evidence.
2. Block only dependent descendants.
3. Recompute READY.
4. Continue highest-value independent lane.
5. Recheck blocker after upstream changes.
6. Stop only if every remaining useful lane is blocked.
