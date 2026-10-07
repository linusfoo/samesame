import { useEffect, useState, type FormEvent } from "react";
import type { ItemState } from "../worker/agents/item";
import type { Mode } from "../core/request";
import type { Actions } from "./App";

const COPY: Record<Mode, { label: string; placeholder: string; description: string; button: string }> = {
  model: {
    label: "Product",
    placeholder: "Sony WH-1000XM6 headphones",
    description: "Black, over-ear",
    button: "Find listings",
  },
  category: {
    label: "What kind of product",
    placeholder: "27-inch 4K monitor",
    description: "For photo editing, USB-C would be nice",
    button: "Suggest models",
  },
};

export function Ask({ state, actions }: { state: ItemState | null; actions: Actions }) {
  const [mode, setMode] = useState<Mode>(state?.input?.mode ?? "model");
  const [notice, setNotice] = useState<string | null>(null);
  const running = state?.status === "running";
  const copy = COPY[mode];

  // Follow the saved search when the page reconnects.
  useEffect(() => {
    if (state?.input?.mode) setMode(state.input.mode);
  }, [state?.input?.mode]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setNotice(null);
    setNotice(
      await actions.start({
        mode,
        query: String(form.get("query") ?? ""),
        description: String(form.get("description") ?? ""),
        priorities: String(form.get("priorities") ?? ""),
      }),
    );
  }

  return (
    <form className="ask" onSubmit={submit}>
      <fieldset className="mode">
        <legend className="sr-only">What do you know so far?</legend>
        <label>
          <input type="radio" name="mode" value="model" checked={mode === "model"} onChange={() => setMode("model")} />
          <span>I know the model</span>
        </label>
        <label>
          <input type="radio" name="mode" value="category" checked={mode === "category"} onChange={() => setMode("category")} />
          <span>I only know the kind of product</span>
        </label>
      </fieldset>

      <div className="ask-main">
        <label className="field field-query">
          <span>{copy.label}</span>
          <input
            name="query"
            required
            autoComplete="off"
            placeholder={copy.placeholder}
            defaultValue={state?.input?.mode === mode ? state.input.query : ""}
            key={`q-${mode}-${state?.input?.query ?? ""}`}
          />
        </label>
        <button type="submit" disabled={running}>
          {running ? "Searching…" : copy.button}
        </button>
      </div>

      <div className="ask-more">
        <label className="field">
          <span>Description</span>
          <input
            name="description"
            autoComplete="off"
            placeholder={copy.description}
            defaultValue={state?.input?.description}
            key={`d-${state?.input?.description ?? ""}`}
          />
        </label>
        <label className="field">
          <span>What matters to you</span>
          <input
            name="priorities"
            autoComplete="off"
            placeholder="Local warranty, under S$500"
            defaultValue={state?.input?.priorities}
            key={`p-${state?.input?.priorities ?? ""}`}
          />
        </label>
      </div>
      <p className="hint">
        {mode === "model"
          ? "Naming a storage or screen size (512GB, 27-inch) means other sizes are shown but don't count."
          : "You'll get a few models to pick from, then up to two are compared across shops."}
      </p>
      {notice && (
        <p className="warn" role="alert">
          {notice}
        </p>
      )}
    </form>
  );
}
