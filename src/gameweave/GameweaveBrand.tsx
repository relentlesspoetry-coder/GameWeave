import { useState } from 'react';
import type { Theme } from './appearance';

/**
 * Displays the actual user-supplied theme logo when present.
 * Until the asset bundle is copied to /public/branding, it fails safely
 * to a text-only mark without breaking the desktop frontend.
 */
export function GameweaveBrand({ theme }: { theme: Theme }) {
  const [loaded, setLoaded] = useState<Theme | null>(null);
  return <div className="gw-brand" aria-label="Gameweave">
    <img key={theme} className="gw-brand-logo" src={`/branding/${theme}.webp`}
      alt="Gameweave" hidden={loaded !== theme}
      onLoad={() => setLoaded(theme)} onError={() => setLoaded(null)} />
    {loaded !== theme && <>
      <span className="gw-brand-mark" aria-hidden="true">GW</span>
      <strong>GAMEWEAVE</strong>
    </>}
    <small>Linux Gaming Hub</small>
  </div>;
}
