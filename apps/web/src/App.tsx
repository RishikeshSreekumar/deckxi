/**
 * Screen router. The URL only matters for entry (invite links); once in a
 * room, the server's room phase decides what you see. Results wait for the
 * reveal presenter to finish the final round — never spoil the climax.
 */
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useStore } from "./store/store.js";
import { Landing } from "./screens/Landing.js";
import { Lobby } from "./screens/Lobby.js";
import { GameTable } from "./screens/GameTable.js";
import { Results } from "./screens/Results.js";
import { ProfileScreen } from "./screens/Profile.js";
import { HistoryScreen } from "./screens/History.js";
import { PrivacyScreen } from "./screens/Privacy.js";
import { CardsGalleryScreen } from "./screens/CardsGallery.js";
import { ShareCardScreen } from "./screens/ShareCard.js";
import { ConnectionBanner, FloatingReactions, Toasts } from "./components/Chrome.js";

function Screen() {
  const room = useStore((s) => s.room);
  const pendingReveals = useStore((s) => s.pendingReveals);
  const presenting = useStore((s) => s.presenting);

  if (room === null) {
    return (
      <Routes>
        <Route path="/join/:code" element={<Landing />} />
        <Route path="/profile" element={<ProfileScreen />} />
        <Route path="/history" element={<HistoryScreen />} />
        <Route path="/privacy" element={<PrivacyScreen />} />
        <Route path="/cards" element={<CardsGalleryScreen />} />
        <Route path="/cards/share/:cardId" element={<ShareCardScreen />} />
        <Route path="*" element={<Landing />} />
      </Routes>
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
      <Screen />
      <FloatingReactions />
      <Toasts />
    </BrowserRouter>
  );
}
