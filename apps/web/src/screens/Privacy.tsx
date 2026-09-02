/**
 * Privacy page — plain words about the minimal PII we hold and how to get
 * rid of it. Linked from the profile screen.
 */
import { Link } from "react-router-dom";
import { AppBar } from "../components/Chrome.js";

export function PrivacyScreen() {
  return (
    <main className="screen privacy">
      <AppBar title="Privacy" back />

      <div className="panel privacy-copy">
        <h2>What we store</h2>
        <p>
          As a <strong>guest</strong>: a random player id in a cookie, the display name you type,
          and the avatar you pick. No email, no tracking.
        </p>
        <p>
          If you <strong>sign in</strong> (Google or magic link): your email address and the display
          name and picture that come with it. That's the whole list — we don't collect anything
          else, and we never sell or share it.
        </p>

        <h2>Match records</h2>
        <p>
          Finished games are kept so your match history and stats work: who played, which stats were
          picked, and who won. Records are linked to your account only while it exists.
        </p>

        <h2>Cookies</h2>
        <p>
          One session cookie keeps you signed in (guest or account). There are no analytics or
          advertising cookies.
        </p>

        <h2>Deleting your data</h2>
        <p>
          <Link to="/profile">Delete your account</Link> any time. Your email and profile are
          removed immediately, and your name is scrubbed from past match records.
        </p>
      </div>

      <p className="hint">
        <Link to="/profile">← Back to profile</Link>
      </p>
    </main>
  );
}
