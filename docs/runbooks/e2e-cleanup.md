# Staging E2E cleanup runbook

Every invocation is serialized at the workflow level while Playwright keeps
its safe intra-suite workers. Global setup sweeps old namespaces; global
teardown deletes this run's brands/submissions/newsletter/preferences,
namespaced Auth captures, temporary signup users, and test storage paths owned
by journeys. It then audits the namespace and fails the run if any residue or
delete error remains.

If teardown fails, do not rerun against another environment. Inspect the
service-role error, remove only namespaced staging rows/objects, and rerun the
staging workflow. Never use a production service role as a cleanup shortcut.
