/**
 * Robot preset management (PRODUCT_SPEC.md §9).
 *
 * Create, save, load, edit, duplicate, rename, delete, plus file export/import
 * for sharing a design with a teammate. Storage is IndexedDB, so presets
 * survive a reload.
 *
 * Records that fail to load are listed separately rather than hidden: a user
 * whose preset broke deserves to know which one and why, and one bad row must
 * not cost them the rest of their robots.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RobotConfig } from '../../core/robot/robotConfig.js';
import {
  exportPreset,
  importPreset,
  presetFilename,
  type BrokenPreset,
  type PresetRepository,
  type StoredPreset,
} from '../../storage/presets.js';

interface Props {
  readonly repository: PresetRepository;
  /** The configuration currently applied to the simulation. */
  readonly current: RobotConfig;
  readonly onLoad: (config: RobotConfig) => void;
}

/** Stable unique id for a new preset. */
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `robot-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function formatSaved(iso: string): string {
  if (iso === 'unknown') return 'unknown';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'unknown' : date.toLocaleString();
}

export function PresetPanel({ repository, current, onLoad }: Props) {
  const [presets, setPresets] = useState<readonly StoredPreset[]>([]);
  const [broken, setBroken] = useState<readonly BrokenPreset[]>([]);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const listing = await repository.list();
    setPresets(listing.presets);
    setBroken(listing.broken);
  }, [repository]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Every mutation funnels through here so errors surface consistently. */
  const run = useCallback(
    async (label: string, action: () => Promise<void>) => {
      try {
        await action();
        await refresh();
        setMessage({ kind: 'ok', text: label });
      } catch (error) {
        setMessage({ kind: 'error', text: (error as Error).message });
      }
    },
    [refresh],
  );

  const saveCurrent = () =>
    void run('Saved.', async () => {
      await repository.save(current);
    });

  const saveAsNew = () =>
    void run('Saved as a new preset.', async () => {
      await repository.save({ ...current, id: newId(), name: `${current.name} copy` });
    });

  const handleExport = (config: RobotConfig) => {
    const blob = new Blob([exportPreset(config)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = presetFilename(config);
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    await run(`Imported "${file.name}".`, async () => {
      const config = importPreset(await file.text());
      // Give the import a fresh id so it cannot silently overwrite an existing
      // robot that happens to share one.
      const stored = (await repository.exists(config.id))
        ? { ...config, id: newId(), name: `${config.name} (imported)` }
        : config;
      await repository.save(stored);
      onLoad(stored);
    });
  };

  return (
    <section className="panel">
      <h2>Presets</h2>

      <div className="row-actions">
        <button type="button" onClick={saveCurrent}>
          Save &ldquo;{current.name}&rdquo;
        </button>
        <button type="button" className="secondary" onClick={saveAsNew}>
          Save as new
        </button>
      </div>

      <div className="row-actions">
        <button type="button" className="secondary" onClick={() => handleExport(current)}>
          Export
        </button>
        <button type="button" className="secondary" onClick={() => fileInput.current?.click()}>
          Import
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) void handleImportFile(file);
            event.target.value = '';
          }}
        />
      </div>

      {message !== null && (
        <p className={message.kind === 'error' ? 'preset-error' : 'preset-ok'}>{message.text}</p>
      )}

      {presets.length === 0 && broken.length === 0 && (
        <p className="muted small">No saved robots yet.</p>
      )}

      <ul className="preset-list">
        {presets.map((preset) => {
          const isCurrent = preset.config.id === current.id;
          return (
            <li key={preset.config.id} className={`preset-row ${isCurrent ? 'is-current' : ''}`}>
              <div className="preset-head">
                <span className="preset-name">{preset.config.name}</span>
                <span className="preset-meta">
                  {preset.config.chassis.massLb} lb · {preset.config.chassis.lengthIn}×
                  {preset.config.chassis.widthIn} in
                </span>
              </div>
              <div className="preset-saved">Saved {formatSaved(preset.savedAt)}</div>
              <div className="preset-actions">
                <button type="button" className="secondary" onClick={() => onLoad(preset.config)}>
                  Load
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    const name = window.prompt('New name', preset.config.name);
                    if (name !== null && name.trim() !== '') {
                      void run('Renamed.', async () => {
                        await repository.rename(preset.config.id, name.trim());
                      });
                    }
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    void run('Duplicated.', async () => {
                      await repository.duplicate(preset.config.id, newId());
                    })
                  }
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => handleExport(preset.config)}
                >
                  Export
                </button>
                <button
                  type="button"
                  className="secondary danger"
                  onClick={() => {
                    if (window.confirm(`Delete "${preset.config.name}"? This cannot be undone.`)) {
                      void run('Deleted.', async () => {
                        await repository.remove(preset.config.id);
                      });
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {broken.length > 0 && (
        <>
          <h3>Could not be loaded</h3>
          <p className="muted small">
            These records are still stored, but this build cannot read them. Nothing has been
            deleted.
          </p>
          {broken.map((entry) => (
            <div key={entry.id} className="builder-warning">
              <span className="warning-tag">{entry.id}</span>
              {entry.errors.map((e) => (e.path === '' ? e.message : `${e.path}: ${e.message}`)).join('; ')}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
