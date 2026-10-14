# Development Flow

The shared flow for THREE_materials_tsl contributors and AI agents is:
Issue → implementation → Pull Request → review → revision as needed → merge.
Perform post-merge verification only when the Issue requires it.

## Collaboration language

Use **English** for newly authored templates, development/review/merge documentation,
AI instructions, Issue and PR titles and bodies, review comments, and commit messages.
This collaboration-language convention does not require translating historical content
or changing product localization.

## Repository structure

The default branch is `main`. Keep shared collaboration guidance at repository level.
The root [README](../README.md) contains the extension specification; package-specific
setup and usage belong in the existing READMEs:

- [packages/demo](../packages/demo/README.md): NodeMaterial round-trip demo.
- [packages/exporter](../packages/exporter/README.md): GLTFExporter plugin.
- [packages/loader](../packages/loader/README.md): GLTFLoader plugin.

Consult the affected package's README and `package.json` before choosing commands.
There is no root package manifest or shared build/test framework. Do not add one as
part of routine contribution work or duplicate package documentation.

## 1. Start with an Issue

Use the [Issue template](../.github/ISSUE_TEMPLATE/issue.md) to capture the problem,
expected outcome, relevant context, reproduction steps where applicable, and concrete
completion criteria. An assignee or owner field is not required.

The source Issue defines scope. Clarify genuinely blocking ambiguity before dependent
implementation; proceed with independent work when possible. Choose the smallest change
that fully addresses the Issue, without inventing requirements.

Default to completion criteria an AI agent can execute and verify. Require human
confirmation, physical-device testing, subjective evaluation, or external approval only
when necessary for the actual Issue. Explain why it is needed and what result is expected.

Keep these categories separate:

- **Pre-merge acceptance:** mandatory criteria achievable and verifiable before merge.
- **Optional validation:** useful additional checks that are not approval conditions.
- **Required post-merge verification:** genuinely necessary checks possible only after
  merge; state "None" when none are required instead of routinely adding such work.

Post-merge checks must not be pre-merge approval conditions. For example, when a merge
triggers demo deployment, applicable code/configuration checks and local builds belong
before merge; verification of publication and the newly published site belongs after merge.
This distinction preserves implementation requirements and applicable pre-merge tests.

## 2. Implement and Create a Pull Request

Implement within the source Issue's scope and follow existing package conventions.
Use the [PR template](../.github/pull_request_template.md) to explain the problem,
resulting behavior, focused changes, related Issues, and validation actually performed.
Use a concise English commit message describing what changed and why, referencing the Issue.
Target `main` unless the Issue or workflow selects another base branch.

Choose checks appropriate to the changed files and actual repository tooling:

- For templates/documentation only, check Markdown structure, template front matter,
  links, whitespace (`git diff --check`), and consistency with the Issue and related guidance.
  Use available lint/parse tools when applicable. No new runtime tests, hardware/device
  checks, or deployed-site verification are required for such a change.
- For code changes, inspect the affected package's scripts and run relevant available
  checks. Each package currently provides `npm run build` in its own directory; there
  is no repository-wide test script. Do not invent commands or require unrelated suites.

Report passing and failing checks, skipped checks, and unperformed checks accurately,
with reasons where needed. Keep pre-merge results separate from pending post-merge work.
Claim to close an Issue only when its implementation and mandatory pre-merge acceptance
are fully addressed. Describe intentional partial work clearly and leave the Issue open.
Pending post-merge verification does not make an otherwise complete implementation partial.

## 3. Review Before Merge

Apply the [review guidelines](review-guidelines.md). Verify completeness against the
source Issue, correctness, appropriate scope, and sufficient validation. Avoid unrelated
refactoring, speculative frameworks, and unnecessary complexity.

## 4. Revise or Wait as Needed

For agent-fixable findings, update the PR and review the updated changes again.
When necessary human input is missing, record the specific question, why it blocks
progress, and the expected answer. Use the workflow's wait path and resume after the
answer arrives; do not repeatedly request code fixes for that unresolved question.

## 5. Merge

Approve and merge when the implementation is sufficient, mandatory pre-merge checks
pass, and no blocking review findings or necessary human questions remain. Follow the
repository's configured merge rules and the active workflow's authorization; a stage
limited to implementation must leave merging to the designated merge stage.

## 6. Perform Required Post-Merge Verification

If required, perform the separately recorded post-merge checks. Report them as pending
until performed, then record actual results, failures, and necessary follow-up.
Pre-merge validation does not prove deployment or publication succeeded.
