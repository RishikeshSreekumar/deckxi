/**
 * Editions on the client (#143). The default one is in the bundle; a second
 * edition is fetched the moment a screen names it, so a WWE room costs the
 * cricket lobby nothing.
 *
 * `getEdition` stays synchronous — every card render calls it — so this hook
 * is the piece that re-renders the screen once the fetch lands.
 */
import { useEffect, useState } from "react";
import { ensureEdition, getEdition, knownEditionIds, subscribeEditions } from "@deckxi/ui";
import type { Edition } from "@deckxi/shared";

/** The edition, loading it if this build has it but has not loaded it yet. */
export function useEdition(editionId: string): Edition | null {
  const [edition, setEdition] = useState<Edition | null>(() => getEdition(editionId));

  useEffect(() => {
    setEdition(getEdition(editionId));
    const unsubscribe = subscribeEditions(() => setEdition(getEdition(editionId)));
    void ensureEdition(editionId).then((loaded) => setEdition(loaded));
    return unsubscribe;
  }, [editionId]);

  return edition;
}

/**
 * Every edition this build can play, loaded. The lobby's edition picker needs
 * each one's name and the modes it supports before a host chooses it, so this
 * is the one place that pulls them all in.
 */
export function useAllEditions(): Edition[] {
  const [, bump] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeEditions(() => bump((n) => n + 1));
    for (const id of knownEditionIds()) void ensureEdition(id);
    return unsubscribe;
  }, []);

  return knownEditionIds()
    .map((id) => getEdition(id))
    .filter((edition): edition is Edition => edition !== null);
}
