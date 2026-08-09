<div align="center">

# nod3

**Practise algorithm interviews out loud. Then see exactly what you said — and what you were typing while you said it.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/ostapondo/nod3/actions/workflows/ci.yml/badge.svg)](https://github.com/ostapondo/nod3/actions/workflows/ci.yml)
[![Local first](https://img.shields.io/badge/data-never%20leaves%20your%20machine-6ee787.svg)](#privacy)
[![Contributions welcome](https://img.shields.io/badge/contributions-welcome%20%E2%80%94%20code%20optional-ff8ab7.svg)](#contributing)

**New here? [Start with CONTRIBUTING.md](CONTRIBUTING.md) — the thing this project needs most is not code,
it is what real interviews taught you.**

</div>

---

## Why this exists

Most people fail algorithm interviews for a reason that has nothing to do with algorithms:
they go quiet for four minutes while implementing, and the interviewer has no idea whether
they know what they are doing.

You cannot see yourself doing that. A recording alone will not show it either, because
you have to watch the whole thing back to find the gaps.

nod3 records two things and puts them on **one clock**: what you said, and what you
typed. Then it shows you the places where one was happening without the other.

```
[00:12] SAID    Since it's sorted I can use two pointers instead of a hash map
[00:23] SILENT  coded for 224s without saying anything (+270 −50 chars)
[04:10] SAID    Time is O of n and space is constant
```

That middle line is the product.

## What a session looks like

1. Pick a problem. The clock starts when you begin. The microphone is what the speech half
   of the report is made of, but you can also begin without audio — on a machine with no
   mic, or somewhere you cannot talk — and still get the code, the timings and the tests.
2. Talk through it exactly as you would with an interviewer. The editor has autocomplete
   turned off — an interviewer's shared doc does not have it either.
3. Run the tests when you have something worth checking. Some cases are hidden.
4. Hit Finish. Your speech is transcribed locally, aligned against every edit, and handed
   to an interviewer persona that writes you up against a Google-style rubric.

The report gives you a verdict, seven scored dimensions, and findings pinned to the second
they happened — click one and the timeline jumps there.

## What it measures

These come from the recording, not from a model's impression of it:

| Metric              | What it tells you                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Silent coding**   | Time spent typing with nothing said. The single most common reason a correct candidate gets downgraded.             |
| **Planning window** | Gap between your first word and your first keystroke. Negative means you started typing before you had an approach. |
| **Talk ratio**      | Share of the session you were actually speaking, measured from the waveform.                                        |
| **Longest silence** | The worst single gap, and when it started.                                                                          |
| **Churn**           | Characters deleted over characters written. Above ~0.6 usually means a wrong path taken and rewritten.              |
| **Test runs**       | How many, and how long before the first one.                                                                        |

The model reads these as facts and argues from them. It does not invent them.

## Languages

The six Google lets you interview in:

| Language   | Needs                    | Notes                                     |
| ---------- | ------------------------ | ----------------------------------------- |
| Python     | `python3`                | Ships with macOS                          |
| JavaScript | nothing                  | Runs on the Node that serves the app      |
| TypeScript | nothing                  | Node erases the annotations — no compiler |
| Java       | `brew install openjdk`   | LeetCode-style `class Solution`           |
| C++        | `xcode-select --install` | C++17, common headers preincluded         |
| Go         | `brew install go`        | Your own import block, tab-indented       |

On first run the app asks which one you interview in, and remembers. Change it
any time from the header. Install only the ones you plan to use — the rest are
greyed out with the command that would fix them; `npm run doctor` reports the same.

TypeScript is worth calling out: types are stripped at run time rather than
compiled, so annotations cost nothing and there is nothing to install. `enum`
and `namespace` need real code generation and are refused with an explanation.

Python and JavaScript stubs are written per problem; Java, C++ and Go stubs are
generated from the problem's declared type signature, so a new problem does not
mean hand-writing five variants:

```java
public int[][] mergeIntervals(int[][] intervals) {
```

```go
func mergeIntervals(intervals [][]int) [][]int {
```

## Install

Requires macOS or Linux, Node 22.13+ — that is where the type stripping the TypeScript
harness runs on landed — and about 500 MB for the speech model.

```bash
git clone https://github.com/ostapondo/nod3.git
cd nod3
npm install

# Speech recognition, running entirely on your machine
brew install whisper-cpp ffmpeg      # Linux: apt install ffmpeg, build whisper.cpp
npm run setup:model                  # downloads ggml-small.bin (~488 MB)

npm run doctor                       # verifies every dependency, tells you how to fix gaps
./scripts/start.sh                   # or double-click nod3.command in Finder
```

`start.sh` checks the toolchains, installs what npm needs, downloads the model on
first run, builds if anything changed, boots both processes and opens the browser.
Ctrl-C stops everything and verifies the ports were actually released.

`npm run doctor` is worth running first. It checks ffmpeg, whisper.cpp, the model, Python
and the analysis engine, and prints the exact command to fix anything missing.

## The write-up engine

The debrief needs a capable model. Three ways to provide one:

| `ANALYSIS_ENGINE`         | Requires                            | Notes                                                                |
| ------------------------- | ----------------------------------- | -------------------------------------------------------------------- |
| `claude-code` _(default)_ | the `claude` CLI, already signed in | No API key. Uses the subscription you have.                          |
| `anthropic`               | `ANTHROPIC_API_KEY`                 | Direct Messages API.                                                 |
| `ollama`                  | a running Ollama server             | Fully offline, including the write-up. Quality depends on the model. |

```bash
ANALYSIS_ENGINE=ollama OLLAMA_MODEL=qwen2.5-coder:14b npm run dev
```

## Privacy

Audio, transcripts, code and reports are written to `data/sessions/<id>/` in this repo,
and your preferences to `data/settings.json`. Nothing is kept in browser storage, so a
cleared profile or a different browser loses nothing. `data/` is gitignored.

Speech recognition is fully local — whisper.cpp on your CPU/GPU, no network call.

The one thing that leaves your machine is the debrief prompt, and only when
`ANALYSIS_ENGINE` is `claude-code` or `anthropic`. That prompt contains the problem, your
transcript, your code and the measurements — but no audio. Set `ANALYSIS_ENGINE=ollama`
to keep even that local.

## Configuration

Every option is an environment variable with a working default.

| Variable          | Default                 | Purpose                                                                                   |
| ----------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| `PORT`            | `4000`                  | API port                                                                                  |
| `NOD3_DATA`       | `./data`                | Where sessions are stored                                                                 |
| `WHISPER_BIN`     | `whisper-cli`           | whisper.cpp binary                                                                        |
| `WHISPER_MODEL`   | `models/ggml-small.bin` | Speech model. `ggml-base.bin` is ~3× faster and noticeably worse at technical vocabulary. |
| `WHISPER_LANG`    | `en`                    | `auto` to detect                                                                          |
| `ANALYSIS_ENGINE` | `claude-code`           | `claude-code` · `anthropic` · `ollama`                                                    |
| `ANALYSIS_MODEL`  | `sonnet`                | Model for the debrief                                                                     |
| `PYTHON_BIN`      | `python3`               | Interpreter for Python submissions                                                        |

## Adding problems

The seed bank is six problems — three easy, two medium, one hard — kept deliberately
small and chosen so that between them they use every type the Java, C++ and Go code
generators have to handle. Problems live in
[`apps/server/src/data/problems.json`](apps/server/src/data/problems.json).
Add an entry, then add a reference solution to
[`scripts/verify-problems.py`](scripts/verify-problems.py) — CI re-derives every expected
answer from it and fails if any disagree. A problem bank with a wrong answer in it teaches
the wrong thing, so this check is not optional.

Each problem carries the ambiguities a strong candidate should raise, the known pitfalls,
and the follow-ups an interviewer escalates to. All three feed the debrief.

## Architecture

```
apps/web      Next.js 15 · React 19 · Tailwind 4 · Monaco
apps/server   Express · WebSocket · whisper.cpp · local test runner
data/         your sessions and settings (gitignored)
```

The browser holds a WebSocket to `/ws` on the API port. The pipeline pushes each step as
it happens, so the review screen shows real progress rather than a spinner, and the
connection badge tells you the moment the local server stops answering — a dead backend
used to be invisible until the session ended. HTTP still serves requests and uploads, and
the UI falls back to polling if the socket cannot be established.

The pipeline after you hit Finish:

```
audio.webm ──ffmpeg──▶ 16 kHz wav ──┬──▶ silencedetect ──▶ measured speech intervals
                                    └──▶ whisper.cpp   ──▶ timestamped transcript
                                                              │
events.jsonl (keystroke deltas, runs, pastes) ────────────────┤
                                                              ▼
                                              metrics + one merged narrative
                                                              │
                                                              ▼
                                                    interviewer debrief
```

Speech timing is measured from the waveform rather than taken from whisper's segment
boundaries. Those boundaries stretch across pauses — early on they reported a recording
that was 45% silence as 69% talking, which would have made the headline metric a lie.

## Development

```bash
./scripts/start.sh   # one command: check, build, boot, open
npm run dev          # server + web with hot reload
npm test             # unit tests, language runners, problem-bank verification
npm run test:e2e     # Playwright, boots the real stack
npm run typecheck
npm run lint
npm run doctor
```

Commits are checked by commitlint ([Conventional Commits](https://www.conventionalcommits.org/)),
staged files by lint-staged, and `git push` runs typecheck and tests. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## Contributing

Contributions of every kind are welcome here, and most of the ones this project needs are
not code.

**If you have ever interviewed someone, or been interviewed recently, you know things this
tool cannot work out on its own.** A waveform can prove that someone was silent for 224
seconds. It cannot say whether that silence cost them the offer, or whether the
interviewer had already stopped listening. That only lives in people who were in the room
— and the rubric, the debrief persona and the problem bank all get better the moment
someone writes it down.

You do not need to open a pull request for any of this:

| If you…                               | Do this                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| have interviewed candidates           | [Interview experience](https://github.com/ostapondo/nod3/issues/new?template=interview_experience.md) — prose is perfect |
| interviewed somewhere recently        | Same template. What surprised you, versus what this tool told you to expect                                              |
| saw a number that felt wrong          | [Wrong measurement](https://github.com/ostapondo/nod3/issues/new?template=wrong_measurement.md)                          |
| know a problem the bank should have   | [Suggest a problem](https://github.com/ostapondo/nod3/issues/new?template=new_problem.md) — no JSON required             |
| could not get it running              | [It would not start](https://github.com/ostapondo/nod3/issues/new?template=setup_trouble.md) — that is our bug           |
| got lost in a paragraph of these docs | Open an issue with the sentence. If it needed re-reading, it needs rewriting                                             |
| want to write code                    | [CONTRIBUTING.md](CONTRIBUTING.md), or an issue saying what interests you                                                |

No question here is too basic, draft PRs are welcome, nobody will comment on your English,
and a review asking for changes is the normal path rather than a rejection. Full details,
including what is deliberately out of scope, are in [CONTRIBUTING.md](CONTRIBUTING.md);
how we treat each other is in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

One thing to hold onto: **never attach session audio to an issue.** It is your voice, and
it is never needed to debug anything.

## Limitations

- **Transcription is not instant.** Roughly a third of session length on Apple Silicon, so
  a 35-minute session takes about 10 minutes to process.
- **No live interviewer.** The session is a silent recording by design; there is nobody
  interrupting you with follow-ups yet.
- **Not a substitute for mock interviews with humans.** It cannot reproduce the stress of a
  real person watching. It is for volume — twenty reps a week of talking while you think.

## License

MIT © [ostapondo](https://github.com/ostapondo)
