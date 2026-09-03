---
description: Worker implements, reviewer reviews, worker applies feedback
---
Run this as three Agent tool calls in sequence, each with run_in_background: false, passing the previous result into the next prompt verbatim:

1. Agent "worker": implement: $@
2. Agent "reviewer": review the implementation from step 1 (list the files it changed).
3. Agent "worker": apply the reviewer's feedback from step 2.

Report the final "Files Changed" list at the end.
