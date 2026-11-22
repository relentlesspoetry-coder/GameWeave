import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AlertTriangle, CheckCircle2, ChevronDown, Clock3, Gamepad2, Play, ShieldCheck } from 'lucide-react';
import type { Game, LaunchResult } from './types';

type Observation = { game: Game; pending: boolean; result: LaunchResult | null; failure: string | null; playable: boolean };
const identity = (game: Game) => JSON.stringify([game.libraryPath, game.appId]);

function useObservationState() {
  const [observation, setObservation] = useState<Observation | null>(null);
  const [visibleKey, setVisibleKey] = useState<string | null>(null);
  const active = useRef(false);
  const start = async (game: Game) => {
    if (active.current || !game.installPathExists) return;
    active.current = true;
    const base = { game, pending: true, result: null, failure: null, playable: false };
    setObservation(base);
    try {
      const result = await invoke<LaunchResult>('test_game_launch', {
        appId: game.appId, libraryPath: game.libraryPath, seconds: 10, confirmed: true,
      });
      setObservation({ ...base, pending: false, result });
    } catch (error) {
      setObservation({ ...base, pending: false, failure: `Could not test this game: ${String(error)}` });
    } finally { active.current = false; }
  };
  const confirmPlayable = (game: Game) => {
    setObservation(current => current?.result && current.result.status !== 'launcher-error'
      && identity(current.game) === identity(game) ? { ...current, playable: true } : current);
  };
  const dismiss = () => setObservation(current => current?.pending ? current : null);
  return { observation, visibleKey, setVisibleKey, start, confirmPlayable, dismiss };
}

const LaunchContext = createContext<ReturnType<typeof useObservationState> | null>(null);

export function LaunchObservationProvider({ children }: { children: ReactNode }) {
  const state = useObservationState();
  return <LaunchContext.Provider value={state}>{children}</LaunchContext.Provider>;
}

export function useLaunchActivity() {
  const current = useContext(LaunchContext)?.observation;
  return { activeGame: current?.pending ? current.game : null, latestGame: current?.game ?? null };
}

function ObservationResult({ observation, onConfirm }: { observation: Observation; onConfirm: () => void }) {
  const { result, failure, playable } = observation;
  if (failure) return <p className="pm-repair-danger" role="alert">{failure}</p>;
  if (!result) return null;
  const rejected = result.status === 'launcher-error';
  const warning = rejected || result.status === 'log-error' || result.status === 'log-warning' || result.status === 'log-unreadable';
  return <div className="pm-launch-results">
    <div className="pm-launch-status" role="status">
      <span className={`pm-launch-indicator ${warning ? 'warn' : 'neutral'}`}>{warning ? <AlertTriangle size={18}/> : <ShieldCheck size={18}/>}</span>
      <div><strong>{rejected ? 'Steam did not accept the launch' : warning ? 'Review launch findings' : 'Launch checked — confirmation needed'}</strong><p>{result.detail}</p></div>
    </div>
    {!rejected && <div className="pm-launch-facts"><span>New Proton log: <strong>{result.freshLog ? 'Detected' : 'Not detected'}</strong></span><span>Observation: <strong>{result.observedSeconds}s</strong></span></div>}
    {result.findingCodes.length > 0 && <details className="pm-launch-technical"><summary>Log findings <ChevronDown size={16}/></summary><code>{result.findingCodes.join(', ')}</code></details>}
    {!rejected && <div className="pm-launch-confirm">
      <p>Did the game reach a playable screen?</p>
      <button className="pm-button pm-button-secondary" disabled={playable} onClick={onConfirm}><CheckCircle2 size={17}/>{playable ? 'Playable — confirmed by you' : 'Yes, the game works'}</button>
      {playable && <small>Confirmed for this test only.</small>}
    </div>}
  </div>;
}

export function LatestLaunchObservation() {
  const state = useContext(LaunchContext);
  const current = state?.observation;
  if (!state || !current || state.visibleKey === identity(current.game)) return null;
  if (current.pending) return <p className="pm-callout" role="status">Checking launch: {current.game.name}…</p>;
  return <details className="pm-section pm-technical">
    <summary>Launch result: {current.game.name}<ChevronDown size={16}/></summary>
    <ObservationResult observation={current} onConfirm={() => state.confirmPlayable(current.game)}/>
    <button type="button" className="pm-button pm-button-secondary" onClick={state.dismiss}>Dismiss result</button>
  </details>;
}

/** An explicit launch observation, never a claim of verified compatibility. */
export function LaunchTest({ game, onBusyChange }: { game: Game; onBusyChange?: (busy: boolean) => void }) {
  const [approved, setApproved] = useState(false);
  const shared = useContext(LaunchContext);
  const standalone = useObservationState();
  const state = shared ?? standalone;
  const key = identity(game);
  const observation = state.observation && identity(state.observation.game) === key ? state.observation : null;
  const testing = observation?.pending ?? false;
  const busy = state.observation?.pending ?? false;
  const setVisibleKey = state.setVisibleKey;
  useEffect(() => {
    setVisibleKey(key);
    setApproved(false);
    return () => setVisibleKey(current => current === key ? null : current);
  }, [key, setVisibleKey]);
  useEffect(() => { onBusyChange?.(testing); }, [onBusyChange, testing]);

  return <section className="pm-section pm-launch" aria-label="Compatibility launch test">
    <div className="pm-section-heading"><div><h2>Test Game Launch</h2><p>Open the game in Steam and check for fresh Proton errors.</p></div><Gamepad2 className="pm-green" size={23}/></div>
    <div className="pm-launch-instructions">
      <Clock3 size={21}/>
      <div><strong>10-second launch observation</strong><p>If automatic logging is unavailable, Steam uses its existing settings. Your game may remain open after the check.</p></div>
    </div>
    <label className="pm-launch-consent"><input type="checkbox" checked={approved} disabled={busy} onChange={e => setApproved(e.target.checked)}/><span>I approve enabling game logs and opening this game in Steam.</span></label>
    <button className="pm-button pm-button-primary" disabled={!approved || busy || !game.installPathExists} onClick={() => { if (approved) { setApproved(false); void state.start(game); } }}>
      <Play size={17}/>{testing ? 'Launching and observing…' : 'Launch & Check Game'}
    </button>
    {busy && !testing && <p role="status">Another game launch is being checked.</p>}
    {observation && !testing && <ObservationResult observation={observation} onConfirm={() => state.confirmPlayable(game)}/>}
  </section>;
}
