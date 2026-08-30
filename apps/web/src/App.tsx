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
const HistoryScreen = lazy(() =>
  import("./screens/History.js").then((m) => ({ default: m.HistoryScreen })),
);
const PrivacyScreen = lazy(() =>
  import("./screens/Privacy.js").then((m) => ({ default: m.PrivacyScreen })),
);
const CardsGalleryScreen = lazy(() =>
  import("./screens/CardsGallery.js").then((m) => ({ default: m.CardsGalleryScreen })),
);
const ShareCardScreen = lazy(() =>
  import("./screens/ShareCard.js").then((m) => ({ default: m.ShareCardScreen })),
);
const AdminScreen = lazy(() =>
  import("./screens/Admin.js").then((m) => ({ default: m.AdminScreen })),
);
const AdminRoomScreen = lazy(() =>
  import("./screens/AdminRoom.js").then((m) => ({ default: m.AdminRoomScreen })),
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
          <Route path="/privacy" element={<PrivacyScreen />} />
          <Route path="/cards" element={<CardsGalleryScreen />} />
          <Route path="/cards/share/:cardId" element={<ShareCardScreen />} />
          <Route path="/admin" element={<AdminScreen />} />
          <Route path="/admin/rooms/:roomId" element={<AdminRoomScreen />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </Suspense>
    );
  }
  if (room.phase === "lobby") return <Lobby room={room} />;
  if (room.phase === "results" && pendingReveals.length === 0 && !presenting) {
    return <Results room={room} />;
  }
  return <GameTable room={room} />;
}

export function App() {
  return (
    <BrowserRouter>
      <ConnectionBanner />
      <UpdatePrompt />
      <Screen />
      <FloatingReactions />
      <InstallPrompt />
      <Toasts />
    </BrowserRouter>
  );
}
