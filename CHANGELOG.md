# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The authoritative version lives in `version.env`; `npm run version:sync` propagates it.

## [Unreleased]

## [0.1.0] - 2026-08-10

First working version.

### Added

- **Interview room** — problem statement, Monaco editor with autocomplete disabled,
  microphone recording, live level meter, session clock against a per-problem budget,
  and a passive nudge after 20 seconds of silence.
- **Local speech capture** — audio is recorded in the browser and transcribed on your
  machine with whisper.cpp. Nothing is uploaded.
- **Two-track timeline** — speech and keystrokes rendered on a single clock, with
  silent-coding stretches banded in, test runs marked, and findings pinned to the
  moment they refer to. Scrubbing replays what you were saying at that instant.
- **Deterministic metrics** — talk ratio, planning window, silent coding, longest
  silence, edit churn, paste count and test-run history, all computed in code rather
  than inferred by a model.
- **Interviewer debrief** — a Google-style algorithms rubric across seven dimensions,
  a hire/no-hire verdict, and timestamped findings. Runs through the `claude` CLI by
  default (no API key), with Anthropic API and Ollama as alternatives.
- **Problem bank** — ten pattern-diverse problems with hidden test cases, documented
  ambiguities, known pitfalls and interviewer follow-ups. Every expected answer is
  verified in CI against a reference solution.
- **Local test runner** for Python and JavaScript submissions, tolerant of both
  `snake_case` and `camelCase` entry points.
- `npm run doctor` — checks ffmpeg, whisper.cpp, the model, Python and the analysis
  engine, and prints the exact fix for whatever is missing.

- **Six languages** — Python, JavaScript, TypeScript, Java, C++ and Go, the set Google
  allows. TypeScript rides the JavaScript harness: Node erases the annotations, so there
  is no compiler to install; `enum` and `namespace` are refused with an explanation
  rather than a stack trace.
  Java, C++ and Go harnesses are generated from a type signature declared per
  problem, so the test data is baked into the generated source rather than parsed
  by a hand-written JSON reader in three languages. Stubs are generated too, using
  the parameter names from the Python signature.
- Toolchain detection: the language picker greys out what is not installed and
  shows the command that would fix it. Detection runs each compiler rather than
  checking for the file, because macOS ships a `javac` stub that fails without a
  JDK.
- `./scripts/start.sh` and a double-clickable `nod3.command`: preflight,
  dependency install, model download, conditional rebuild, boot, and a shutdown
  that verifies the ports were released instead of assuming it.
- **First-run language choice**, kept in `data/settings.json` and changeable from the
  header. Stored server-side rather than in localStorage: a cleared browser profile, a
  different browser or another machine on the network all keep the setting, which is the
  same promise the rest of your data makes.
- `scripts/format-problems.py` keeps the problem bank readable when hand-edited.

- **Live updates over a WebSocket** at `/ws`. The pipeline pushes each stage as it starts,
  finishes or fails, with the detail that matters — audio size, how much speech was
  measured, the test tally, the verdict — instead of the UI asking "which stage?" every
  two seconds. HTTP stays for requests and uploads, and polling remains as a fallback if
  the socket cannot connect.
- **The UI now says when the backend is gone.** A connection badge on every screen and a
  banner during a session. An application-level heartbeat plus a client watchdog catch a
  link that died without closing — a socket in that state still reports OPEN, so the old
  UI would have kept claiming everything was fine.
- The processing screen distinguishes done, running, failed and pending steps, joins them
  with a rail, and replays anything that finished before the page connected.

- **Contributor docs aimed at people with real interview experience.** `CONTRIBUTING.md`
  now leads with the kinds of help that need no code at all, plus a `CODE_OF_CONDUCT.md`
  and issue templates for interview experience, problem suggestions and setup trouble.

### Changed

- **Renamed the project to `nod3`.** Packages are `@nod3/server` and `@nod3/web`, the
  launcher is `nod3.command`, and the data directory override is now `NOD3_DATA`
  (previously `ALGOLOOP_DATA` — update it if you set it in your shell). The generated C++
  namespace and Go module changed with it; no session data on disk is affected.

- The seed problem bank is now a deliberate six — three easy, two medium, one hard —
  chosen so that between them they still exercise every type in the signature
  vocabulary, keeping the Java, C++ and Go code generators covered by tests.

- **The Node floor is now 22.13**, up from 20. The TypeScript harness runs on
  `module.stripTypeScriptTypes`, which arrived in 22.13 — the README had been promising
  a version the app could not actually deliver six languages on. CI moved with it; Node
  20 is out of support anyway.

### Fixed

- **A microphone was required to sit a problem at all.** Denying the permission — or
  having no mic, or simply being somewhere you cannot talk out loud — left the Begin
  button doing nothing, under a message that claimed the session worked without audio.
  The server had always degraded to a code-only report; only the browser refused. The
  briefing now offers "Begin without audio" up front, a failed permission turns into that
  offer instead of a dead end, and the room says "audio off" rather than showing a
  recording indicator over a dead meter.
- TypeScript was reported as always available, on the reasoning that the Node running the
  server is the whole toolchain. On a Node without type stripping that turned into
  `module.stripTypeScriptTypes is not a function` presented to the candidate as a compile
  error in their own code. Availability is now probed like every other language, and the
  harness names the real problem if it is reached anyway.
- `verify-problems.py` opened the problem bank through an absolute path from the machine
  it was written on, so the check that guarantees no wrong `expected` ever ships could
  only run there. It resolves the path from its own location now.
- The unit test glob was quoted, so it reached `node --test` as a literal path on any Node
  that does not expand globs itself, and CI reported "Could not find" instead of running
  38 tests. `find` locates them now.
- Selecting an interview language gave no feedback and, if the write failed, silently
  reappeared later asking again. The card now lights up immediately, the choice is only
  treated as made once the server confirms it, and a failed write says so.
- The settings unit test wrote to the real `data/settings.json`, so running the suite
  while the app was open reset the user's chosen language. The directory is now an
  explicit argument.
- `.gitignore` only covered `.env` and `.env*.local`, leaving `.env.production` and
  friends committable — the one genuinely dangerous thing this repo can leak.

- A rebuild while a tab was open left a bare "Application error" screen. Stale
  chunk loads are now detected and the page reloads itself once.
- **The problem bank was gitignored.** An unanchored `data/` rule also matched
  `apps/server/src/data/`, so `problems.json` — the content the whole app runs on — was
  never going to be committed, and CI's reference-solution check would have failed on a
  missing file. The rule is now anchored to the repo root.

### Notes

- Speech timing is measured from the waveform via ffmpeg silence detection rather than
  from whisper's segment boundaries, which stretch across pauses and would report a
  mostly-silent session as mostly-talking.

[Unreleased]: https://github.com/ostapondo/nod3/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ostapondo/nod3/releases/tag/v0.1.0
