/**
 * Game picker: a card per registered game, so switching which season is
 * loaded is a deliberate screen rather than a dropdown buried in the Play
 * toolbar. Reads nothing but `GameEntry`, so a third registered game needs no
 * change here.
 */

import type { GameEntry } from '../../core/game/registry.js';

interface Props {
  readonly games: readonly GameEntry[];
  readonly selectedGameId: string;
  readonly onSelect: (gameId: string) => void;
}

export function GameMenu({ games, selectedGameId, onSelect }: Props) {
  return (
    <div className="game-menu">
      <h2>Choose a game</h2>
      <p className="muted small">Solo driver practice against a real, physically simulated field.</p>
      <div className="game-menu-grid">
        {games.map((entry) => {
          const isCurrent = entry.definition.id === selectedGameId;
          return (
            <button
              type="button"
              key={entry.definition.id}
              className={`game-card ${isCurrent ? 'is-current' : ''}`}
              onClick={() => onSelect(entry.definition.id)}
            >
              <span className="game-card-name">{entry.definition.name}</span>
              <span className="game-card-season">{entry.definition.season}</span>
              <span className="game-card-meta">
                {entry.definition.pieces.length} piece type{entry.definition.pieces.length === 1 ? '' : 's'} ·{' '}
                {entry.definition.rules.length} scoring rules
              </span>
              <span className="game-card-action">{isCurrent ? 'Currently loaded' : 'Play this game'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
