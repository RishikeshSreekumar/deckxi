/**
 * The last thing between a render-time throw and a blank white page.
 *
 * React unmounts the whole tree when a render throws, and a blank page is the
 * one failure a player can't work around or report usefully. This catches it,
 * says so plainly, offers the only two things that actually help (reload, or
 * go back to the landing page), and reports the error (#64).
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "../lib/errors.js";

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError({
      message: error.message,
      // The component stack says which screen broke — far more useful than
      // the minified JS stack on its own.
      stack: `${error.stack ?? ""}\n--- component stack ---${info.componentStack ?? ""}`,
      kind: "boundary",
    });
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="screen" data-testid="error-boundary">
        <div className="panel">
          <h2>Something broke.</h2>
          <p>
            That's on us — the error has been reported. Reloading usually gets you back into your
            game; the server holds your seat for a minute after a disconnect.
          </p>
          <div className="update-bar-actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => location.reload()}
            >
              Reload
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => {
                location.href = "/";
              }}
            >
              Back to start
            </button>
          </div>
        </div>
      </main>
    );
  }
}
