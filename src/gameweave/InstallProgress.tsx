import { Check, CircleAlert, Download, FileCheck2, Monitor } from 'lucide-react';
import type { Game } from '../WindowsGames';
import './install.css';

type Phase = 'select' | 'configure' | 'install' | 'finish';

const steps: { id: Phase; title: string }[] = [
  { id: 'select', title: 'Select installer' },
  { id: 'configure', title: 'Configure' },
  { id: 'install', title: 'Install' },
  { id: 'finish', title: 'Finish' },
];

export function InstallSteps({ phase }: { phase: Phase }) {
  const current = steps.findIndex(step => step.id === phase);
  return <ol className="gw-install-steps" aria-label="Installation steps">
    {steps.map((step, index) => <li key={step.id} aria-current={index === current ? 'step' : undefined}
      data-complete={index < current}>
      <span className="gw-install-step-number" aria-hidden="true">{index < current ? <Check size={15}/> : index + 1}</span>
      <span className="gw-install-step-title">{step.title}</span>
    </li>)}
  </ol>;
}

export const canRetryInstall = (game?: Game) => !!game && game.state === 'start-failed' && !game.gameExe;

export function installPhase(installer: string, starting: boolean, game?: Game): Phase {
  if (game && (game.state === 'installer-exited' || game.gameExe)) return 'finish';
  if (starting || game) return 'install';
  return installer ? 'configure' : 'select';
}

export function InstallProgress({ installer, name, runtime, game, starting }: {
  installer: string; name: string; runtime?: string; game?: Game; starting: boolean;
}) {
  let status = 'Waiting for an installer';
  let detail = 'Choose a trusted Windows executable to begin.';
  let running = false;
  let problem = false;
  if (game?.gameExe) {
    status = 'Game executable selected';
    detail = 'Your game is in the library. Launch it separately when you’re ready to test it.';
  } else if (starting) {
    status = 'Starting installer';
    detail = 'Waiting for Proton to open the setup window.';
    running = true;
  } else if (game) {
    switch (game.state) {
      case 'installer-running':
        status = 'Installer running';
        detail = 'Complete setup in the installer’s own window. It does not report a percentage here.';
        running = true;
        break;
      case 'installer-exited':
        status = 'Setup closed';
        detail = 'Choose and confirm the installed game’s .exe in the Finish step. The installer exit alone does not verify the installation.';
        break;
      case 'process-failed':
      case 'start-failed':
      case 'interrupted':
      case 'session-ended':
        status = 'Installer needs attention';
        detail = game.message || 'Review the current installation before trying again.';
        problem = true;
        break;
      default:
        status = 'Review game card';
        detail = game.message || 'Use the Windows game card to check what is needed next.';
    }
  } else if (installer) {
    status = 'Ready to configure';
    detail = 'Check the game name and Proton version, then approve the installer to run it.';
  }
  return <aside className="gw-install-summary" aria-label="Current installation">
    <div className="gw-install-summary-hero">
      <Monitor size={25} aria-hidden="true"/>
      <small>Windows installer · EXE</small>
      <h3>{game?.name || name.trim() || 'Windows game'}</h3>
    </div>
    <div className="gw-install-status">
      <h4>{problem ? <CircleAlert size={17}/> : <Download size={17}/>} Installation progress</h4>
      <div role="status">
        <strong>{status}</strong>
        <p>{detail}</p>
      </div>
      {running && <progress aria-label="Installer activity (no percentage available)"/>}
    </div>
    <div className="gw-install-status">
      <h4><FileCheck2 size={17}/> Setup details</h4>
      <dl>
        <dt>Installer</dt><dd>{installer.split('/').pop() || (game ? 'Previously selected' : 'Not selected')}</dd>
        <dt>Proton</dt><dd>{runtime || 'Not available'}</dd>
        <dt>Prefix</dt><dd>{game?.prefixDirectory || 'New managed prefix'}</dd>
      </dl>
    </div>
  </aside>;
}
