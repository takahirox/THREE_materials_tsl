# Review and Merge Guidelines

Use these guidelines for contributor and AI reviews, together with the
[development flow](development-flow.md) and its
[English collaboration-language convention](development-flow.md#collaboration-language).

## Review Against the Issue

Read the source Issue, PR description, full diff, and reported validation results.
Treat the Issue's problem, expected outcome, and mandatory pre-merge acceptance as the
reference. Check each requirement against the implementation and evidence.
Do not approve a PR as closing an Issue when required implementation is missing.
Intentional partial work must be identified and the Issue must remain open.

## Check Scope and Correctness

Verify that the implementation is correct, coherent with the existing package structure,
and produces the expected outcome. Check that affected documentation is accurate.
Preserve useful existing instructions and avoid duplicating package READMEs.

Reject unjustified scope: unrelated refactoring, speculative extensibility, unnecessary
abstractions, frameworks, policies, or configuration. Prefer the smallest change that
fully solves the Issue. Extra complexity is not evidence of completeness.

## Check Pre-Merge Acceptance and Post-Merge Verification

Require mandatory pre-merge criteria to be achievable and verifiable before merge and
check evidence that they pass. Validation must fit the changed files and available
tooling. Check reported commands, results, failures, skipped checks, and unperformed
checks; do not infer a pass from silence or require nonexistent commands.

For a templates/documentation-only change, review Markdown/template syntax, links,
whitespace, and consistency. Do not require new runtime tests, hardware/device checks,
or deployed-site verification. For code changes, assess relevant checks in the affected
packages using their existing scripts and documentation.

Keep optional validation separate from approval conditions. Human confirmation,
physical-device testing, subjective evaluation, and external approval are mandatory
only when necessary for the actual Issue, with a reason and expected result.

Checks possible only after merge must not block pre-merge approval. Record genuinely
required post-merge verification separately as pending, or state "None."
For a merge-triggered deployment, applicable local builds and code/configuration checks
belong before merge; publication and published-site verification belong after merge.
Pre-merge evidence does not prove deployment or publication succeeded. This distinction
does not waive implementation requirements or applicable pre-merge tests.

## Choose the Review Outcome

Clearly distinguish these outcomes so the workflow can take the appropriate next step:

- **Agent-fixable findings — request changes:** identify the specific missing requirement,
  correctness problem, unnecessary scope, or validation gap, explain its impact, and
  state the expected correction. Review the updated PR again after revision.
- **Necessary human input — wait:** record the exact question, why the answer is necessary,
  and what result is expected. Enter the workflow's wait path and resume review when the
  answer arrives. Do not repeatedly send the PR for code fixes to obtain human input.
  If agent-fixable findings also exist, report them separately so independent fixes can proceed.
- **Ready — approve and merge:** the implementation fully addresses the claimed Issue scope,
  is correct, has no unjustified scope, passes mandatory pre-merge checks, and has no
  blocking findings or unresolved necessary human input. Required post-merge checks
  are recorded separately as pending; their pending state does not prevent approval.

Keep nonblocking suggestions clearly optional. Follow configured repository merge rules
and the active workflow's authorization when merging; leave merge actions to the
designated stage when the current stage permits only implementation or review.

## Report Post-Merge Results

When required, verify the recorded post-merge work after merge. Keep it pending until
performed, and record actual results, including failures and necessary follow-up.
Do not describe publication or deployment as successful without that evidence.
