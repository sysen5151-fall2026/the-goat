# Chapter 3 Product Build Evidence

## Scope

This record identifies the actual Chapter 3 product-build baseline in this
repository. It distinguishes the intentionally red acceptance-test suite from
implemented product behavior.

## Committed Artifacts

Commit `c95d78252756dc4926a0100dd4bfe8cb5c1ac8f5` on branch
`chapter-3-specification-and-acceptance` adds:

- `SPEC.md`: SN.1-SN.6 traceability, acceptance criteria, data contract, and
  proposed model response contract.
- `tests/test_spec_acceptance.py`: one named, intentionally failing acceptance
  test for each stakeholder need.
- `.github/workflows/spec-acceptance.yml`: a GitHub Actions workflow that runs
  the acceptance suite on every push and pull request.

## Executed Result

Command:

```bash
python -m unittest discover -s tests -p "test_*.py" -v
```

Local execution on 2026-10-03 produced six failures, one for each of SN.1
through SN.6. Every failure message begins `Not implemented`; no dependency,
syntax, or test-discovery error was observed.

GitHub Actions run:

`https://github.com/sysen5151-fall2026/the-goat/actions/runs/37170579204`

The run failed after executing the same intentionally red suite. This is the
expected Chapter 3 state. It does not establish that a Wayly product feature
works or that any acceptance criterion has passed.

## Before a Test Turns Green

The team must approve the open contract decisions in `SPEC.md`, replace the
placeholder failures with fixture-based checks, implement the corresponding
behavior, and retain the resulting test output. A reviewer other than the
generator should review the pull request before merging it into `main`.
