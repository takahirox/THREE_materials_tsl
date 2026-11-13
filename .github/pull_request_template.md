<!-- Write the title and body in English. Follow the development and review guidance:
https://github.com/takahirox/THREE_materials_tsl/blob/main/docs/development-flow.md
https://github.com/takahirox/THREE_materials_tsl/blob/main/docs/review-guidelines.md
-->

## Summary

Explain the problem and the focused changes made to address it.

## Outcome

Describe the resulting behavior, including before/after examples when useful.
State any intentionally incomplete scope.

## Validation

List the checks actually performed and their results, including failures.
Identify skipped or unperformed checks and explain why. Use checks appropriate to the
changed files and existing repository tooling; documentation-only changes do not require runtime suites.
Distinguish mandatory pre-merge acceptance from optional validation.

## Required post-merge verification

List required checks possible only after merge as pending, or state "None."
Do not claim deployment or publication succeeded based on pre-merge validation.
After merge and Issue closure, record evidence and track actual defects in linked
Issues under the [post-merge lifecycle](https://github.com/takahirox/THREE_materials_tsl/blob/main/docs/development-flow.md#6-perform-required-post-merge-verification).
Report unperformed or environment-blocked checks honestly; closure does not claim a pass.

## Related Issues

Link the source Issue and any related Issues. Use "Closes #..." only when this PR fully
addresses the source Issue's implementation and mandatory pre-merge acceptance.
Preserve that reference when only post-merge verification is pending. For intentional
partial work, state remaining scope and use a non-closing link to the parent Issue.
