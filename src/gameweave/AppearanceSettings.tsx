import { Check, Monitor } from 'lucide-react';
import { THEMES, type Appearance, type Glass } from './appearance';

interface Props { value:Appearance; onChange:(value:Appearance)=>void; saveError?:string }
export function AppearanceSettings({value,onChange,saveError}:Props){
  const set=(patch:Partial<Appearance>)=>onChange({...value,...patch});
  return <section className="pm-section gw-appearance" aria-labelledby="gw-appearance-heading">
    <div className="pm-section-heading"><div>
      <h2 id="gw-appearance-heading">Appearance</h2>
      <p>Choose one of four Gameweave themes. Frosted panels show a blurred view of the background.</p>
    </div></div>
    <div className="gw-theme-grid" role="radiogroup" aria-label="Color theme">
      {THEMES.map(theme=><button key={theme.id} type="button" role="radio"
        aria-checked={value.theme===theme.id}
        className={'gw-theme-tile'+(value.theme===theme.id?' selected':'')}
        onClick={()=>set({theme:theme.id})}>
        <span className="gw-swatches" aria-hidden="true">
          {theme.colors.map(c=><span key={c} style={{backgroundColor:c}}/>)}
        </span>
        <strong>{theme.label}</strong>{value.theme===theme.id&&<Check size={17} aria-hidden="true"/>}
      </button>)}
    </div>
    <div className="gw-setting-row">
      <label htmlFor="gw-glass">Glass intensity <small>Background blur and translucency</small></label>
      <select id="gw-glass" value={value.glass}
        onChange={event=>set({glass:event.target.value as Glass})}>
        <option value="subtle">Subtle</option><option value="balanced">Balanced</option>
        <option value="strong">Strong</option>
      </select>
    </div>
    <label className="gw-setting-row">
      <span>Reduce motion <small>Minimize decorative transitions and movement</small></span>
      <input type="checkbox" checked={value.reduceMotion}
        onChange={event=>set({reduceMotion:event.target.checked})}/>
    </label>
    <div className="gw-appearance-preview">
      <Monitor size={21} aria-hidden="true"/>
      <span><strong>Live preview</strong><small>Appearance changes are applied immediately.</small></span>
      <span className="gw-preview-button">Play</span>
    </div>
    {saveError&&<p role="alert" className="pm-error">{saveError}</p>}
  </section>;
}
