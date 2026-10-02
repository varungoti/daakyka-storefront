import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIRM_MESSAGE,
  installBackGuard,
  nextDirtySources,
  type BackGuardWindow,
} from "@/components/admin/unsaved-changes";

// F-184: the browser/phone Back button on a dirty admin form used to leave
// with no warning at all — `beforeunload` never fires for an App Router
// popstate soft-navigation. `installBackGuard` is the pure state machine
// behind the fix, extracted so it can be driven with a mocked `window`
// instead of a real DOM (this repo's unit tests run under Node's test
// runner with no jsdom — see product-view-tracker.test.ts for the same
// pattern).

function createMockWindow(initialHref = "https://admin.example/products/p1") {
  const state = { pushed: [] as unknown[], backCalls: 0, confirmCalls: [] as string[], confirmResult: true };
  let historyState: unknown = null;
  let listener: (() => void) | undefined;

  const win: BackGuardWindow = {
    history: {
      get state() {
        return historyState;
      },
      pushState: (data) => {
        historyState = data;
        state.pushed.push(data);
      },
      back: () => {
        state.backCalls++;
      },
    },
    location: { href: initialHref },
    confirm: (message) => {
      state.confirmCalls.push(message);
      return state.confirmResult;
    },
    addEventListener: (_type, cb) => {
      listener = cb;
    },
    removeEventListener: (_type, cb) => {
      if (listener === cb) listener = undefined;
    },
  };

  return {
    win,
    state,
    setConfirmResult: (value: boolean) => {
      state.confirmResult = value;
    },
    firePopState: () => listener?.(),
    hasListener: () => listener !== undefined,
  };
}

describe("installBackGuard", () => {
  it("pushes a sentinel history entry immediately on install", () => {
    const { win, state } = createMockWindow();
    installBackGuard(win);
    assert.equal(state.pushed.length, 1);
    assert.equal((state.pushed[0] as { __unsavedGuard: boolean }).__unsavedGuard, true);
  });

  it("preserves existing history.state keys (e.g. Next's __NA) when pushing the sentinel", () => {
    const { win, state } = createMockWindow();
    Object.defineProperty(win.history, "state", { value: { __NA: true, other: 1 }, configurable: true, writable: true });
    installBackGuard(win);
    const pushed = state.pushed[0] as Record<string, unknown>;
    assert.equal(pushed.__NA, true);
    assert.equal(pushed.other, 1);
    assert.equal(pushed.__unsavedGuard, true);
  });

  it("on a cancelled Back press, shows the standard confirm message and re-pushes the sentinel without navigating", () => {
    const mock = createMockWindow();
    mock.setConfirmResult(false);
    installBackGuard(mock.win);

    mock.firePopState();

    assert.deepEqual(mock.state.confirmCalls, [CONFIRM_MESSAGE]);
    assert.equal(mock.state.backCalls, 0);
    // One push on install, one more on cancel.
    assert.equal(mock.state.pushed.length, 2);
  });

  it("on a confirmed Back press, calls history.back() once to let the real navigation through", () => {
    const mock = createMockWindow();
    mock.setConfirmResult(true);
    installBackGuard(mock.win);

    mock.firePopState();

    assert.equal(mock.state.backCalls, 1);
  });

  it("does not re-confirm on a second popstate after the user already confirmed leaving", () => {
    const mock = createMockWindow();
    mock.setConfirmResult(true);
    installBackGuard(mock.win);

    mock.firePopState(); // confirmed — triggers the programmatic history.back()
    mock.firePopState(); // the resulting real popstate

    assert.equal(mock.state.confirmCalls.length, 1);
    assert.equal(mock.state.backCalls, 1);
  });

  it("allows repeated cancel -> Back cycles to each show the prompt again", () => {
    const mock = createMockWindow();
    mock.setConfirmResult(false);
    installBackGuard(mock.win);

    mock.firePopState();
    mock.firePopState();
    mock.firePopState();

    assert.equal(mock.state.confirmCalls.length, 3);
    assert.equal(mock.state.backCalls, 0);
  });

  it("cleanup removes the popstate listener", () => {
    const mock = createMockWindow();
    const cleanup = installBackGuard(mock.win);
    assert.equal(mock.hasListener(), true);
    cleanup();
    assert.equal(mock.hasListener(), false);
  });
});

// F-170: Site Controls renders four independent editors and Homepage two.
// With one shared boolean, the last editor to report "clean" erased another
// editor's "dirty" — so a page could hold unsaved edits while the guard
// believed it was clean. The page is dirty while *any* source is.
describe("nextDirtySources", () => {
  it("adds a source when it becomes dirty and removes it when it goes clean", () => {
    const dirty = nextDirtySources(new Set(), "announcement", true);
    assert.deepEqual([...dirty], ["announcement"]);
    assert.deepEqual([...nextDirtySources(dirty, "announcement", false)], []);
  });

  it("one editor going clean doesn't erase another's dirty flag", () => {
    let sources: ReadonlySet<string> = new Set();
    sources = nextDirtySources(sources, "announcement", true);
    sources = nextDirtySources(sources, "contact", true);
    sources = nextDirtySources(sources, "announcement", false); // announcement saved
    assert.equal(sources.size > 0, true, "contact still has unsaved edits");
    assert.deepEqual([...sources], ["contact"]);
    sources = nextDirtySources(sources, "contact", false);
    assert.equal(sources.size, 0);
  });

  it("returns the same set when nothing changes, so React can skip the re-render", () => {
    const sources = new Set(["contact"]);
    assert.equal(nextDirtySources(sources, "contact", true), sources);
    assert.equal(nextDirtySources(sources, "announcement", false), sources);
  });

  it("never mutates the set it was given", () => {
    const sources = new Set<string>();
    nextDirtySources(sources, "contact", true);
    assert.equal(sources.size, 0);
  });
});
