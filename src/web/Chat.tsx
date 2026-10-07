import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { MAX_QUESTION_CHARS } from "../core/chat";
import type { ItemState } from "../worker/agents/item";
import type { Actions } from "./App";

const SUGGESTIONS = {
  listings: ["Which listing has the best warranty?", "Is the cheapest one a good deal?", "What do reviews say about it?"],
  candidates: ["What's the difference between these models?", "Which suits my priorities best?"],
};

/** Follow-up questions about what the search found. */
export function Chat({ state, actions }: { state: ItemState; actions: Actions }) {
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  const hasListings = state.products.some((p) => p.groups);
  const busy = state.chatBusy || sending;
  const searching = state.status === "running";
  const turns = state.chat;

  // Keep the newest turn in view inside the panel without jumping the page.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [turns.length, state.chatBusy]);

  if (!hasListings && !state.candidates?.length) return null;

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setNotice(null);
    setSending(true);
    const error = await actions.ask(question);
    setSending(false);
    if (error) setNotice(error);
    else setDraft("");
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void send(draft);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(draft);
    }
  }

  const suggestions = hasListings ? SUGGESTIONS.listings : SUGGESTIONS.candidates;

  return (
    <section className="chat" aria-labelledby="chat-title">
      <header className="chat-head">
        <h2 id="chat-title">Ask about these products</h2>
        <p className="quiet">
          Answers come from what the search found first. If that doesn't say, it can look up to 3 things on the web, from
          today's search budget.
        </p>
      </header>

      {(turns.length > 0 || state.chatBusy) && (
        <ol className="chat-turns" ref={listRef} aria-live="polite">
          {turns.map((t, i) => (
            <li key={i} className={`turn turn-${t.role}${t.failed ? " turn-failed" : ""}`}>
              <span className="turn-who">{t.role === "user" ? "You" : "SameSame"}</span>
              <p className="turn-text">{t.text}</p>
              {t.sources && t.sources.length > 0 && (
                <ul className="turn-sources" aria-label="Sources">
                  {t.sources.map((s) => (
                    <li key={s.url}>
                      <a href={s.url} target="_blank" rel="noopener noreferrer nofollow">
                        {s.label}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          {state.chatBusy && (
            <li className="turn turn-assistant turn-pending">
              <span className="turn-who">SameSame</span>
              <p className="turn-text">
                <i aria-hidden="true" />
                Looking into it…
              </p>
            </li>
          )}
        </ol>
      )}

      {turns.length === 0 && !busy && (
        <div className="chat-suggestions">
          {suggestions.map((s) => (
            <button key={s} type="button" className="chip" disabled={searching} onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <form className="chat-form" onSubmit={submit}>
        <label className="sr-only" htmlFor="chat-question">
          Your question
        </label>
        <textarea
          id="chat-question"
          rows={2}
          value={draft}
          maxLength={MAX_QUESTION_CHARS}
          placeholder={searching ? "You can ask once the search finishes" : "Ask about price, warranty, returns, reviews…"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={searching}
        />
        <button type="submit" disabled={busy || searching || !draft.trim()}>
          {busy ? "Answering…" : "Ask"}
        </button>
      </form>
      {notice && (
        <p className="warn" role="alert">
          {notice}
        </p>
      )}
    </section>
  );
}
