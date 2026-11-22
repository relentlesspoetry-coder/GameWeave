const currentPaths = {
  rail: 'M-50 768C51 586 113 556 226 468Q277 428 316 337',
  workspace: 'M185 205C394 93 522 12 776 55S1071 165 1464-102',
} as const;

/** Decorative vector light, drawn independently of game covers and UI controls. */
export function GlassRibbon({ placement }: { placement: 'rail' | 'workspace' }) {
  const rail = placement === 'rail';
  const feather = 'gw-feather-' + placement;
  const mask = 'gw-current-mask-' + placement;
  const band = rail ? 172 : 568;
  return <svg className={'gw-glass-ribbon gw-glass-ribbon-'+placement} viewBox={placement==='rail'?'0 0 260 950':'0 0 1440 550'}
    preserveAspectRatio="none" focusable="false" aria-hidden="true">
    <defs>
      <linearGradient id={'gw-spectrum-'+placement} x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0" stopColor="var(--gw-accent)" stopOpacity="0"/>
        <stop offset=".23" stopColor="var(--gw-accent)" stopOpacity=".83"/>
        <stop offset=".52" stopColor="var(--gw-secondary)"/>
        <stop offset=".67" stopColor="var(--gw-glint)" stopOpacity=".84"/>
        <stop offset=".82" stopColor="var(--gw-accent)" stopOpacity=".76"/>
        <stop offset="1" stopColor="var(--gw-accent)" stopOpacity="0"/>
      </linearGradient>
      <linearGradient id={feather}>
        <stop offset="0" stopColor="white" stopOpacity="0"/>
        <stop offset=".16" stopColor="white" stopOpacity=".07"/>
        <stop offset=".32" stopColor="white" stopOpacity=".44"/>
        <stop offset=".50" stopColor="white" stopOpacity=".91"/>
        <stop offset=".67" stopColor="white" stopOpacity=".50"/>
        <stop offset=".84" stopColor="white" stopOpacity=".12"/>
        <stop offset="1" stopColor="white" stopOpacity="0"/>
      </linearGradient>
      <mask id={mask} maskUnits="userSpaceOnUse" x="-130" y="-160"
        width={rail ? 520 : 1750} height={rail ? 1250 : 880}>
        {[false, true].map(echo =>
          <rect key={String(echo)} className={'gw-current-mask-band' + (echo ? ' gw-current-mask-echo' : '')}
            x={-band / 2} y="-160" width={band} height={rail ? 1250 : 880} fill={`url(#${feather})`}/>)}
      </mask>
    </defs>
    {placement==='rail'?<>
      <path className="gw-ribbon-fill" d="M-50 768C51 586 113 556 226 468Q277 428 316 337C246 482 151 526 91 600S-18 744-50 768Z"/>
      <path className="gw-ribbon-fill" d="M-50 906C69 720 174 706 317 563C190 743 127 774 39 838Q-14 877-50 906Z"/>
      <path className="gw-ribbon-core" d="M-50 768C51 586 113 556 226 468Q277 428 316 337M-50 906C69 720 174 706 317 563"/>
    </>:<>
      <path className="gw-ribbon-fill" d="M185 205C394 93 522 12 776 55S1071 165 1464-102C1280 126 1049 142 809 81S399 110 185 205Z"/>
      <path className="gw-ribbon-core" d="M185 205C394 93 522 12 776 55S1071 165 1464-102M292 190C457 115 595 43 809 81S1184 173 1464-102"/>
    </>}
    <g className="gw-current-luminance" mask={`url(#${mask})`}>
      <path className="gw-current-tracer gw-current-wash" d={currentPaths[placement]}/>
      <path className="gw-current-tracer gw-current-core" d={currentPaths[placement]}/>
    </g>
  </svg>;
}
