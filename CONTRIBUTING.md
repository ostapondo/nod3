# Contributing

Thank you for opening this file. Genuinely.

nod3 is a small tool with one job: help people notice that they go quiet for four minutes
in the middle of an algorithm interview, and get better at not doing that. It can only get
that job right if people who have actually sat at that table — on either side of it — tell
it where it is wrong.

**Every kind of help is welcome here, and code is the smallest part of it.**

## The most valuable thing you can give this project is your experience

The measurements are the easy part. A waveform can tell you that someone was silent for
224 seconds. It cannot tell you whether that silence would have cost them the offer, or
whether the interviewer had already stopped listening two minutes earlier. That knowledge
only lives in people who have been in the room.

### If you have interviewed candidates

You know things this repo cannot derive from an audio file:

- What actually moves a hire / no-hire decision, and what interviewers claim matters but
  quietly do not care about.
- Where the rubric here is too generous, too harsh, or measuring the wrong thing.
- What you would have said in the debrief, in your own words, for a session like the one
  in the report.
- The follow-up questions you escalate to when a candidate finishes early.

Open an [Interview experience](https://github.com/ostapondo/nod3/issues/new?template=interview_experience.md)
issue and just write it out. Prose is fine. No formatting required, no PR needed. If you would
rather not do it in public, that is completely understandable — say so in a one-line issue
and we will find another way.

### If you have recently been interviewed

You are the other half of this. Useful things to tell us:

- What surprised you compared to what this tool told you to expect.
- Which problem patterns you actually got, and which ones the bank is missing.
- Where the debrief flattered you, or beat you up for something no real interviewer
  mentioned.

### If you just used it once

That is enough to contribute. "The report said my talk ratio was 40% but I felt like I
never stopped talking" is a real, actionable bug report, and it is exactly the kind of
thing that gets fixed here.

## Ways to help that need no code at all

| Contribution              | What it looks like                                                              |
| ------------------------- | ------------------------------------------------------------------------------- |
| Interview experience      | An issue describing what real interviewers notice and this tool does not        |
| A problem worth adding    | The problem statement and why it teaches something the bank does not yet cover  |
| A metric that lied to you | What the report said versus what actually happened in your session              |
| Setup that did not work   | Your OS, what you ran, what broke — see below, this is our bug, not yours       |
| Docs that confused you    | The sentence that lost you. If a sentence needed re-reading, it needs rewriting |
| A rubric disagreement     | "This verdict is wrong for this session, and here is why"                       |

## Ground rules, so nobody wastes an afternoon

- **No question here is too basic.** If something in this README or codebase is unclear,
  that is a defect in the project, not in you. Ask.
- **A vague issue still beats a silent one.** If you cannot reproduce it, cannot attach
  logs, or only half remember what happened — open it anyway and say so.
- **Draft PRs are welcome.** You do not need it working before you show it. Opening early
  saves you from building something in a direction the project cannot take.
- **We will not argue about formatting.** Prettier and ESLint decide, they run on commit,
  and nobody will review your indentation.
- **English does not have to be your first language.** Nobody will comment on your grammar
  in an issue or a commit message. Write in whatever gets the idea across.
- **Never attach session audio.** It is your voice, and it is never needed to debug
  anything. `metrics.json` and `speech.json` are plenty.
- **This is maintained in spare time.** Expect a few days for a reply, occasionally
  longer. If a week passes with no answer, please ping the thread — silence here means the
  notification got lost, never that your contribution was rejected.

## Your first change

If you want to write code but do not know where to start, open an issue saying roughly
what interests you and you will get pointed at something the right size. Otherwise, the
two lowest-friction starting points are a new problem in the bank, and rewriting whichever
paragraph of the README or this file made you re-read it.

Nothing here needs to be perfect on the first try. Every PR gets a review, and a review
that asks for changes is not a rejection — it is the normal path.

## Getting set up

```bash
npm install
brew install whisper-cpp ffmpeg     # Linux: apt install ffmpeg, build whisper.cpp
npm run setup:model
npm run doctor        # tells you exactly what is missing, if anything
npm run dev
```

If any of that fails, **please open an issue instead of fighting it**. Setup instructions
that only work on the maintainer's laptop are the single most common way a project loses
contributors, and we would rather fix the docs than have you spend an evening on it.

## What is in scope

Good contributions:

- **New problems.** The bank is small on purpose but wants more patterns.
- **Better metrics.** Anything measurable from the two tracks that tells you something an
  interviewer would notice.
- **Accuracy fixes.** If a number the report shows is wrong or misleading, that is the
  highest-value bug in this repo.
- **Speed.** Transcription dominates the wait.
- **Rubric and persona quality.** Backed by how real interviews actually go.

Out of scope, deliberately — and if you disagree with any of these, that is worth an issue
rather than a silent fork:

- Behavioural or system-design rounds. Other tools do this well; this one stays on
  algorithms.
- Anything that phones home, or any hosted mode.
- Features that help you _pass_ an interview rather than _get better_ at them.

## Adding a problem

1. Add an entry to `apps/server/src/data/problems.json`. Fill in every field —
   `ambiguities`, `pitfalls` and `followUps` are not decoration, they are fed to the
   interviewer persona and change the quality of the debrief.
2. Add a reference implementation to `scripts/verify-problems.py` under the same `entry`
   name.
3. Run `npm run test:problems`. It re-derives every `expected` value from your reference
   and fails on any disagreement.

That check exists because two wrong answers shipped in the first draft of the bank,
including one problem with two valid solutions where the statement promised exactly one.
A trainer that teaches the wrong answer is worse than no trainer.

Aim for a mix: at least one non-obvious hidden case per problem, and a note saying what it
catches.

If you have a problem in mind but do not want to write the JSON and the Python reference,
open an issue with just the statement and the reasoning. Someone will wire it up, and you
will still be credited for it.

## Changing metrics

`apps/server/src/lib/metrics.ts` is the core of the product. Everything there is
deterministic and unit-tested — no model involved.

If you change it, add a case to `apps/server/src/lib/metrics.test.ts` that would have
failed before your change. Metrics are the one thing users are asked to trust.

## Tests

```bash
npm test              # unit + problem bank
npm run test:e2e      # Playwright; boots server and web for real
```

E2E specs run the report page off a fixture session (`e2e/seed.ts`) so they do not need a
microphone, a whisper model, or model access. If you change the shape the pipeline writes
to disk, update that fixture — it is the only place the two can drift apart silently.

If a test fails and you cannot tell whether it is your change or a pre-existing flake, say
so in the PR. Nobody will hold it against you.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), enforced by commitlint:

```
feat(metrics): flag silent stretches with no typing separately
fix(stt): measure speech from the waveform, not whisper segment ends
docs: explain the analysis engine options
```

Allowed scopes: `server`, `web`, `metrics`, `stt`, `analysis`, `problems`, `runner`, `ci`,
`deps`, `docs`.

Hooks: `pre-commit` runs lint-staged, `commit-msg` runs commitlint, `pre-push` runs
typecheck and tests.

If commitlint rejects your message and the fix is not obvious, push anyway with
`--no-verify` and mention it — the message can be rewritten at merge time. It is not worth
losing a contribution over a prefix.

## What happens after you open a PR

1. CI runs typecheck, lint, unit tests, the problem-bank verification and Playwright.
2. You get a review. Expect questions rather than demands; if something is asked for and
   you disagree, say so — you may well be right.
3. Merged changes go into `CHANGELOG.md` under `[Unreleased]`, with credit.

## Releasing

`version.env` is the source of truth.

```bash
# edit VERSION in version.env
npm run version:sync
# update CHANGELOG.md under a new heading
git commit -am "chore(release): v0.2.0"
git tag v0.2.0
```

CI fails if `version.env` and the `package.json` files disagree.

## Code of conduct

Short version: be decent to people. The long version is in
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
