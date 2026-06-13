---
name: house-style
description: Apply the author's cross-language coding conventions and judgment when writing or substantially changing code — new features, modules, refactors, or non-trivial functions in any language. Skip for one-line fixes, pure formatting, and config tweaks. Covers abstraction, errors, naming, comments, types, dependencies, testing, and working method.
---

# House Style

How I write code, in any language. These are defaults with teeth, not laws — override one only with a reason you could say out loud.

Three through-lines:

- **Boring at the edges, clever only in the core.** The dumbest code that works wins. A reader at 2am is the customer.
- **Easy-to-follow threads.** Someone who didn't build the app should be able to start at an entry point and trace how a behavior works without spelunking. Straight call paths over indirection and magic; the next reader is an outsider.
- **Minimal LOC is a health signal.** Fewer lines is less to read, less to break, and — in the agentic era — less context an AI must load to change it safely. Lines that say more beat lines that say less. (Not code golf: clarity still outranks a saved line.)

## Working method

- **Surgical diff.** Touch only what the task needs. No drive-by refactors, no reformatting unrelated lines, no opportunistic renames. The diff should be reviewable as one idea.
- **Flag the rest, don't fix it.** When you spot adjacent smells, list them separately for me to greenlight — don't fold them into the change.
- **Ask before proceeding on ambiguity.** When intent is unclear or a decision is missing, stop and ask. Do not invent requirements or guess at a fork and barrel ahead. A wrong turn taken confidently costs more than a question. (Trivial, reversible defaults — variable names, file placement — just decide and note.)
- **No unprompted scope growth.** If the task reveals a bigger problem, surface it; don't quietly solve it.

## Abstraction & duplication

- **Abstract on the second use** — but with judgment, not reflex:
  - **Obvious abstraction up front:** if the shared concept is clear from the first write, factor it now.
  - **Likely to diverge:** if the two uses are the *same shape today* but answer to *different reasons*, leave them duplicated. Premature coupling is worse than duplication — you'll pay to tear it apart later.
- The test is **"same concept"**, not "same lines". Two code blocks that look identical but change for different reasons are not duplication.
- No abstraction towers. An indirection has to pay for the reader's jump.

## Errors & boundaries

- **Strict at the edges, trusting in the core.** Validate hard where data enters the system — user input, network, deserialization, public API surface. Inside that boundary, assume data is valid and let it throw if it isn't.
- **Handle in one place; throw everywhere else.** Errors bubble up to a single central handler per entry point/layer. Intermediate code throws expressive errors rather than catching and swallowing inline. No scattered try/catch hiding failures.
- **Fail loud and verbose.** Say exactly what went wrong and attach as much detail as you can — the message should make the cause obvious without reaching for a debugger. A swallowed exception is a future debugging session.
- **The consumer always gets a clear error.** Whoever called — user, client, caller — receives an explicit, accurate account of what failed. Over HTTP that means correct, standard status codes; never `200` with an error in the body.
- **Don't proliferate error types — but mint one when nothing existing lets you fail loudly and specifically.** A type earns its existence by carrying meaning a caller acts on.
- Don't guard inputs that a boundary already guaranteed — it's noise that implies the invariant isn't real.

## Naming & comments

- **Descriptive, not verbose.** Names reveal intent and are as long as needed, no longer. No Hungarian notation, no cryptic abbreviations. `Manager`/`Helper`/`Util` are fine when the thing genuinely *is* one — but never as filler to dodge naming the real concept. Logical and clear beats clever or padded.
- **Near-zero comments.** Code shows *what*; names and structure carry meaning. A comment is usually an apology for code that should be clearer — refactor instead.
- The surviving comments explain **why**: a non-obvious constraint, a rejected alternative, a "this looks wrong but isn't" landmine. Never narrate the *what*.

## Types & data

- **Strict and explicit** where the language supports it. Strong types at boundaries, immutable data by default.
- **Make invalid states unrepresentable.** Model the domain so the type system rejects nonsense — prefer a sum type over a bag of booleans, a parsed value over a re-validated string.
- No `any`, no loosely-typed dicts passed across module lines. Don't fight the type checker; if it's screaming, the model is probably wrong.

## Control flow & function shape

- **Guard clauses, flat.** Handle edge cases and early exits first; keep the happy path at the lowest indentation. Avoid deep nesting.
- **Cohesion over fragmentation.** A longer function that tells one coherent story beats shattering it into tiny single-caller helpers that scatter the logic. Extract only when a chunk is *independently meaningful* — has a name worth giving and could stand alone.
- Both at once: flat *and* whole.

## Paradigm

- **Fit the situation, don't commit to a camp.** Use whatever paradigm best serves the problem — OOP where state genuinely needs encapsulating, functional where data-in/data-out is clearer, procedural where flat is fine. **Simple but effective** is the goal; no style is the identity.
- No ceremony for its own sake: no class that's really a function, no interface with one implementation, no pattern applied because it has a name.

## Dependencies

- **Vanilla-first.** Reach for the stdlib and hand-rolled code until the pain is real. Every dependency is a standing liability — supply chain, churn, version conflicts, bloat.
- Pull one in **deliberately**: for a genuinely hard, solved problem (crypto, parsing, dates) where hand-rolling is a mistake. Weigh blast radius — a deep core dependency demands more scrutiny than a leaf utility.

## Testing

- **Risk-weighted.** Heavy tests on complex or critical logic; light or none on glue code and throwaway prototypes. Coverage percentage is not the goal.
- Test **behavior at meaningful seams**, not implementation detail. Skip trivial getters and over-mocked unit tests that only assert the code is shaped the way it's shaped.
- A test that can't fail for a real reason is worse than no test — it's false confidence plus maintenance cost.

## Git & commits

- **Conventional Commits**, imperative subject: `feat:`, `fix:`, `chore:`, `refactor:`, etc.
- **One commit = one logical change** that builds and passes on its own. Exception: heavier features that need a test or deploy-and-verify step may land as a checkpoint-sized commit.
- **Subject-only by default.** The conventional subject carries most commits. Add a body only when the *why* or a rejected alternative isn't obvious from the diff — same rule as comments.
- **Feature branch off main, cleaned before merge.** Tidy the branch locally so it reads as a coherent sequence, then merge. Never force-push a shared branch.
- **PR description: minimal — let the diff talk.** A tight what / why / how-to-verify when it helps the reviewer; no boilerplate template ceremony.
