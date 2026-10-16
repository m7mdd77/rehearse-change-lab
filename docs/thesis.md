# Simulation as a contract

In two years, capable agents will be judged less by how convincingly they describe an action and more by how precisely they bound its consequences.

Simulation should produce an inspectable contract: the exact target, expected changes, affected parties, assumptions, confidence limits and recovery path. The user's approval should bind that contract, including the state on which it was computed. A changing system should invalidate approval rather than quietly broaden it.

Different actions need different models. Database mutations can often be rehearsed exactly on a copy. Deployments need load and failure scenarios. Messages and payments require explicit uncertainty about effects that cannot be recalled. An agent should identify that boundary instead of promising universal undo.

The critical layer comes after prediction. Runtime checks should compare observed effects with the approved envelope and stop, compensate or escalate when they diverge. A plausible preview without that feedback loop merely makes a dangerous action easier to approve.

The winning systems will combine useful models with small, enforceable authority. Their simulations will change decisions, their receipts will expose mistakes, and their recovery claims will stay narrower than their imagination.
