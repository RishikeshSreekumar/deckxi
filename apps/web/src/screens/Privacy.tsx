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

        <h2>Voice chat</h2>
        <p>
          Voice is peer to peer. Your audio goes straight to the other players at the table and
          never through our servers, so there is nothing for us to record and nothing we could hand
          over. It is off until you turn it on, only offered in private rooms opened by an invite,
          and whenever a mic is live every seat at the table shows it.
        </p>
        <p>
          The flip side of not carrying the audio is that we cannot act on a report about what
          someone said — we did not hear it. You can mute a player on your own device, and the host
          can remove them from the table.
        </p>
        <p>
          On some networks a direct connection is impossible, and the audio is bounced through a
          relay server to get through. The relay passes encrypted media along without being able to
          read it; it sees that two players are talking, not what they say.
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

        <h2>Credits</h2>
        <p>
          The cards are built from open cricket data and freely licensed photographs —{" "}
          <Link to="/credits">who made what</Link>.
        </p>
      </div>

      <p className="hint">
        <Link to="/profile">← Back to profile</Link>
      </p>
    </main>
  );
}
