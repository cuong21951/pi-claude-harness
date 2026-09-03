---
description: Scout gathers context, planner creates implementation plan (no implementation)
---
Run this as two Agent tool calls in sequence, each with run_in_background: false, passing the previous result into the next prompt verbatim:

1. Agent "scout": find all code relevant to: $@
2. Agent "planner": create an implementation plan for "$@" using the scout's findings.

Do NOT implement. Return the plan.
