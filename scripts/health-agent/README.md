# scripts/health-agent/

# @formoria-script
# purpose: Health evaluators imported by the Railway health agent detectors and spend-watch; nothing here is run directly.
# class: shared
# invoke: not invoked directly; imported by src/lib/services/health-agent/detectors and scripts/spend-watch
# target: none
# safety: read-only
# owner: engineering

Library modules left after the GitHub Actions health agent was retired (PR #1168, DEV-1985). The Railway health agent (DEV-1748) imports these evaluators from `src/lib/services/health-agent/detectors/`.
