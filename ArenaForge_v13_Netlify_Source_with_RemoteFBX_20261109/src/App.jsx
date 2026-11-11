import React, { useEffect, useRef, useState } from 'react';
import AgentSelector from './AgentSelector.jsx';
import { AGENTS } from './game/agents.js';
import { ArenaEngine } from './game/arena-engine.js';
import { MAP_AREAS, MAP_HOLES, MAP_LABELS, SITES, SPAWNS, mapPoint, MAP_IDS, selectActiveMap, ACTIVE_MAP_NAME } from './game/map-layout.js';
import { io } from 'socket.io-client';
import { WEAPONS, WEAPON_LIST, STARTING_CREDITS } from './game/weapons.js';

const MULTIPLAYER_SERVER_URL = 'https://forlornant.onrender.com';

function readSettings() {
  try {
    return JSON.parse(localStorage.getItem('arenaForgeSettingsV1') || '{}');
  } catch { return {}; }
}

const initialHud = {
  health: 100,
  ammo: 12,
  reserve: 48,
  credits: STARTING_CREDITS,
  kitCharges: {q:0,f:0}, ultimatePoints:0, armor:0, flashRemaining:0,
  weaponId: 'sidearm',
  canBuy: false,
  materials: 300,
  weapon: 'GRIT SIDEARM',
  mode: 'COMBAT',
  buildPiece: 'WALL',
  targets: 0,
  message: 'CLICK TO CAPTURE MOUSE',
  role: 'ATTACKERS',
  objective: 'SPIKE: CARRIED',
  actionHint: 'FIND SITE A OR B · HOLD E TO PLANT',
  clock: '01:40',
  objectiveProgress: 0,
  roundResult: '',
  score: { ATTACKERS: 0, DEFENDERS: 0 },
  allies: 5,
  enemies: 5,
  kills: 0,
  deaths: 0,
  feed: [],
  location: 'ATTACKER SPAWN',
  mapPlayer: {x:SPAWNS.ATTACKERS.x,z:SPAWNS.ATTACKERS.z,yaw:0},
  mapPlayers: [],
  spikeSite: null,
  respawn: 0,
  damageFlash: 0,
  round: 1, phase: 'WAITING', gameType: 'PRIVATE'
};

function GameView({ onHud, onExit, role, network, gameMode, agentId, controllerRef, mapId }) {
  const mountRef = useRef(null);

  useEffect(() => {
    if (!mountRef.current) return undefined;
    const engine = new ArenaEngine(mountRef.current, onHud, role, network, gameMode, agentId, mapId);
    controllerRef.current = engine;
    const handleExit = (event) => {
      if (event.key === 'Escape') {
        document.exitPointerLock?.();
        onExit();
      }
    };
    window.addEventListener('keydown', handleExit);
    return () => {
      window.removeEventListener('keydown', handleExit);
      engine.dispose();
      if(controllerRef.current===engine)controllerRef.current=null;
    };
  }, [onHud, onExit, role, network, gameMode, mapId]);

  return <div className="game-canvas" ref={mountRef} />;
}

function App() {
  const [started, setStarted] = useState(false);
  const [pendingMode, setPendingMode] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState('rift');
  const [selectedMapId,setSelectedMapId]=useState('foundry');
  const [activeMapId,setActiveMapId]=useState('foundry');
  const [agentLocked, setAgentLocked] = useState(false);
  const [hasPlayedOnline, setHasPlayedOnline] = useState(false);
  const [agentError, setAgentError] = useState('');
  const [selectedRole, setSelectedRole] = useState('attack');
  const [gameMode, setGameMode] = useState('attackDrill');
  const [hud, setHud] = useState(initialHud);
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDrills, setShowDrills] = useState(false);
  const [showOnline, setShowOnline] = useState(false);
  const [sensitivity, setSensitivity] = useState(() => readSettings().sensitivity ?? 0.0022);
  const [fov, setFov] = useState(() => readSettings().fov ?? 76);
  const [botDifficulty, setBotDifficulty] = useState(() => readSettings().botDifficulty ?? 'standard');
  const [roomCode, setRoomCode] = useState('');
  const [activeRoom, setActiveRoom] = useState('');
  const [network, setNetwork] = useState(null);
  const [networkError, setNetworkError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const [isOnline, setIsOnline] = useState(false);
  const networkRef = useRef(null);
  const gameControllerRef = useRef(null);
  const [showShop, setShowShop] = useState(false);

  useEffect(() => {
    localStorage.setItem('arenaForgeSettingsV1', JSON.stringify({ sensitivity, fov, botDifficulty }));
  }, [sensitivity, fov, botDifficulty]);

  useEffect(() => {
    const handler = (event) => {
      if(!started)return;
      if(event.code==='KeyM'){
        event.preventDefault();
        setShowShop(v=>{if(!v)document.exitPointerLock?.();return !v});
      }else if(event.code==='Escape'&&showShop){
        event.preventDefault();event.stopImmediatePropagation?.();
        setShowShop(false);
      }
    };
    window.addEventListener('keydown',handler,true);
    return ()=>window.removeEventListener('keydown',handler,true);
  },[started,showShop]);

  useEffect(() => {
    if(isOnline && ['CARRIED','PLANTED','ROUND_OVER','MATCH_OVER'].includes(hud.phase))setHasPlayedOnline(true);
  },[isOnline,hud.phase]);

  const handleHud = React.useCallback((next) => {
    setHud((current) => ({ ...current, ...next }));
  }, []);

  const exitGame = React.useCallback(() => {
    networkRef.current?.emit('leaveRoom');
    networkRef.current?.disconnect();
    networkRef.current = null;
    setNetwork(null);
    setActiveRoom('');
    setIsOnline(false);
    setStarted(false);
    setShowShop(false);
    setPendingMode(null);
    setAgentLocked(false);
    setHasPlayedOnline(false);
    setConnecting(false);
  }, []);

  const startLocalMode = (mode) => {
    const nextRole = mode === 'attackDrill' ? 'attack' : mode === 'defendDrill' ? 'defend' : selectedRole;
    setSelectedRole(nextRole);
    networkRef.current?.disconnect();
    networkRef.current = null;
    setNetwork(null);
    setIsOnline(false);
    setActiveRoom('');
    setNetworkError('');
    setGameMode(mode);
    selectActiveMap(selectedMapId);
    setActiveMapId(selectedMapId);
    setPendingMode(null);
    setAgentLocked(false);
    setHasPlayedOnline(false);
    setShowShop(false);
    setHud({
      ...initialHud,
      role: nextRole === 'defend' ? 'DEFENDERS' : 'ATTACKERS',
      objective: mode === 'bots' ? 'LIVE BOT MATCH' : mode === 'defendDrill' ? 'SPIKE PLANTED · SITE A' : 'SPIKE: CARRIED'
    });
    setStarted(true);
  };

  const connectRoom = (create = false, quick = false, arena = false) => {
    if (connecting) return;
    setConnecting(true);
    setNetworkError('');
    networkRef.current?.disconnect();
    const socket = io(MULTIPLAYER_SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      timeout: 9000,
      autoConnect: true
    });
    networkRef.current = socket;
    socket.on('connect_error', (error) => {
      setNetworkError(`SERVER CONNECTION FAILED: ${error.message}`);
      setConnecting(false);
    });
    socket.on('connect', () => {
      const eventName = arena?'joinArena':quick ? 'joinQuickPlay' : create ? 'createRoom' : 'joinRoom';
      const payload = arena?{agent:selectedAgent}:quick ? {} : create ? {mapId:selectedMapId} : { code: roomCode.trim().toUpperCase() };
      socket.timeout(11000).emit(eventName, payload, (error, response) => {
        setConnecting(false);
        if (error || !response?.ok) {
          const details=arena?'Update the Render server with the v14 Arena files first.':quick?'The Render service must be updated to v13 for map rotation.':'';
          setNetworkError(`${response?.error || 'NO MATCH RESPONSE FROM SERVER'}. ${details}`);
          socket.disconnect();
          return;
        }
        socket.initialBuilds = response.builds || [];
        const assignedMap=selectActiveMap(response.mapId||'foundry');
        setActiveMapId(assignedMap);
        setActiveRoom(response.code);
        setRoomCode(response.code);
        setOnlineCount(response.players);
        setSelectedRole(response.role === 'DEFENDERS' ? 'defend' : 'attack');
        setNetwork(socket);
        setIsOnline(true);
        setGameMode(arena?'arenaOnline':quick ? 'onlineQuick' : 'online');
        setAgentLocked(arena);
        setHasPlayedOnline(arena);
        setAgentError('');
        setHud({ ...initialHud, role: response.role, phase: arena?'ARENA':'WAITING',
          objective: response.objective?.objective || 'MATCHMAKING' });
        setStarted(true);
      });
    });
    socket.on('snapshot', (state) => {
      setOnlineCount(state.players.length);
      if(state.mapId && MAP_IDS.includes(state.mapId)){
        selectActiveMap(state.mapId);
        setActiveMapId(previous=>previous===state.mapId?previous:state.mapId);
      }
    });
    socket.on('disconnect', () => setNetworkError('CONNECTION LOST — RECONNECTING'));
  };

  const lockOnlineAgent=()=>{
    const socket=networkRef.current;
    if(!socket?.connected)return setAgentError('NOT CONNECTED');
    socket.emit('selectAgent',{id:selectedAgent},(result)=>{
      if(result?.ok){setAgentLocked(true);setAgentError('');}
      else setAgentError(result?.error||'SELECTION NOT ACCEPTED');
    });
  };

  if (pendingMode) {
    return <AgentSelector selected={selectedAgent} onChoose={setSelectedAgent}
      onConfirm={()=>pendingMode==='arena'? (setPendingMode(null),connectRoom(false,false,true)):startLocalMode(pendingMode)} confirmLabel={pendingMode==='arena'?'ENTER BUILD ARENA':'START MATCH'}
      phase="LOCAL MATCH" onCancel={()=>setPendingMode(null)}
      note={pendingMode==='arena'?'Choose your operative for continuous free-for-all building combat.':'Choose your agent before entering Play with Bots or a training drill.'} />;
  }

  if (started) {
    return (
      <main className="game-shell">
        <GameView key={activeMapId} onHud={handleHud} onExit={exitGame} role={selectedRole} network={network} gameMode={gameMode} agentId={selectedAgent} controllerRef={gameControllerRef} mapId={activeMapId} />
        <div className="top-hud">
          <div className="match-label"><span className="live-dot" /> {hud.mapName||ACTIVE_MAP_NAME} · V14 <span className="hud-divider">/</span> {isOnline ? `${gameMode === 'arenaOnline' ? 'BUILD ARENA' : gameMode === 'onlineQuick' ? 'QUICK PLAY' : 'PRIVATE'} · ${onlineCount}/10` : gameMode === 'bots' ? 'PLAY WITH BOTS' : 'TACTICAL DRILLS'}</div>
          {gameMode==='arenaOnline'?<div className="arena-top-score">FREE FOR ALL · KILLS {hud.kills||0} · DEATHS {hud.deaths||0}</div>:<div className="match-scoreboard" aria-label="Round score">
            <span className="score-label attack-label">ATTACKERS</span>
            <strong className="score-number">{hud.score?.ATTACKERS ?? 0}</strong>
            <span className="score-timer">{hud.clock}<small>ROUND {hud.round || 1}</small></span>
            <strong className="score-number">{hud.score?.DEFENDERS ?? 0}</strong>
            <span className="score-label defender-label">DEFENDERS</span>
          </div>}
          {gameMode!=='arenaOnline'&&<div className="site-status"><span className="site-chip">A</span><span className="site-chip">B</span></div>}
        </div>
        {gameMode!=='arenaOnline'&&<div className={`side-banner ${hud.role === 'ATTACKERS'?'side-attacker':'side-defender'}`}>
          <strong>{hud.role === 'ATTACKERS'?'ATTACKING TEAM':'DEFENDING TEAM'}</strong>
          <span>{hud.role === 'ATTACKERS'?'PLANT THE SPIKE':'DEFEND THE SITES'}</span>
        </div>}
        {gameMode!=='arenaOnline'&&<div className={`spike-banner ${hud.isSpikeCarrier?'spike-owned':''}`}>
          <span className="spike-symbol">◆</span>
          <strong>{hud.spikeSite ? `SPIKE PLANTED · ${hud.spikeSite}` : hud.isSpikeCarrier?'YOU HAVE THE SPIKE':`SPIKE CARRIER: ${hud.carrierLabel||'UNASSIGNED'}`}</strong>
        </div>}
        <div className="objective-strip"><strong>{hud.objective}</strong><span>{hud.actionHint}</span>{hud.objectiveProgress > 0 && <i><b style={{ width: `${Math.min(100, hud.objectiveProgress * 100)}%` }} /></i>}</div>
        {gameMode==='arenaOnline'&&<div className="arena-leaderboard"><strong>LIVE LEADERBOARD</strong><div>PLAYER <span>K</span><span>D</span></div>{(hud.arenaLeaderboard||[]).slice(0,10).map((p,i)=><div key={p.id}><b>{i+1}. {p.name}</b><span>{p.kills}</span><span>{p.deaths}</span></div>)}<small>Q: 3 KILLS · F: 7 KILLS · V: 12 KILLS</small></div>}
        <div className="tactical-readout">
          <span className="team-count allies-count">YOUR TEAM <b>{hud.allies ?? 1}</b></span>
          <span className="team-count enemies-count">OPPONENTS <b>{hud.enemies ?? 0}</b></span>
          <span className="location-label">{hud.location} · {ACTIVE_MAP_NAME}</span>
        </div>
        <div className="mini-map-panel" aria-label="Ironveil Yard tactical map">
          <div className="mini-map-heading"><span>{ACTIVE_MAP_NAME}</span><b>{activeMapId.toUpperCase()}</b></div>
          <svg viewBox="0 0 200 210" role="img" aria-label="Play with Bots map with A right, B left, and both team spawns">
            <rect className="minimap-background" x="8" y="10" width="184" height="190" rx="4" />
            {MAP_AREAS.map(area => <polygon key={area.id} className={`map-region region-${area.tint}`}
              points={area.polygon.map(p => { const m=mapPoint(p.x,p.z); return `${m.x},${m.y}`; }).join(' ')} />)}
            {MAP_HOLES.map(hole => <polygon key={hole.id} className="map-courtyard-hole"
              points={hole.polygon.map(p => { const m=mapPoint(p.x,p.z); return `${m.x},${m.y}`; }).join(' ')} />)}
            {MAP_LABELS.map(item => {
              const p = mapPoint(item.x, item.z);
              return <text key={item.text} className="map-location-name" x={p.x} y={p.y - 5}>{item.text}</text>;
            })}
            {Object.entries(SITES).map(([name, site]) => {
              const p = mapPoint(site.x, site.z);
              return <g key={name}><circle className={`site-ring site-ring-${name}`} cx={p.x} cy={p.y} r="9.5" />
                <text className="site-text" x={p.x} y={p.y + 3}>{name}</text></g>;
            })}
            {hud.spikeSite && (() => {
              const p = mapPoint(SITES[hud.spikeSite].x, SITES[hud.spikeSite].z);
              return <circle className="map-spike-pulse" cx={p.x} cy={p.y} r="13" />;
            })()}
            {(hud.mapPlayers || []).map((player, i) => {
              const p = mapPoint(player.x, player.z);
              return <g key={`${player.name}-${i}`}>
                <circle className={player.team === hud.role ? 'map-dot-friendly' : 'map-dot-enemy'} cx={p.x} cy={p.y} r="2.8" />
                {player.id && player.id===hud.spikeCarrierId && <text x={p.x+3} y={p.y-5} className="map-carrier-icon">◆</text>}
              </g>;
            })}
            <g transform={`translate(${mapPoint(hud.mapPlayer?.x ?? SPAWNS.ATTACKERS.x, hud.mapPlayer?.z ?? SPAWNS.ATTACKERS.z).x}, ${mapPoint(hud.mapPlayer?.x ?? SPAWNS.ATTACKERS.x, hud.mapPlayer?.z ?? SPAWNS.ATTACKERS.z).y}) rotate(${(hud.mapPlayer?.yaw ?? 0) * 180 / Math.PI})`}>
              <path className="map-you" d="M0,-7 L4.7,4 L0,1.8 L-4.7,4 Z" />
            </g>
          </svg>
          <div className="minimap-footer"><span>BLUE: ALLIES</span><span>RED: ENEMIES</span></div>
        </div>
        <div className="kill-feed" aria-live="polite">
          {(hud.feed || []).map(entry => <div className={`feed-item ${entry.team === 'ATTACKERS' ? 'feed-attack' : 'feed-defend'}`} key={entry.id}>
            <b>{entry.killer}</b><span>✕</span><b>{entry.victim}</b>
          </div>)}
        </div>
        <div className={`mode-pill ${hud.mode === 'BUILD' ? 'is-building' : ''}`}><span>{hud.mode} MODE</span><b>{hud.mode === 'BUILD' ? `${hud.buildPiece} · ${hud.buildLayer || 0}m` : `${hud.targets} HOSTILES`}</b></div>
        <div className="crosshair" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="left-hud">
          <div className="player-card"><div className="player-mark">AF</div><div><strong>FIELD OPERATIVE</strong><small>{isOnline ? `ROOM ${activeRoom}` : gameMode === 'bots' ? 'PLAY WITH BOTS' : 'TRAINING DRILL'}</small></div></div>
          <div className="health-line"><span>HEALTH</span><strong>{hud.health}</strong></div>
          <div className="health-track"><span style={{ width: `${hud.health}%` }} /></div>
          <div className="build-readout"><span className="material-icon">◆</span><span>{gameMode==='arenaOnline'?'∞':hud.materials}</span><small>BUILD MATERIAL</small></div>
          <div className="agent-in-game"><span>OPERATIVE · {AGENTS[hud.agentId]?.name||AGENTS[selectedAgent].name}</span><strong>{AGENTS[hud.agentId]?.signature.name||AGENTS[selectedAgent].signature.name}</strong><small>{hud.abilityCooldown>0 ? `C · RECHARGING ${Math.ceil(hud.abilityCooldown)}S` : 'C · SIGNATURE READY'}</small></div>
          <div className="v12-kit-hud">
            <header><span>ABILITY LOADOUT</span><b>ARMOR {Math.round(hud.armor||0)}</b></header>
            <div className="v12-kit-slots">
              <div className={`v12-kit-slot ${(gameMode!=='arenaOnline'&&(hud.kitCharges?.q||0)===0)||(gameMode==='arenaOnline'&&(hud.kills||0)<3)?'is-empty':''}`}><strong>Q</strong><span>UTILITY 1</span><small>{gameMode==='arenaOnline' ? (hud.kills<3?`${3-(hud.kills||0)} MORE KILLS`:(hud.arenaCooldowns?.q||0)>Date.now()?`${Math.ceil((hud.arenaCooldowns.q-Date.now())/1000)}s`:'READY') : `× ${hud.kitCharges?.q||0}`}</small></div>
              <div className="v12-kit-slot"><strong>C</strong><span>SIGNATURE</span><small>{hud.abilityCooldown>0?`${Math.ceil(hud.abilityCooldown)}s`:'READY'}</small></div>
              <div className={`v12-kit-slot ${(gameMode!=='arenaOnline'&&(hud.kitCharges?.f||0)===0)||(gameMode==='arenaOnline'&&(hud.kills||0)<7)?'is-empty':''}`}><strong>F</strong><span>UTILITY 2</span><small>{gameMode==='arenaOnline' ? (hud.kills<7?`${7-(hud.kills||0)} MORE KILLS`:(hud.arenaCooldowns?.f||0)>Date.now()?`${Math.ceil((hud.arenaCooldowns.f-Date.now())/1000)}s`:'READY') : `× ${hud.kitCharges?.f||0}`}</small></div>
              <div className={`v12-kit-slot is-ultimate ${(gameMode==='arenaOnline'?(hud.kills||0)<12:(hud.ultimatePoints||0)<(AGENTS[hud.agentId||selectedAgent].ultimate.cost))?'is-empty':''}`}><strong>V</strong><span>ULTIMATE</span><small>{gameMode==='arenaOnline' ? (hud.kills<12?`${12-(hud.kills||0)} MORE KILLS`:(hud.arenaCooldowns?.ultimate||0)>Date.now()?`${Math.ceil((hud.arenaCooldowns.ultimate-Date.now())/1000)}s`:'READY') : `${hud.ultimatePoints||0}/${AGENTS[hud.agentId||selectedAgent].ultimate.cost}`}</small></div>
            </div>
          </div>
          <div className="kda-readout">ELIMS <b>{hud.kills || 0}</b><span> / </span> DEATHS <b>{hud.deaths || 0}</b></div>
        </div>
        <div className="right-hud">
          <div className="weapon-name">{hud.weapon}</div>
          <div className="ammo-row"><strong>{hud.ammo}</strong><span>/ {hud.reserve}</span></div>
          <div className="ammo-caption">AMMUNITION</div>
          <div className="weapon-slots"><span className="slot active">{WEAPONS[hud.weaponId]?.category || 'SIDEARM'}</span><span className="slot">B <small>BUILD</small></span></div>
          <div className="credits-row"><span>CREDITS</span><strong>₡ {hud.credits ?? STARTING_CREDITS}</strong></div>
          <button className="shop-hud-button" onClick={()=>{ document.exitPointerLock?.();setShowShop(true); }} disabled={!hud.canBuy}>M · BUY LOADOUT</button>
        </div>
        <div className="bottom-hint"><span className="keycap">W A S D</span> MOVE <span className="hint-gap"/><span className="keycap">SPACE</span> JUMP <span className="hint-gap"/><span className="keycap">B</span> BUILD <span className="hint-gap"/><span className="keycap">X / Z</span> BUILD HEIGHT <span className="hint-gap"/>{gameMode!=='arenaOnline'&&<><span className="keycap">E</span> OBJECTIVE <span className="hint-gap"/></>} <span className="hint-gap"/><span className="keycap">Q / F</span> UTILITIES <span className="hint-gap"/><span className="keycap">C</span> SIGNATURE <span className="hint-gap"/><span className="keycap">V</span> ULTIMATE <span className="hint-gap"/><span className="keycap">M</span> SHOP <span className="hint-gap"/><span className="keycap">R</span> RELOAD <span className="hint-gap"/><span className="keycap">ESC</span> MENU</div>
        {isOnline && !hasPlayedOnline && (['WAITING','AGENT_SELECT'].includes(hud.phase) || (hud.phase==='PRE_ROUND'&&!agentLocked&&!hud.agentLocked)) &&
          <AgentSelector selected={selectedAgent} onChoose={setSelectedAgent}
            onConfirm={lockOnlineAgent} locked={agentLocked||!!hud.agentLocked}
            phase={hud.phase==='WAITING'?'WAITING FOR PLAYERS':'AGENT SELECTION'}
            timer={hud.clock} error={agentError}
            onCancel={exitGame}
            note="Choose your operative before Round 1. Once locked, your choice stays active for the match." />}
        {isOnline && hasPlayedOnline && hud.phase === 'WAITING' && <div className="queue-overlay"><strong>WAITING FOR OPPONENT</strong><span>YOUR OPERATIVE IS SAVED · MATCH CONTINUES WHEN ANOTHER PLAYER JOINS</span><button onClick={exitGame}>LEAVE MATCH</button></div>}
        {showShop && <div className="armory-scrim" role="dialog" aria-label="Weapon buying shop" aria-modal="true">
          <div className="armory-panel">
            <div className="armory-heading"><div><small>ARMORY · ROUND {hud.round || 1}</small><h2>WEAPONS & ABILITIES</h2></div><button onClick={()=>setShowShop(false)} aria-label="Close armory">✕</button></div>
            <p className="armory-intro">{gameMode==='arenaOnline'?'Choose any weapon for free. Abilities unlock automatically from eliminations.':hud.canBuy?'Buy weapons before the round starts. Equipped gear resets each new round.':'Shop closed — view the catalog and return next buy phase.'} <strong>YOUR CREDITS: ₡ {hud.credits ?? STARTING_CREDITS}</strong></p>
            <div className="armory-grid">
              {WEAPON_LIST.map(id=>{const w=WEAPONS[id];const selected=hud.weaponId===id;const affordable=gameMode==='arenaOnline'||(hud.credits??0)>=w.price;
                return <button key={id} className={`armory-item ${selected?'equipped':''}`} disabled={!hud.canBuy||selected||!affordable}
                  onClick={()=>gameControllerRef.current?.buyWeapon(id)}>
                  <span className="armory-category">{w.category}</span>
                  <strong>{w.name}</strong><small>{w.description}</small>
                  <div className="armory-stats"><span>DMG {w.id==='shotgun'?`${w.damage}×${w.pellets}`:w.damage}</span><span>MAG {w.magazine}</span></div>
                  <span className="armory-price">{selected?'EQUIPPED':gameMode==='arenaOnline'||w.price===0?'FREE':`₡ ${w.price.toLocaleString()}`}</span>
                </button>;
              })}
            </div>
            {gameMode!=='arenaOnline'&&<><h3 className="armory-abilities-heading">{AGENTS[hud.agentId||selectedAgent].name} · PURCHASABLE ABILITIES</h3>
            <div className="armory-utility-grid">
              {(['q','f']).map(slot=>{
                const kit=AGENTS[hud.agentId||selectedAgent];
                const ability=kit[slot==='q'?'utility1':'utility2'];
                const owned=hud.kitCharges?.[slot]||0;
                const maxed=owned>=ability.max;
                const affordable=(hud.credits||0)>=ability.price;
                return <button key={slot} className="armory-utility" disabled={!hud.canBuy||maxed||!affordable} onClick={()=>gameControllerRef.current?.buyAbility(slot)}>
                  <small>{slot.toUpperCase()} · {slot==='q'?'UTILITY 1':'UTILITY 2'}</small>
                  <strong>{ability.name}</strong>
                  <em>{ability.description}</em>
                  <b>{maxed?'CHARGES FULL':`₡ ${ability.price}`} · {owned}/{ability.max} OWNED</b>
                </button>;
              })}
            </div>
            </>}
            <div className="armory-bottom"><span>{hud.phase==='PRE_ROUND'?'BUY PHASE · '+hud.clock+' REMAINING':'CLOSE SHOP TO RESUME'}</span><button onClick={()=>setShowShop(false)}>CLOSE SHOP · M</button></div>
          </div>
        </div>}
        {gameMode==='arenaOnline'&&hud.health<=0&&<div className="round-overlay"><strong>ELIMINATED</strong><span>RESPAWNING IN {Math.max(0,Math.ceil(((hud.respawnAt||0)-Date.now())/1000))} SECONDS</span></div>}
        <div className="damage-overlay" style={{opacity: Math.min(0.55, (hud.damageFlash || 0) * 1.6)}} />
        {hud.flashRemaining>0&&<div className="flash-overlay" role="status">DISORIENTED · {hud.flashRemaining.toFixed(1)}s</div>}
        {hud.roundResult && <div className="round-overlay"><strong>{hud.roundResult}</strong><span>{hud.phase === 'MATCH_OVER' ? 'MATCH FINISHED · REMATCH STARTING' : 'ROUND COMPLETE · NEXT ROUND STARTING'}</span></div>}
        {isOnline && hud.phase === 'PRE_ROUND' && <div className="queue-overlay">
          <strong>{hud.phase === 'WAITING' ? 'SELECT AGENTS' : `ROUND ${hud.round || 1} STARTING`}</strong>
          <span>{hud.phase === 'WAITING' ? `${onlineCount} / 2 MINIMUM PLAYERS · AUTOMATIC MATCH` : `${hud.clock} TO BUY · PRESS M TO OPEN ARMORY`}</span>
          <small>{gameMode === 'onlineQuick' ? 'QUICK PLAY · WEAPON BUY PHASE · NO MID-ROUND RESPAWNS' : `PRIVATE ROOM · ${activeRoom}`}</small>
          <button onClick={exitGame}>LEAVE MATCH</button>
        </div>}
        {hud.respawn > 0 && <div className="respawn-overlay"><b>ELIMINATED</b><span>RESPAWN IN {Math.ceil(hud.respawn)}S</span></div>}
        {isOnline && hud.health <= 0 && ['CARRIED','PLANTED'].includes(hud.phase) && <div className="respawn-overlay"><b>ELIMINATED</b><span>NO RESPAWN UNTIL NEXT ROUND</span></div>}
        {hud.message && <div className="toast-message">{hud.message}</div>}
        <button className="exit-button" onClick={exitGame}>ESC · MENU</button>
      </main>
    );
  }

  return (
    <main className="menu-shell menu-shell-v7">
      <div className="menu-backdrop"><div className="backdrop-grid"/><div className="backdrop-orb orb-one"/><div className="backdrop-orb orb-two"/><div className="backdrop-slab slab-one"/><div className="backdrop-slab slab-two"/></div>
      <header className="brand-bar"><div className="brand"><div className="brand-symbol">A<span>F</span></div><div><strong>ARENA FORGE</strong><small>THREE TACTICAL MAPS + BUILD ARENA · REAL 3D OPERATIVES</small></div></div><div className="build-tag">PRE-ALPHA <span>14.0</span></div></header>
      <section className="menu-content">
        <div className="eyebrow"><span className="eyebrow-line"/> IRONVEIL FOUNDRY / DAYLIGHT URBAN DISTRICT <span className="eyebrow-line"/></div>
        <h1>HOLD THE SITE.<br/><em>BUILD THE FIGHT.</em></h1>
        <p className="menu-copy">Real skinned characters with Mixamo animations, five operative kits and three rotating multiplayer maps. Foundry Heights, Canal Exchange and Triad Atrium.</p>

        <div className="v13-map-select"><span>MAP ROTATION · Quick Play chooses the next map automatically. Private rooms and bots can select a map.</span>
          <div className="v13-map-buttons">{MAP_IDS.map((id,i)=><button key={id} type="button" className={selectedMapId===id?'active':''}
            onClick={()=>{selectActiveMap(id);setSelectedMapId(id);}}>{i===0?'01 · FOUNDRY HEIGHTS':i===1?'02 · CANAL EXCHANGE':'03 · TRIAD ATRIUM (A/B/C)'}</button>)}</div>
        </div>
        <p className="mode-note">Select your side for bots. Quick Play assigns teams automatically.</p>
        <div className="role-row">
          <span className="role-row-label">YOUR SIDE</span>
          <button className={`role-button ${selectedRole === 'attack' ? 'active' : ''}`} onClick={() => setSelectedRole('attack')}>ATTACKERS</button>
          <button className={`role-button ${selectedRole === 'defend' ? 'active' : ''}`} onClick={() => setSelectedRole('defend')}>DEFENDERS</button>
        </div>

        <div className="menu-actions">
          <button className="primary-button quickplay-button" onClick={() => connectRoom(false, true)} disabled={connecting}><span>{connecting ? 'FINDING SERVER…' : 'QUICK PLAY'}</span><b>↗</b></button>
          <button className="primary-button" onClick={() => {setPendingMode('arena');setAgentError('');}}><span>BUILD ARENA · FREE FOR ALL</span><b>↗</b></button>
          <button className="secondary-button" onClick={() => {setPendingMode('bots');setAgentError('');}}><span>PLAY WITH BOTS</span><b>↗</b></button>
          <button className="secondary-button" onClick={() => setShowDrills((v) => !v)}>DRILLS <span>{showDrills ? '−' : '＋'}</span></button>
          <button className="secondary-button" onClick={() => setShowOnline((v) => !v)}>PRIVATE ROOM <span>{showOnline ? '−' : '＋'}</span></button>
          <button className="secondary-button" onClick={() => setShowHelp((v) => !v)}>HOW TO PLAY <span>{showHelp ? '−' : '＋'}</span></button>
          <button className="text-button" onClick={() => setShowSettings((v) => !v)}>SETTINGS</button>
        </div>
        {networkError && <div className="info-panel multiplayer-error"><strong>CONNECTION</strong><p>{networkError}</p></div>}

        {showDrills && (
          <div className="info-panel nested-panel">
            <strong>DRILLS</strong>
            <p>Focused objective practice. Attacker Drill always places you on attack; Defender Drill always places you on defence.</p>
            <div className="subaction-row">
              <button className="primary-button compact-button" onClick={() => setPendingMode('attackDrill')}><span>ATTACKER DRILL</span><b>↗</b></button>
              <button className="secondary-button compact-button" onClick={() => setPendingMode('defendDrill')}>DEFENDER DRILL <span>↗</span></button>
            </div>
          </div>
        )}

        {showOnline && (
          <div className="info-panel multiplayer-panel">
            <strong>PRIVATE ONLINE</strong>
            <p>The server is already fixed to <b>forlornant.onrender.com</b>. Create a room, or enter a code to join one.</p>
            <label>
              <span>ROOM CODE</span>
              <input className="multiplayer-input" value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="ENTER ROOM CODE" maxLength={8} />
            </label>
            <div className="multiplayer-actions">
              <button className="primary-button compact-button" onClick={() => connectRoom(true, false)} disabled={connecting}><span>{connecting ? 'CONNECTING' : 'CREATE ROOM'}</span><b>↗</b></button>
              <button className="secondary-button compact-button" onClick={() => connectRoom(false, false)} disabled={connecting || !roomCode.trim()}>JOIN ROOM <span>↗</span></button>
            </div>
            {networkError && <p className="multiplayer-error">{networkError}</p>}
          </div>
        )}

        {showHelp && (
          <div className="info-panel">
            <strong>HOW TO PLAY</strong>
            <p><b>Quick Play:</b> automatically pair up with another player, wait for a short pre-round countdown, and play first to 5 round wins with a halftime side swap. Buy equipment during each 22-second preparation phase with M. Credits are earned from results and eliminations; weapons reset each round.</p><p><b>Play with Bots:</b> you and four friendly bots face five enemies. Bots pathfind around walls, shoot, reload, push sites, plant/retake, and respawn in this casual mode. The score updates each round.</p><p><b>Drills:</b> focused spike practice; bots do not respawn until the next round.</p>
            <p><b>Build Arena:</b> open free-for-all building, respawns, unlimited build materials, live K/D leaderboard, and Q/F/V abilities earned through kills and reused after cooldowns.</p><p><b>Controls:</b> WASD move, Shift sprint, Space jump, mouse aim, left click shoot/place, B build mode, 1–4 build pieces, X/Z change build height, R reload, E plant or defuse, M buy menu, Esc menu.</p>
          </div>
        )}

        {showSettings && (
          <div className="info-panel settings-panel">
            <strong>SETTINGS</strong>
            <label>
              <span>Bot difficulty</span>
              <select className="difficulty-select" value={botDifficulty} onChange={event => setBotDifficulty(event.target.value)}>
                <option value="rookie">ROOKIE</option>
                <option value="standard">STANDARD</option>
                <option value="veteran">VETERAN</option>
              </select>
            </label>
            <label>
              <span>Mouse sensitivity</span>
              <input type="range" min="0.001" max="0.004" step="0.0001" value={sensitivity} onChange={(event) => setSensitivity(Number(event.target.value))} />
            </label>
            <label>
              <span>Field of view</span>
              <input type="range" min="65" max="100" step="1" value={fov} onChange={(event) => setFov(Number(event.target.value))} />
            </label>
          </div>
        )}
      </section>
      <footer className="menu-footer"><span>V13 · REAL FBX CHARACTERS · THREE MAPS · ULTIMATES · MULTI-LEVEL BUILDING</span><span>Q/F UTILITIES · C SIGNATURE · V ULTIMATE</span></footer>
    </main>
  );
}

export default App;
