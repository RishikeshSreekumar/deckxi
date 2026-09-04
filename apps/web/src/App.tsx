/**
 * Screen router. The URL only matters for entry (invite links); once in a
 * room, the server's room phase decides what you see. Results wait for the
 * reveal presenter to finish the final round — never spoil the climax.
 */
import { Suspense, lazy } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useStore } from "./store/store.js";
import { Landing } from "./screens/Landing.js";
import { Lobby } from "./screens/Lobby.js";
import { GameTable } from "./screens/GameTable.js";
import { Results } from "./screens/Results.js";
import {
  ConnectionBanner,
  FloatingReactions,
  InstallPrompt,
  MaintenanceBanner,
  Toasts,
  UpdatePrompt,
} from "./components/Chrome.js";

/**
 * Split out of the initial bundle (#107): none of these are on the path into
 * a game, and the gallery in particular drags the whole edition with it. What
 * stays eager is exactly what a player needs to land, join and play.
 */
const ProfileScreen = lazy(() =>
  import("./screens/Profile.js").then((m) => ({ default: m.ProfileScreen })),
);
const LeaderboardScreen = lazy(() =>
  import("./screens/Leaderboard.js").then((m) => ({ default: m.LeaderboardScreen })),
);
const HistoryScreen = lazy(() =>
  import("./screens/History.js").then((m) => ({ default: m.HistoryScreen })),
);
const PrivacyScreen = lazy(() =>
  import("./screens/Privacy.js").then((m) => ({ default: m.PrivacyScreen })),
);
const CreditsScreen = lazy(() =>
  import("./screens/Credits.js").then((m) => ({ default: m.CreditsScreen })),
);
const CardsGalleryScreen = lazy(() =>
  import("./screens/CardsGallery.js").then((m) => ({ default: m.CardsGalleryScreen })),
);
/** The draft board is only on the path into a Squad Draft room; trumps never pays for it. */
const SquadDraftTable = lazy(() =>
  import("./screens/SquadDraftTable.js").then((m) => ({ default: m.SquadDraftTable })),
);
const DeckScreen = lazy(() => import("./screens/Deck.js").then((m) => ({ default: m.DeckScreen })));
const ShareCardScreen = lazy(() =>
  import("./screens/ShareCard.js").then((m) => ({ default: m.ShareCardScreen })),
);
const AdminScreen = lazy(() =>
  import("./screens/Admin.js").then((m) => ({ default: m.AdminScreen })),
);
const AdminRoomScreen = lazy(() =>
  import("./screens/AdminRoom.js").then((m) => ({ default: m.AdminRoomScreen })),
);
const AdminReplayListScreen = lazy(() =>
  import("./screens/AdminReplay.js").then((m) => ({ default: m.AdminReplayListScreen })),
);
const AdminReplayScreen = lazy(() =>
  import("./screens/AdminReplay.js").then((m) => ({ default: m.AdminReplayScreen })),
);

function Screen() {
  const room = useStore((s) => s.room);
  const pendingReveals = useStore((s) => s.pendingReveals);
  const presenting = useStore((s) => s.presenting);

  if (room === null) {
    return (
      <Suspense fallback={<main className="screen" />}>
        <Routes>
          <Route path="/join/:code" element={<Landing />} />
          <Route path="/profile" element={<ProfileScreen />} />
          <Route path="/history" element={<HistoryScreen />} />
          <Route path="/leaderboard" element={<LeaderboardScreen />} />
          <Route path="/privacy" element={<PrivacyScreen />} />
          <Route path="/credits" element={<CreditsScreen />} />
          <Route path="/cards" element={<CardsGalleryScreen />} />
          <Route path="/deck" element={<DeckScreen />} />
          <Route path="/cards/share/:cardId" element={<ShareCardScreen />} />
          <Route path="/admin" element={<AdminScreen />} />
          <Route path="/admin/rooms/:roomId" element={<AdminRoomScreen />} />
          <Route path="/admin/replay" element={<AdminReplayListScreen />} />
          <Route path="/admin/replay/:matchId" element={<AdminReplayScreen />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </Suspense>
    );
  }
  if (room.phase === "lobby") return <Lobby room={room} />;
  if (room.phase === "results" && pendingReveals.length === 0 && !presenting) {
    return <Results room={room} />;
  }
  // Each mode ships its own table; the room's mode picks it (ADR 0001).
  if (room.settings.gameMode === "squad-draft") {
    return (
      <Suspense fallback={<main className="screen table-screen squad-screen" />}>
        <SquadDraftTable room={room} />
      </Suspense>
    );
  }
  return <GameTable room={room} />;
}

export function App() {
  return (
    <BrowserRouter>
      <MaintenanceBanner />
      <ConnectionBanner />
      <UpdatePrompt />
      <Screen />
      <FloatingReactions />
      <InstallPrompt />
      <Toasts />
    </BrowserRouter>
  );
}
