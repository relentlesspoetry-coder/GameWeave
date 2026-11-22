import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LaunchObservationProvider, LatestLaunchObservation, LaunchTest } from '../src/LaunchTest';
import type { Game, LaunchResult } from '../src/types';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const fixture: Game = {
  appId: '440', name: 'Fixture Game', libraryPath: '/steam', installPath: '/steam/game',
  installPathExists: true, manifestPath: '/steam/game.acf', prefixPath: '/steam/pfx',
  prefixExists: true, configuredTool: null, buildId: null, lastPlayedAt: null,
};

beforeEach(() => invoke.mockReset());
afterEach(cleanup);

const start = () => {
  fireEvent.click(screen.getByRole('checkbox', { name: 'I approve enabling game logs and opening this game in Steam.' }));
  fireEvent.click(screen.getByRole('button', { name: 'Launch & Check Game' }));
};

it('keeps a pending probe and its result when navigation removes the launch panel', async () => {
  let resolve!: (value: Partial<LaunchResult>) => void;
  invoke.mockReturnValue(new Promise(resolveProbe => { resolve = resolveProbe; }));
  const view = (game?: Game) => <LaunchObservationProvider>
    <LatestLaunchObservation/>{game && <LaunchTest game={game}/>}
  </LaunchObservationProvider>;
  const root = render(view(fixture));
  start();
  expect(invoke).toHaveBeenCalledOnce();
  root.rerender(view());
  expect(screen.getByText('Checking launch: Fixture Game…')).toBeTruthy();
  root.rerender(view({ ...fixture, appId: '441', name: 'Other game' }));
  expect((screen.getByRole('button', { name: 'Launch & Check Game' }) as HTMLButtonElement).disabled).toBe(true);
  expect(invoke).toHaveBeenCalledOnce();
  await act(async () => resolve({ status: 'no-fresh-log', detail: 'No new log for this run.', findingCodes: [], observedSeconds: 10, freshLog: false }));
  root.rerender(view());
  expect(screen.getByText('Launch result: Fixture Game')).toBeTruthy();
  expect(screen.getByText('No new log for this run.')).toBeTruthy();
  root.rerender(view(fixture));
  expect(screen.queryByText('Launch result: Fixture Game')).toBeNull();
  expect(screen.getByText('No new log for this run.')).toBeTruthy();
});

it('does not offer to confirm success after Steam rejects the request', async () => {
  invoke.mockResolvedValue({ status: 'launcher-error', detail: 'Steam rejected the request.', findingCodes: [], observedSeconds: 0, freshLog: false });
  render(<LaunchTest game={fixture}/>);
  start();
  expect(await screen.findByText('Steam did not accept the launch')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Yes, the game works' })).toBeNull();
});
