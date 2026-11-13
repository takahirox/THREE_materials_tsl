# Review and Merge Guidelines

Use these guidelines for contributor and AI reviews, together with the
[development flow](development-flow.md) and its
[English collaboration-language convention](development-flow.md#collaboration-language).

## Review Against the Issue

Read the source Issue, PR description, full diff, and reported validation results.
Treat the Issue's problem, expected outcome, and mandatory pre-merge acceptance as the
reference. Check each requirement against the implementation and evidence.
Do not approve a PR as closing an Issue when required implementation is missing.
Intentional partial work must identify remaining scope and must not automatically
close the parent Issue. Pending post-merge-only verification does not make an
otherwise complete implementation partial.

## Check Scope and Correctness

Verify that the implementation is correct, coherent with the existing package structure,
and produces the expected outcome. Check that affected documentation is accurate.
Preserve useful existing instructions and avoid duplicating package READMEs.

Review applicable interface changes against the [UI/UX principles](../README.md#uiux).

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

Apply the [test and CI performance principles](development-flow.md#test-and-ci-performance-principles).
For new or expanded checks, assess additional defect coverage, overlap with existing
coverage, and added execution and maintenance cost.

> Does this change provide sufficient confidence with the lightest appropriate
> validation, without redundant execution?

Keep optional validation separate from approval conditions. Human confirmation,
physical-device testing, subjective evaluation, and external approval are mandatory
only when necessary for the actual Issue, with a reason and expected result.

Checks possible only after merge must not block pre-merge approval. Record genuinely
required post-merge verification separately as pending, or state "None."
For a merge-triggered deployment, applicable local builds and code/configuration checks
belong before merge; publication and published-site verification belong after merge.
Pre-merge evidence does not prove deployment or publication succeeded. This distinction
does not waive implementation requirements or applicable pre-merge tests.

Preserve the normal `Closes #N` reference when implementation and mandatory pre-merge
acceptance are complete. Do not request removing it, keeping the source Issue open,
or withholding approval solely because post-merge-only checks are pending.
ProjectWeave publication adds this reference and its merge/close stages close the
Issue; requesting revisions to undo that lifecycle creates repeated Review → Fix → Publish
→ Review rounds. Missing implementation, mandatory pre-merge tests, required protections,
and genuinely necessary pre-merge human acceptance remain blockers.

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

Close the fully implemented original Issue after successful merge, then follow the
[post-merge lifecycle](development-flow.md#6-perform-required-post-merge-verification)
for required checks, evidence in the merged PR, closed Issue, or linked report, and
actual defects tracked in new or existing equivalent linked Issues. Do not reopen
the original Issue solely for this follow-up.

Keep pending, unperformed, or environment-blocked checks explicit; closure does not
claim a pass, and an unavailable environment alone does not establish a product defect.
Do not describe publication or deployment as successful without evidence. Apply the
current lifecycle over older keep-open instructions while preserving historical results.
