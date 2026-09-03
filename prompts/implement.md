---
description: Full implementation workflow - scout gathers context, planner creates plan, worker implements
---
Run this as three Agent tool calls in sequence, each with run_in_background: false, passing the previous result into the next prompt verbatim:

1. Agent "scout": find all code relevant to: $@
2. Agent "planner": create an implementation plan for "$@" using the scout's findings.
3. Agent "worker": implement the planner's plan.

Report the worker's "Files Changed" list at the end.
