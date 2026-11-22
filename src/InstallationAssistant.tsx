import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { GameIcon } from './GameIcon';
import type { Game } from './WindowsGames';

interface Review { candidates: { path: string; suggestedName: string }[]; truncated: boolean }
type Props = {
  game: Game;
  busy: boolean;
  run: (task: () => Promise<void>) => Promise<void>;
  onConfirm: (name: string, path: string, shortcut: boolean) => Promise<void>;
  allowManual?: boolean;
};

export function InstallationAssistant({ game, busy, run, onConfirm, allowManual = false }: Props) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [manualPath, setManualPath] = useState('');
  const [name, setName] = useState(game.name);
  const [nameEdited, setNameEdited] = useState(false);
  const [approved, setApproved] = useState(false);
  const [shortcut, setShortcut] = useState(false);
  useEffect(() => {
    let stopped = false;
    setReview(null); setError(''); setSelected(''); setManualPath(''); setApproved(false); setShortcut(false);
    void invoke<Review>('review_windows_installation', { id: game.id }).then(result => {
      if (!stopped) {
        if (Array.isArray(result?.candidates)) setReview(result);
        else setError('No executable review was returned.');
      }
    }).catch(error => { if (!stopped) setError(String(error)); });
    return () => { stopped = true; };
  }, [game.id, game.logDirectory]);

  const consentTarget = (path: string, suggestedName?: string) => {
    setSelected(path); setApproved(false); setShortcut(false);
    if (suggestedName && /setup|install/i.test(game.name) && !nameEdited) setName(suggestedName);
  };
  const candidates = review?.candidates ?? [];
  const manual = allowManual ? async () => {
    const path = await open({ multiple: false, directory: false, defaultPath: game.windowsDrive,
      title: 'Choose the installed game executable', filters: [{ name: 'Installed Windows game', extensions: ['exe'] }] });
    if (typeof path !== 'string') return;
    setManualPath(path); consentTarget(path, path.split('/').pop()?.replace(/\.exe$/i, ''));
  } : undefined;

  return <section className="pm-install-review" aria-label={'Finish installation of ' + game.name}>
    <h4>Finish adding your game</h4>
    <p>Setup has closed. Confirm the executable that starts your game; finding a file does not verify the installation.</p>
    {!review && !error && <p role="status">Looking for game executables…</p>}
    {error && <p role="status">Automatic discovery is unavailable. Choose the installed game .exe manually.</p>}
    {review && !candidates.length && <p>No likely game executable found. Choose it manually, including files on other drives.</p>}
    {manual && <button type="button" className="pm-button pm-button-secondary" disabled={busy} onClick={() => void run(manual)}>Choose installed game (.exe)</button>}
    {(candidates.length > 0 || manualPath) && <form onSubmit={event => {
      event.preventDefault();
      if (!busy && selected && name.trim() && approved) void run(() => onConfirm(name, selected, shortcut));
    }}>
      <div className="pm-install-choice"><GameIcon source={{ kind: 'candidate', id: game.id, executable: selected || null }}/><label>Game executable
        <select aria-label={'Installed executable for ' + game.name} value={selected} disabled={busy} onChange={event => {
          const path = event.target.value;
          consentTarget(path, candidates.find(candidate => candidate.path === path)?.suggestedName);
        }}>
          <option value="">Choose a game executable…</option>
          {candidates.map(candidate => <option key={candidate.path} value={candidate.path}>{candidate.path}</option>)}
          {manualPath && !candidates.some(candidate => candidate.path === manualPath) && <option value={manualPath}>{manualPath}</option>}
        </select></label></div>
      <label className="pm-review-name">Game name<input aria-label={'Installed game name for ' + game.name} value={name}
        maxLength={120} disabled={busy} onChange={event => { setName(event.target.value); setNameEdited(true); setApproved(false); }}/></label>
      <label className="pm-launch-consent"><input type="checkbox" checked={approved} disabled={busy} onChange={event => setApproved(event.target.checked)}/><span>I trust the selected executable and approve saving this game.</span></label>
      <label className="pm-launch-consent"><input type="checkbox" checked={shortcut} disabled={busy} onChange={event => setShortcut(event.target.checked)}/><span>Create desktop and applications-menu shortcuts</span></label>
      <button type="submit" className="pm-button pm-button-primary" disabled={busy || !selected || !name.trim() || !approved}>Confirm game</button>
    </form>}
    {review?.truncated && <p>The search reached its limit. You can select another executable manually.</p>}
  </section>;
}
