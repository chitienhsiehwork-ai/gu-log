# tribunal-verification-scope Specification

## Purpose

定義 Fact Checker 對所有文章類型一律執行驗證的範圍契約，禁止以「看似沒有可查證主張」為由走 claim-free fast path。

## Requirements

### Requirement: Fact Checker verification SHALL be unconditional across post types

The Fact Checker stage SHALL run for every post in tribunal scope and SHALL score its `accuracy` dimension for every such post, regardless of whether the post makes verifiable technical, numeric, or factual claims. A post's claim density (including a pure-opinion / reflection / mind-set post with no verifiable claim) SHALL NOT gate whether the Fact Checker stage runs, whether `accuracy` is scored, or whether any other Fact Checker dimension is scored.

No mechanism — CLI flag, frontmatter field, or judge-side "claim-free" classification — SHALL exist whose effect is to skip fact verification, or to exempt the `accuracy` dimension from being earned, for a class of posts.

Tribunal scope SHALL be decided by the post's `status`. A post with `status: taken-down` has no article body left and SHALL be excluded from the whole tribunal before any judge runs: no judge score is written and no rewrite is attempted (see `post-takedown`). This scope exclusion SHALL NOT be implemented as, or used to justify, skipping the Fact Checker or exempting `accuracy` for any post that is not taken down.

This requirement deliberately ratifies the status quo. It exists so that a future change proposing to make verification conditional (e.g. "skip the Fact Checker on mind-set posts", "give claim-free posts an accuracy fast-path") MUST delta this requirement and confront the recorded analysis before proceeding. The rationale, the rejected `claim-free fast-path` alternative, the three-reviewer analysis, and the conditions under which revisiting is warranted are preserved in `openspec/changes/archive/2026-07-16-reject-claim-free-factcheck-fastpath/design.md`.

#### Scenario: Claim-free reflection post is still fully verified

- **WHEN** a post that makes no verifiable technical/numeric claim (a translated reflection / mind-set essay) is scored
- **THEN** the Fact Checker stage SHALL run to completion
- **AND** `accuracy` SHALL be scored for it like any other post
- **AND** `fidelity`, `sourceBoundary`, and `commentarySeparation` SHALL be scored as well

#### Scenario: No post class bypasses fact verification

- **WHEN** any runtime (CCC `Agent`, shell `tribunal.sh`, Codex on VM) runs the tribunal on a post
- **THEN** there SHALL be no flag, frontmatter field, or classification whose effect is to skip the Fact Checker stage or exempt `accuracy` from being scored based on the post's type or claim density

#### Scenario: A future conditional-verification proposal must delta this requirement

- **WHEN** a future change proposes to skip the Fact Checker, or to exempt `accuracy` from being earned, for a class of posts
- **THEN** that change SHALL modify or remove this requirement in its spec delta
- **AND** SHALL document why the harmless→harmful trade and the de-claiming incentive recorded in the referenced design.md no longer apply

#### Scenario: Taken-down post is outside tribunal scope

- **WHEN** tribunal candidate selection meets a post with `status: taken-down`
- **THEN** it SHALL exclude the post before any judge runs
- **AND** no Fact Checker or other judge score SHALL be written for it
- **AND** the exclusion SHALL be decided by `status` alone, never by claim density or a judge-side classification
