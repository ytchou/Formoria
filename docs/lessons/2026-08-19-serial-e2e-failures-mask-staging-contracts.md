# Serial E2E failures can mask shared staging contracts

## Symptom

A focused canonical-staging rerun reported one newsletter unsubscribe failure, then marked the following newsletter and email unsubscribe cases as not run. The same rerun also failed after assuming that selecting an online channel hid both physical-location controls.

## Cause

The API cases run serially, so the first incorrect `200` expectation stopped the remaining cases before they could reveal that every route in the shared staging mutation-path set returns the same `403` lockdown response. Separately, live UI behavior was generalized from one disappearing field to another field that remained visible.

## Prevention

When an environment guard covers a shared route set, sweep the complete set before repairing the first observed failure and represent the common policy once. For dynamic forms, assert every conditional control independently from runtime evidence instead of inferring that related fields share visibility.

## How to apply

After any serial-suite failure, inventory the downstream cases that did not run and check whether they share the failing contract. For staging-locked GET mutations, keep one environment-aware assertion for the exact `403` JSON while preserving each non-staging status and body contract. For dependent form controls, record and assert each control's observed state before interacting with it.
