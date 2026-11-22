import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ArrowRight, CheckCircle2, Gamepad2, Grid2X2, HardDrive, Heart, List, Play, Plus, RefreshCw, Search, X } from 'lucide-react';
import type { Game as SteamGame } from './types';
import type { Game as WindowsGame, Library } from './WindowsGames';
import { GameIcon } from './GameIcon';
import { GameCover } from './GameCover';
import { LaunchTest, useLaunchActivity } from './LaunchTest';
import { PagedList, paginate } from './PagedList';
export type LibraryFilter='all'|'favorites'|'issues'|'missing'|'prefix';
export type LibrarySource='all'|'steam'|'windows';
export type LibraryViewMode='grid'|'list';
export type LibrarySort='name'|'recent';
const FAVORITES='proton-medic.library.favorites.v1';
type Item={key:string;name:string;recent:number;kind:'steam';game:SteamGame}|{key:string;name:string;recent:number;kind:'windows';game:WindowsGame};
export const steamLibraryKey=(game:SteamGame)=>JSON.stringify(['steam',game.libraryPath,game.appId]);
export const windowsLibraryKey=(game:WindowsGame)=>JSON.stringify(['windows',game.id]);
function timestamp(value:number|null|undefined){return typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=Date.now()?value:0;}
export function libraryItems(steam:SteamGame[],windows:WindowsGame[]):Item[]{return [
 ...steam.map(game=>({key:steamLibraryKey(game),name:game.name,recent:timestamp(game.lastPlayedAt),kind:'steam' as const,game})),
 ...windows.map(game=>({key:windowsLibraryKey(game),name:game.name,recent:timestamp(game.lastLaunchedAt),kind:'windows' as const,game})),
];}
function readFavorites(){
 const raw=localStorage.getItem(FAVORITES);if(raw===null)return new Set<string>();
 const parsed:unknown=JSON.parse(raw);
 if(!Array.isArray(parsed)||parsed.length>10000||parsed.some(value=>typeof value!=='string'||value.length>8192))throw new Error('Invalid favorites data');
 return new Set<string>(parsed);
}
const needsReview=(game:WindowsGame)=>['process-failed','start-failed','session-ended','interrupted'].includes(game.state);
const windowsRunning=(game:WindowsGame)=>game.state.endsWith('running');
function windowsStatus(game:WindowsGame, runtimeAvailable:boolean){
 if(game.state==='installer-running')return 'Installing';
 if(game.state==='game-running')return 'Running';
 if(game.state==='session-ended')return 'Previous run needs attention';
 if(!game.gameExe)return needsReview(game)?'Needs review':'Setup needed';
 if(!runtimeAvailable)return 'Saved runtime unavailable';
 if(needsReview(game))return 'Needs review';
 return 'Ready to launch';
}
interface Props {
 steam:SteamGame[];steamLoading:boolean;scanAvailable:boolean;refreshKey:number;problemKeys:Set<string>;
 query:string;onQuery:(value:string)=>void;filter:LibraryFilter;onFilter:(value:LibraryFilter)=>void;
 source:LibrarySource;onSource:(value:LibrarySource)=>void;sort:LibrarySort;onSort:(value:LibrarySort)=>void;
 page?:number;onPageChange?:(page:number)=>void;
 viewMode?:LibraryViewMode;onViewMode?:(mode:LibraryViewMode)=>void;
 selectedItemKey?:string|null;onSelectedItemKey?:(key:string|null)=>void;
 recentOnly?:boolean;onRecentOnly?:(recent:boolean)=>void;
 onAddGame?:()=>void;onScan?:()=>void;scanning?:boolean;
 onSteam:(game:SteamGame)=>void;onWindows:(game:WindowsGame)=>void;steamStatus:(game:SteamGame)=>ReactNode;
}
export function UnifiedLibrary(props:Props){
 const [localViewMode,setLocalViewMode]=useState<LibraryViewMode>('grid');
 const viewMode=props.viewMode??localViewMode;
 const setViewMode=props.onViewMode??setLocalViewMode;
 const [localRecentOnly,setLocalRecentOnly]=useState(false);
 const recentOnly=props.recentOnly??localRecentOnly;
 const [localPage,setLocalPage]=useState(0);
 const page=props.page??localPage;
 const setPage=props.onPageChange??setLocalPage;
 const recentFocus=useRef(false);
 const recentHeading=useRef<HTMLHeadingElement>(null);
 const recentLink=useRef<HTMLButtonElement>(null);
 const toggleRecent=(enabled:boolean)=>{
  recentFocus.current=true;
  (props.onRecentOnly??setLocalRecentOnly)(enabled);
  setPage(0);
 };
 useEffect(()=>{
  if(!recentFocus.current)return;
  recentFocus.current=false;
  if(recentOnly)recentHeading.current?.focus();
  else recentLink.current?.focus();
 },[recentOnly]);
 const {activeGame}=useLaunchActivity();
 const [steamLaunching,setSteamLaunching]=useState(false);
 const [launchGame,setLaunchGame]=useState<SteamGame|null>(null);
 const [launching,setLaunching]=useState<string|null>(null);
 const launchLock=useRef(false);
 const launchPanel=useRef<HTMLElement>(null);
 const launchTrigger=useRef<HTMLElement|null>(null);
 const restoreLaunchFocus=useRef(false);
 const search=useRef<HTMLInputElement>(null);
 const windowsGeneration=useRef(0);
 const [launchError,setLaunchError]=useState('');
 const [runtimes,setRuntimes]=useState<Library['runtimes']>([]);
 useEffect(()=>{
  if(launchGame)launchPanel.current?.focus();
  else if(restoreLaunchFocus.current){
   restoreLaunchFocus.current=false;
   const trigger=launchTrigger.current;
   if(trigger?.isConnected&&!trigger.matches(':disabled'))trigger.focus();
   else search.current?.focus();
  }
 },[launchGame]);
 const [windowVisible,setWindowVisible]=useState(!document.hidden);
 const [windows,setWindows]=useState<WindowsGame[]>([]);
 const [warnings,setWarnings]=useState<string[]>([]);
 const [loaded,setLoaded]=useState(false);const [error,setError]=useState('');const [retry,setRetry]=useState(0);
 const [favorites,setFavorites]=useState(()=>{try{return readFavorites();}catch{return new Set<string>();}});
 const [localSelectedKey,setLocalSelectedKey]=useState<string|null>(null);
 const selectedItemKey=props.selectedItemKey===undefined?localSelectedKey:props.selectedItemKey;
 const setSelectedItemKey=props.onSelectedItemKey??setLocalSelectedKey;
 const [favoriteError,setFavoriteError]=useState(()=>{try{readFavorites();return '';}catch{return 'Saved favorites could not be read. They have been left unchanged.';}});
 useEffect(()=>{
  const change=()=>setWindowVisible(!document.hidden);
  document.addEventListener('visibilitychange',change);
  return()=>document.removeEventListener('visibilitychange',change);
 },[]);
 useEffect(()=>{
  if(!windowVisible)return;
  let stopped=false;let timer:ReturnType<typeof setTimeout>;
  const same=<T,>(next:T,previous:T)=>JSON.stringify(next)===JSON.stringify(previous)?previous:next;
  let active=false;
  const refresh=async()=>{
   const generation=windowsGeneration.current;
   try{
    const next=await invoke<Library>('list_windows_games');
    if(!Array.isArray(next?.games)||!Array.isArray(next?.runtimes))throw new Error('Invalid Windows library response');
    if(!stopped&&generation===windowsGeneration.current){
     active=next.games.some(windowsRunning);
     setWindows(old=>same(next.games,old));setWarnings(old=>same(next.warnings??[],old));setRuntimes(old=>same(next.runtimes,old));setLoaded(true);setError('');
    }
   }catch(error){if(!stopped&&generation===windowsGeneration.current)setError(String(error));}
   finally{if(!stopped)timer=setTimeout(()=>void refresh(),active?5000:30000);}
  };
  void refresh();return()=>{stopped=true;clearTimeout(timer);};
 },[windowVisible,props.refreshKey,retry]);
 useEffect(()=>{
  const sync=(event:StorageEvent)=>{if(event.key!==FAVORITES&&event.key!==null)return;try{setFavorites(readFavorites());setFavoriteError('');}catch{setFavoriteError('Saved favorites could not be read. They have been left unchanged.');}};
  window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);
 },[]);
 const toggleFavorite=(key:string)=>{
  try{const next=readFavorites();if(next.has(key))next.delete(key);else next.add(key);if(next.size>10000)throw new Error("Favorites limit reached");localStorage.setItem(FAVORITES,JSON.stringify([...next]));setFavorites(next);setFavoriteError('');}
  catch{setFavoriteError('Could not save favorites. Existing saved favorites have been left unchanged.');}
 };
 const runtimeIds=useMemo(()=>new Set(runtimes.map(runtime=>runtime.id)),[runtimes]);
 const items=useMemo(()=>libraryItems(props.steam,windows),[props.steam,windows]);
 const visible=useMemo(()=>items.filter(item=>{
  if(props.source!=='all'&&item.kind!==props.source)return false;
  const identity=item.kind==='steam'?item.game.appId:item.game.id;
  if(!`${item.name} ${item.kind} ${identity}`.toLocaleLowerCase().includes(props.query.trim().toLocaleLowerCase()))return false;
  if(props.filter==='favorites')return favorites.has(item.key);
  if(props.filter==='issues')return item.kind==='steam'?props.problemKeys.has(`${item.game.libraryPath}:${item.game.appId}`):(needsReview(item.game)||!!item.game.gameExe&&!runtimeIds.has(item.game.runtimeId));
  if(props.filter==='missing')return item.kind==='steam'&&!item.game.installPathExists;
  if(props.filter==='prefix')return item.kind==='steam'&&item.game.prefixExists;
  return true;
 }).sort((a,b)=>(props.sort==='recent'?b.recent-a.recent:0)||a.name.localeCompare(b.name)||a.key.localeCompare(b.key)),[items,props.source,props.query,props.filter,props.sort,props.problemKeys,favorites,runtimeIds]);
 const recent=useMemo(()=>visible.filter(item=>item.recent>0).sort((a,b)=>b.recent-a.recent||a.key.localeCompare(b.key)),[visible]);
 const results=recentOnly?recent:visible;
 useEffect(()=>{
  if((loaded||props.source==='steam')&&results.length===0&&page)setPage(0);
 },[loaded,props.source,results.length,page,setPage]);
 const pageItems=paginate(results,page).items;
 const selectedItem=pageItems.find(item=>item.key===selectedItemKey)??pageItems[0]??null;
 const openItem=(item:Item)=>item.kind==='steam'?props.onSteam(item.game):props.onWindows(item.game);
 const sourceName=(item:Item)=>item.kind==='steam'?'Steam':'Windows';
 const iconSource=(item:Item)=>item.kind==='steam'?{kind:'steam' as const,appId:item.game.appId,libraryPath:item.game.libraryPath}:{kind:'windows' as const,id:item.game.id,executable:item.game.gameExe};
 const runtimeName=(item:Item)=>item.kind==='steam'?(item.game.configuredTool||'Steam default'):(runtimes.find(runtime=>runtime.id===item.game.runtimeId)?.name||'Unavailable');
 const itemWindowsStatus=(game:WindowsGame)=>windowsStatus(game,runtimeIds.has(game.runtimeId));
 const cannotPlay=(item:Item)=>!!activeGame||steamLaunching||!!launching||(item.kind==='steam'?!item.game.installPathExists:!item.game.gameExe||!runtimeIds.has(item.game.runtimeId)||windowsRunning(item.game)||item.game.state==='session-ended');
 const play=async(item:Item,event:MouseEvent<HTMLButtonElement>)=>{
  if(launchLock.current||cannotPlay(item))return;
  setLaunchError('');
  if(item.kind==='steam'){launchTrigger.current=event.currentTarget;setLaunchGame(item.game);return;}
  launchLock.current=true;++windowsGeneration.current;setLaunching(item.key);
  try{
   const id=item.game.id;
   const next=await invoke<WindowsGame | null>('launch_windows_game',{id,confirmed:true});
   if(!next||next.id!==id||typeof next.state!=='string')throw new Error('Unexpected Windows launch response. Check the game status before trying again.');
   ++windowsGeneration.current;
   setWindows(games=>games.map(game=>game.id===id?next:game));
   if(next.state==='start-failed')setLaunchError(`Could not launch ${item.name}: ${next.message||'The runtime did not start.'}`);
  }catch(error){setLaunchError(`Could not launch ${item.name}: ${String(error)}`);}
  finally{setRetry(value=>value+1);launchLock.current=false;setLaunching(null);}
 };
 return <div className="gw-library-layout gw-library-parity" data-library-view={viewMode}>
  <div className="gw-library-list">
  <div className="gw-library-controls">
   <div className="pm-library-toolbar">
    <div className="gw-library-title"><h1>My Library</h1><p className="gw-library-subtitle">All your games, in one place.</p></div>
    <label className="pm-search"><Search size={17}/><input ref={search} value={props.query} onChange={event=>props.onQuery(event.target.value)} placeholder="Search games…" aria-label="Search games"/></label>
    <div className="gw-view-modes" role="group" aria-label="Library view">
     <button type="button" aria-label="Grid view" title="Grid view" aria-pressed={viewMode==='grid'} onClick={()=>setViewMode('grid')}><Grid2X2 size={17}/></button>
     <button type="button" aria-label="List view" title="List view" aria-pressed={viewMode==='list'} onClick={()=>setViewMode('list')}><List size={17}/></button>
    </div>
   </div>
   <div className="pm-library-options gw-library-filterbar">
    <div className="pm-library-sources" role="group" aria-label="Game source">{(['all','steam','windows'] as const).map(source=>{
     const count=source==='all'?items.length:source==='steam'?props.steam.length:windows.length;
     const label=source==='all'?'All':source==='steam'?'Steam':'Windows';
     return <button key={source} type="button" aria-label={label} aria-pressed={props.source===source} onClick={()=>props.onSource(source)}>
      {source==='all'?<Gamepad2 size={15}/>:source==='windows'?<HardDrive size={15}/>:null}<span>{source==='all'?'All Games':label}</span><small aria-hidden="true">{count}</small>
     </button>;
    })}</div>
    <button type="button" className="gw-favorites-filter" aria-pressed={props.filter==='favorites'} onClick={()=>props.onFilter(props.filter==='favorites'?'all':'favorites')}><Heart size={15}/> Favorites <small aria-hidden="true">{items.filter(item=>favorites.has(item.key)).length}</small></button>
    <select aria-label="Filter games" value={props.filter} onChange={event=>props.onFilter(event.target.value as LibraryFilter)}><option value="all">All statuses</option>{props.filter==='favorites'&&<option value="favorites" hidden>Favorites</option>}<option value="issues">Needs attention</option><option value="missing">Missing Steam folder</option><option value="prefix">Steam Proton prefix</option></select>
    <select aria-label="Sort games" value={props.sort} onChange={event=>props.onSort(event.target.value as LibrarySort)}><option value="name">Name A–Z</option><option value="recent">Recently played</option></select>
    {props.onScan&&<button className="pm-button pm-button-secondary" disabled={props.scanning} onClick={()=>props.onScan?.()}><RefreshCw size={15}/>{props.scanning?'Scanning…':'Scan Steam'}</button>}
    {props.onAddGame&&<button className="pm-button pm-button-primary" onClick={props.onAddGame}><Plus size={16}/>Add game</button>}
   </div>
  </div>
  {favoriteError&&<p role="alert" className="pm-repair-danger">{favoriteError}</p>}
  {error&&<div role="alert" className="pm-repair-danger"><span>Could not refresh Windows games: {error}. Previously loaded games are kept.</span><button className="pm-button pm-button-secondary" onClick={()=>setRetry(value=>value+1)}>Retry Windows library</button></div>}
  {warnings.map(warning=><p role="alert" className="pm-repair-danger" key={warning}>{warning}</p>)}
  {launchError&&<p role="alert" className="pm-repair-danger">{launchError}</p>}
  {launchGame&&<section ref={launchPanel} tabIndex={-1} className="pm-section pm-library-launch" aria-label={`Launch ${launchGame.name}`} onKeyDown={event=>{if(event.key==='Escape'&&!steamLaunching){event.preventDefault();restoreLaunchFocus.current=true;setLaunchGame(null);}}}><div className="pm-section-heading"><h2>Launch {launchGame.name}</h2><button className="pm-button pm-button-secondary" aria-label="Close launch options" disabled={steamLaunching} onClick={()=>{restoreLaunchFocus.current=true;setLaunchGame(null);}}><X size={18}/></button></div><LaunchTest key={steamLibraryKey(launchGame)} game={launchGame} onBusyChange={setSteamLaunching}/></section>}
  {!recentOnly&&props.sort==='recent'&&<p className="pm-library-note">Uses available Steam last-played dates and recorded Windows game launches. Unknown dates appear last.</p>}
  <section className="pm-library-grid-section" aria-label="Unified game library">
   {!loaded&&!error&&props.source!=='steam'&&<p role="status">Loading Windows games…</p>}
   {props.steamLoading&&!props.scanAvailable&&props.source!=='windows'&&<p role="status">Loading Steam games…</p>}
   {recentOnly&&<div className="pm-section-heading"><div><h2 ref={recentHeading} tabIndex={-1}>Recently played games</h2><p>Games with recorded activity that match the current filters.</p></div><button type="button" className="pm-button pm-button-secondary" onClick={()=>toggleRecent(false)}>Show all matching games</button></div>}
   {results.length?<PagedList page={page} onPageChange={setPage} clampPage={loaded||props.source==='steam'} className="pm-library-grid" key={`${props.query}:${props.filter}:${props.source}:${props.sort}:${recentOnly}`} items={results} render={item=>{
    const source=sourceName(item);const favorite=favorites.has(item.key);
    return <article className={'pm-library-card'+(selectedItem?.key===item.key?' gw-selected':'')} key={item.key}>
     <GameCover name={item.name} source={{source:item.kind,id:item.kind==='steam'?item.game.appId:item.game.id,libraryPath:item.kind==='steam'?item.game.libraryPath:null}} onOpen={()=>openItem(item)}/>
     <button type="button" className="pm-favorite gw-card-favorite" aria-label={`${favorite?'Remove':'Add'} ${item.name} (${source}) ${favorite?'from':'to'} favorites`} aria-pressed={favorite} onClick={()=>toggleFavorite(item.key)}><Heart size={17} fill={favorite?'currentColor':'none'}/></button>
     <div className="pm-library-card-body">
      <button type="button" className="pm-library-card-title gw-library-select" aria-label={`Select ${item.name} (${source})`} aria-pressed={selectedItem?.key===item.key} onClick={()=>setSelectedItemKey(item.key)}>{item.name}</button>
      <div className="pm-library-card-meta"><span>{source} · {runtimeName(item)}</span>{props.sort==='recent'&&<small>{item.recent?`${item.kind==='steam'?'Last played':'Last launched'} ${new Date(item.recent).toLocaleDateString()}`:'Date unknown'}</small>}</div>
      <div className="pm-library-card-status">{item.kind==='steam'?props.steamStatus(item.game):<span className={`pm-tag ${(needsReview(item.game)||!runtimeIds.has(item.game.runtimeId))?'warning':'neutral'}`}>{itemWindowsStatus(item.game)}</span>}</div>
      <div className="pm-library-card-actions">
       <button className="pm-button pm-button-primary" aria-label={`Play ${item.name} (${source})`} disabled={cannotPlay(item)} onClick={event=>void play(item,event)}><Play size={17}/>{launching===item.key?'Launching…':'Play'}</button>
      </div>
     </div>
    </article>;
   }}/>:(loaded||props.source==='steam')&&(!props.steamLoading||props.scanAvailable||props.source==='windows')&&<div className="pm-empty"><strong>{recentOnly?'No recent activity matches your filters':'No matching games'}</strong><p>Change your search or filters, scan Steam again, or add a game from Windows Games.</p></div>}
  </section>
  {!recentOnly&&recent.length>0&&<section className="pm-section pm-library-recent" aria-label="Recently played"><div className="pm-section-heading"><h2>Recently played</h2><button className="pm-button pm-button-secondary" ref={recentLink} onClick={()=>toggleRecent(true)}>View all<ArrowRight size={16}/></button></div><div className="pm-library-recent-list">{recent.slice(0,3).map(item=><div key={item.key} className="pm-library-recent-row"><GameIcon source={iconSource(item)}/><div className="pm-game-title"><strong>{item.name}</strong><small>{sourceName(item)} · {runtimeName(item)}</small></div><time dateTime={new Date(item.recent).toISOString()}>{new Date(item.recent).toLocaleDateString()}</time><button className="pm-button pm-button-secondary" aria-label={`View recent ${item.name} (${sourceName(item)})`} onClick={()=>openItem(item)}><ArrowRight size={17}/></button></div>)}</div></section>}
   </div>
   {selectedItem&&(()=>{
     const item=selectedItem;
     const source=sourceName(item);
     const favorite=favorites.has(item.key);
     const status=item.kind==='steam'
       ?(item.game.installPathExists?'Game files located':'Installation folder missing')
       :itemWindowsStatus(item.game);
     const ready=!cannotPlay(item);
     const healthy=item.kind==='steam'?item.game.installPathExists:status==='Ready to launch';
     return <aside className="gw-library-detail" aria-label={`Selected game: ${item.name}`}>
       <div className="gw-library-feature">
         <GameCover name={item.name}
           source={{source:item.kind,id:item.kind==='steam'?item.game.appId:item.game.id,libraryPath:item.kind==='steam'?item.game.libraryPath:null}}
           readOnly onOpen={()=>openItem(item)}/>
       </div>
       <div className="gw-library-detail-content">
         <div className="gw-library-detail-heading">
           <div><h2>{item.name}</h2><p>{source} game</p></div>
           <button type="button" className="pm-favorite"
             aria-pressed={favorite}
             aria-label={`${favorite?'Remove':'Add'} selected game ${favorite?'from':'to'} favorites`}
             onClick={()=>toggleFavorite(item.key)}><Heart size={19} fill={favorite?'currentColor':'none'}/></button>
         </div>
         <div className="gw-library-play-row">
           <button className="pm-button pm-button-primary" type="button"
             aria-label={`Play selected ${item.name}`}
             disabled={!ready} onClick={event=>void play(item,event)}>
             <Play size={19}/>{launching===item.key?'Launching…':'Play'}
           </button>
           <div className="gw-library-runtime">
             <strong>{healthy&&<CheckCircle2 size={14}/>} {status}</strong>
           </div>
         </div>
         <div className="gw-library-actions">
           <button type="button" className="gw-library-action" onClick={()=>openItem(item)}>
             <Gamepad2 size={17}/><span><strong>View game details</strong><small>Launch options, settings and logs</small></span><ArrowRight size={18}/>
           </button>
         </div>
         <div className="gw-library-facts">
           <div><span>Source</span><strong>{source}</strong></div>
           <div><span>Runtime</span><strong>{runtimeName(item)}</strong></div>
           <div><span>{item.kind==='steam'?'Last played':'Last launched'}</span><strong>{item.recent>0?new Date(item.recent).toLocaleDateString():'Not recorded'}</strong></div>
         </div>
       </div>
     </aside>;
   })()}
 </div>;
}
