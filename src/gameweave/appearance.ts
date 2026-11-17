/** Gameweave appearance is local-only; it never changes games, prefixes or Proton configurations. */
export const THEMES = [
  { id:'carbon-green', label:'Carbon Green', colors:['#07110d','#42ef70','#c3ff44'] },
  { id:'cyan-purple', label:'Cyan Purple', colors:['#11142d','#13d6fa','#c94ee9'] },
  { id:'red-orange-gold', label:'Red Orange Gold', colors:['#200d13','#fa5139','#ffcf49'] },
  { id:'teal-green-gold', label:'Teal Green Gold', colors:['#07201c','#11d9c8','#ffcf49'] },
] as const;
export type Theme = typeof THEMES[number]['id'];
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
