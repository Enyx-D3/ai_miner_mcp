# Autonomous Scheduler

If ChatGPT scheduled tasks are used:
- hourly is the maximum supported recurrence
- each run reopens latest verified checkpoint
- select READY/VERIFY work
- execute useful bounded work
- VEGA verifies
- CONTROL commits
- generate residuals
- continue until the invocation ends

This scheduler is a wake-up layer, not proof of continuous background execution.
A dedicated external Brain2/server executor may consume the same graph continuously.
