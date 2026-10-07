# Golden set (riskiest-bet test)

Hand-labelled Singapore listings, one file per product. **Everything here is still
drafted by Claude in the style of real SG marketplace titles, with placeholder URLs.
Story 1 is not done until you replace it with real listings you captured and labelled.**

## Capturing real listings (about 30, across the six products)
1. For each product, search Shopee, Lazada, Amazon.sg, Courts, Challenger and others.
2. For each listing, copy the title exactly, the price as shown (`priceText`, e.g.
   `"S$1,299.00"` or `"S$629.00 S$529.00"` for a struck-through pair), the URL and the shop.
3. Include awkward ones on purpose: other colours and sizes, bundles, refurbished,
   export/parallel-import sets, sibling models, titles with no model number.
4. Label each listing (below) by your own judgement, not by what the code says.

Each listing has:
- `expect.match`: what the model-number path must decide (`same`, `variant`,
  `different`, `needs_llm`). Checked by `test/golden.test.ts`.
- `expect.truth`: the human answer, including for `needs_llm` listings
  (`same`, `variant`, `different`, `uncertain`). Used to score the LLM matcher.
- `expect.price`, `expect.currency`, `expect.condition`, `expect.warranty`,
  `expect.isBundle`: what the detectors and price parser must produce.
- `expect.comparable`: whether it counts toward the verdict (CLAUDE.md, "Comparable").
  `needs_llm` listings are `false` here because the LLM hasn't decided yet.

## Category case (`category/`)
One file per category search: the shopper's input and a list of models labelled
`inCategory: true | false` (with a `note` saying why not). Label every model the
candidate agent might propose; an unlabelled proposal fails the test until you label it.

## Recording and scoring the LLM
`npm run test:live` (needs `OPENCODE_API_KEY` in `.dev.vars`; the category case also
uses Firecrawl searches) writes `llm/<file>.json`: three matcher runs per product and
one candidate run per category case. `npm test` then scores them in
`test/golden-llm.test.ts`:
- no false merges in any of the three runs (matching something that isn't the same
  product, or rejecting the same product as "different");
- a same-product listing left "unconfirmed" still passes;
- every proposed category candidate is labelled in-category.

Re-record whenever the listings, the matcher prompt or the model change.
