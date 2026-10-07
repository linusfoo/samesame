import type { MouseEvent } from "react";
import type { ItemState } from "../worker/agents/item";
import { Hero3D } from "./Hero3D";

/** Shops the agents know to look at; a hint, not a limit (see the brief). */
const SHOPS = ["Shopee", "Lazada", "Amazon.sg", "Qoo10", "Courts", "Challenger", "Harvey Norman", "Best Denki"];

/** Sample listings for the illustrations. Not live data. */
const SAMPLE = [
  { shop: "shopee.sg", price: 429, local: true, x: 0 },
  { shop: "lazada.sg", price: 445, local: false, x: 0.32 },
  { shop: "challenger.sg", price: 469, local: true, x: 0.8 },
  { shop: "dell.com/sg", price: 479, local: true, x: 1 },
];

type Props = { state: ItemState | null; go: (path: string) => void };

export function Landing({ state, go }: Props) {
  const open = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    go("/search");
  };
  const saved = state && state.status !== "idle" ? state.input?.query : null;

  return (
    <>
      <header className="masthead masthead-landing">
        <div className="masthead-copy">
          <h1>
            <span>Same same.</span> <span>Different price.</span>
          </h1>
          <p>
            Tell SameSame what you want to buy. Its agents check Singapore shops, work out which listings are truly the
            same item, and line every price up on one rail, so you're not spending an evening in twelve tabs.
          </p>
          <div className="cta-row">
            <a className="cta" href="/search" onClick={open}>
              {saved ? "Back to your search" : "Start a search"}
            </a>
            <a className="cta-quiet" href="#how">
              How it works
            </a>
          </div>
          {saved && <p className="saved">Last search: {saved}</p>}
        </div>
        <Hero3D busy={false} />
      </header>

      <section className="pitch" aria-labelledby="pitch-title">
        <h2 id="pitch-title">The same monitor is on eight sites at eight prices.</h2>
        <p>
          Some are export sets. One is a bundle. Two are a different model with nearly the same name. Working that out by
          hand takes anywhere from an hour to a weekend, and sometimes you give up and buy nothing.
        </p>
        <div className="marquee" aria-hidden="true">
          <div className="marquee-track">
            {[...SHOPS, ...SHOPS].map((s, i) => (
              <span key={i}>{s}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="how" id="how" aria-labelledby="how-title">
        <h2 id="how-title">How a search runs</h2>
        <ol className="steps">
          <li className="step-card">
            <span className="step-n">1</span>
            <h3>Say what you want</h3>
            <p>Name the model, or just the kind of product and what matters to you. For a kind of product you get a few models to pick from first.</p>
            <div className="demo-ask" aria-hidden="true">
              <span>27-inch 4K monitor</span>
              <i />
            </div>
          </li>
          <li className="step-card">
            <span className="step-n">2</span>
            <h3>Agents find and match listings</h3>
            <p>Same model number means the same item. Other colours and sizes are kept apart, and anything unclear is marked unconfirmed, never quietly merged.</p>
            <ul className="demo-groups" aria-hidden="true">
              <li className="is-same">Same item <b>4</b></li>
              <li className="is-variant">Other colours and sizes <b>2</b></li>
              <li className="is-unsure">Not confirmed <b>1</b></li>
            </ul>
          </li>
          <li className="step-card">
            <span className="step-n">3</span>
            <h3>See every price on one rail</h3>
            <p>Only comparable listings count. Warranty and condition sit on every tag, and you can ask follow-up questions about what was found.</p>
            <div className="demo-rail" aria-hidden="true">
              {SAMPLE.map((l, i) => (
                <span
                  key={l.shop}
                  className={`demo-tag tag${l.local ? " is-local" : ""}`}
                  style={{ left: `calc(${l.x} * (100% - 64px))`, top: i % 2 ? 46 : 14, animationDelay: `${i * 90}ms` }}
                >
                  S${l.price}
                </span>
              ))}
            </div>
          </li>
        </ol>
      </section>

      <section className="rules" aria-labelledby="rules-title">
        <h2 id="rules-title">What it won't do</h2>
        <ul>
          <li>
            <strong>Add a bundle to a plain listing.</strong> Bundles, refurbished and display units are shown, but they
            don't count toward the comparison.
          </li>
          <li>
            <strong>Hide the fine print.</strong> Shipping and vouchers sit next to the base price so you can weigh them
            yourself.
          </li>
          <li>
            <strong>Guess when it isn't sure.</strong> A listing with no model number is matched by name, with how sure it
            is and why.
          </li>
        </ul>
      </section>

      <section className="closer">
        <h2>What are you buying next?</h2>
        <a className="cta" href="/search" onClick={open}>
          {saved ? "Back to your search" : "Start a search"}
        </a>
        <p>Singapore shops only. Prices in SGD.</p>
      </section>
    </>
  );
}
