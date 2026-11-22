/** Gameweave appearance is local-only; it never changes games, prefixes or Proton configurations. */
// Stable internal IDs also reference the original logo assets and previously saved selections.
// Each tuple is [primary, highlight, glint]. These are exact uncomposited RGB pixels
// of the respective packaged lossless logo. Pixel coordinates are tested in the UI suite.
export const THEMES = [
  { id:'carbon-green', label:'Carbon Green', colors:['#00d164','#aaf901','#d7fc5c'] },
  { id:'cyan-purple', label:'Blue & Purple', colors:['#009cfd','#cd44fa','#23dcfd'] },
  { id:'red-orange-gold', label:'Red & Orange', colors:['#ee121d','#ff8405','#fece17'] },
  { id:'teal-green-gold', label:'Teal & Green', colors:['#00c4cf','#64df0c','#ffbc0c'] },
] as const;
export type Theme = typeof THEMES[number]['id'];
const rgb = (hex:string) => [1,3,5].map(offset=>parseInt(hex.slice(offset,offset+2),16)).join(',');
export function themeVariables(theme:Theme) {
  const [primary,highlight,glint]=(THEMES.find(palette=>palette.id===theme)??THEMES[0]).colors;
  return {
    '--gw-accent':primary, '--gw-rgb':rgb(primary),
    '--gw-secondary':highlight, '--gw-tail-rgb':rgb(highlight),
    '--gw-glint':glint, '--gw-glint-rgb':rgb(glint),
  };
}
export type Glass = 'subtle'|'balanced'|'strong';
export type Appearance = {theme:Theme; glass:Glass; reduceMotion:boolean};
export const KEY = 'gameweave.appearance.v1';
export const DEFAULT:Appearance = {theme:'carbon-green',glass:'balanced',reduceMotion:false};
export function normalizeAppearance(input:unknown):Appearance {
  if(!input||typeof input!=='object'||Array.isArray(input))return {...DEFAULT};
  const v=input as Record<string,unknown>;
  return {
    theme: THEMES.some(t=>t.id===v.theme)?v.theme as Theme:DEFAULT.theme,
    glass: v.glass==='subtle'||v.glass==='balanced'||v.glass==='strong'?v.glass:DEFAULT.glass,
    reduceMotion: typeof v.reduceMotion==='boolean'?v.reduceMotion:DEFAULT.reduceMotion,
  };
}
export function readAppearance(storage?:Pick<Storage,'getItem'>):Appearance {
  try {const raw=(storage??window.localStorage).getItem(KEY);return raw?normalizeAppearance(JSON.parse(raw) as unknown):{...DEFAULT};}
  catch{return {...DEFAULT};}
}
export function saveAppearance(value:Appearance,storage?:Pick<Storage,'setItem'>):boolean {
  try{(storage??window.localStorage).setItem(KEY,JSON.stringify(normalizeAppearance(value)));return true;}
  catch{return false;}
}
