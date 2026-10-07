# Golden set (riskiest-bet test)

Hand-labelled Singapore listings, one file per product. **Drafted by Claude in the
style of real SG marketplace titles. Replace or confirm them against live listings.**

Each listing has:
- `expect.match`: what the model-number path must decide (`same`, `variant`,
  `different`, `needs_llm`). Checked by `test/golden.test.ts`.
- `expect.truth`: the human answer, including for `needs_llm` listings
  (`same`, `variant`, `different`, `uncertain`). Used to score the LLM matcher.
- `expect.price`, `expect.currency`, `expect.condition`, `expect.warranty`,
  `expect.isBundle`: what the detectors and price parser must produce.
