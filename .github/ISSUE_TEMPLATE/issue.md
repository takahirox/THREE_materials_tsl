---
name: Issue
about: Report a problem or propose a change
title: ""
labels: ""
---

<!-- Write the title and body in English. Remove prompts that do not apply. -->

## Problem

Describe the problem and who or what it affects.

## Expected outcome

Describe what should be true when the Issue is resolved.

## Context and reproduction

Add relevant context, affected packages, examples, logs, or related Issues.
For a reproducible problem, include steps, actual and expected results, and relevant versions.

## Pre-merge acceptance

List concrete mandatory criteria that can be achieved and verified before merge.
Default to criteria an AI agent can execute and verify. Require human confirmation,
physical-device testing, subjective evaluation, or external approval only when necessary;
explain why and the expected result. Do not require an assignee or owner.

Checks possible only after merge must not be prerequisites for pre-merge approval.
See the [development guidance](https://github.com/takahirox/THREE_materials_tsl/blob/main/docs/development-flow.md#1-start-with-an-issue).

## Optional validation

List useful additional checks separately from mandatory acceptance, or state "None."

## Required post-merge verification

Record only genuinely necessary checks that can be performed only after merge, or state "None."
For a merge-triggered deployment, publication and published-site verification belong here.
Keep these checks pending until performed; pre-merge validation does not prove publication succeeded.
See the [review guidance](https://github.com/takahirox/THREE_materials_tsl/blob/main/docs/review-guidelines.md#check-pre-merge-acceptance-and-post-merge-verification).
