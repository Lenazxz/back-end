import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { AGENTS, AGENT_IDS } from './game/agents.js';
import { attachAgentModel, animateAgent } from './game/agent-models.js';

function AgentPreview({ agentId }) {
  const mount=useRef(null);
  useEffect(()=>{
    const host=mount.current;
    if(!host)return undefined;
    let cancelled=false,frame=0;
    const scene=new THREE.Scene();scene.background=new THREE.Color('#263039');
    const camera=new THREE.PerspectiveCamera(32,1,.1,40);
    camera.position.set(0,1.45,-5.0);camera.lookAt(0,1.23,0);
    const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'low-power'});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.25));
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.24;
    host.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight('#f2f2e9','#3b4552',2.2));
    const key=new THREE.DirectionalLight('#ffcfac',2.4);key.position.set(-4,6,-5);scene.add(key);
    const rim=new THREE.DirectionalLight('#8bd5e2',1.2);rim.position.set(4,4,6);scene.add(rim);
    const floor=new THREE.Mesh(new THREE.CylinderGeometry(1.35,1.5,.12,48),new THREE.MeshStandardMaterial({color:'#303a42',metalness:.35,roughness:.69}));
    floor.position.y=-.07;scene.add(floor);
    const root=new THREE.Group();scene.add(root);
    attachAgentModel(root,agentId,{preview:true,isDisposed:()=>cancelled})
      .catch(error=>console.warn('Character preview unavailable',error));
    const clock=new THREE.Clock();
    const resize=()=>{
      const w=Math.max(90,host.clientWidth),h=Math.max(90,host.clientHeight);
      camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);
    };
    resize();const observer=new ResizeObserver(resize);observer.observe(host);
    const loop=()=>{
      if(cancelled)return;
      frame=requestAnimationFrame(loop);
      const dt=Math.min(.04,clock.getDelta());
      root.rotation.y+=dt*.23;
      animateAgent(root,dt,.56);
      renderer.render(scene,camera);
    };loop();
    return ()=>{
      cancelled=true;cancelAnimationFrame(frame);observer.disconnect();
      root.clear();floor.geometry.dispose();floor.material.dispose();renderer.dispose();renderer.domElement.remove();
    };
  },[agentId]);
  return <div className="agent-preview-canvas" ref={mount} aria-label={`${AGENTS[agentId].name} 3D character preview`}/>;
}

const SLOT_ICONS={passive:'◈',utility1:'◆',signature:'➤',utility2:'✦',ultimate:'★'};
function AbilityCard({type,ability}){
  const marker=type==='passive'?'PASSIVE':type==='signature'?'SIGNATURE':type==='ultimate'?'ULTIMATE':type==='utility1'?'BUYABLE 1':'BUYABLE 2';
  const price=ability.price!==undefined?`₡ ${ability.price} · ${ability.max} MAX`:type==='ultimate'?`${ability.cost} ULT POINTS`:type==='signature'?`${ability.cooldown}S COOLDOWN`:'ALWAYS ACTIVE';
  return <div className={`v12-kit-card kit-${type}`}>
    <div className="v12-kit-symbol">{SLOT_ICONS[type]}</div>
    <div className="v12-kit-description">
      <small>{marker} {ability.key&&<b>[{ability.key}]</b>}</small>
      <strong>{ability.name}</strong>
      <p>{ability.description}</p>
      <em>{price}</em>
    </div>
  </div>;
}

export default function AgentSelector({selected,onChoose,onConfirm,locked=false,confirmLabel='LOCK IN',phase='OPERATIVE SELECT',timer='',onCancel,error='',note=''}){
  const agent=AGENTS[selected]||AGENTS.rift;
  return <div className="agent-select-scrim v12-agent-selector" role="dialog" aria-modal="true" aria-label="Choose your operative">
    <div className="agent-select-shell v12-selector-shell">
      <header className="agent-select-header"><div><small>ARENA FORGE · THREE-MAP ROTATION · VERSION 13</small><h2>CHOOSE YOUR OPERATIVE</h2><p>{note||'One passive, a free signature, two purchasable utilities and an earned ultimate.'}</p></div><div className="agent-select-phase">{phase}<strong>{timer||'PREPARE'}</strong></div></header>
      <div className="agent-select-body v12-selector-body">
        <nav className="agent-card-list v12-character-list" aria-label="Choose playable character">
          {AGENT_IDS.map(id=>{
            const item=AGENTS[id];
            return <button key={id} disabled={locked} className={`agent-choice ${selected===id?'is-selected':''}`}
              style={{'--agent-accent':item.color}} onClick={()=>onChoose(id)}>
              <span className="agent-choice-letter">{item.name[0]}</span><span><small>{item.role}</small><strong>{item.name}</strong><em>{item.title}</em></span>
              <span className="agent-choice-arrow">{selected===id?'◆':'›'}</span>
            </button>;
          })}
        </nav>
        <section className="agent-preview-pane v12-preview-pane" style={{'--agent-accent':agent.color}}>
          <div className="agent-preview-caption">TACTICAL OPERATIVE <span>REAL MIXAMO FBX · SKINNED</span></div>
          <AgentPreview agentId={selected}/>
          <div className="agent-preview-ground"><strong>{agent.name}</strong><span>{agent.role} / {agent.title}</span></div>
          <p className="v12-agent-bio">{agent.description}</p>
        </section>
        <section className="agent-ability-pane v12-ability-pane" style={{'--agent-accent':agent.color}}>
          <small className="agent-kit-eyebrow">FIVE-PART OPERATIVE KIT</small>
          <h3>{agent.name}'S ABILITIES</h3>
          <div className="v12-kit-list">
            <AbilityCard type="passive" ability={agent.passive}/>
            <AbilityCard type="utility1" ability={agent.utility1}/>
            <AbilityCard type="signature" ability={agent.signature}/>
            <AbilityCard type="utility2" ability={agent.utility2}/>
            <AbilityCard type="ultimate" ability={agent.ultimate}/>
          </div>
          <div className="agent-kit-bottom"><span>{error||(locked?'OPERATIVE LOCKED IN · READY':'CHOOSE AND CONFIRM YOUR OPERATIVE')}</span>
            <button className="agent-confirm-button" onClick={onConfirm} disabled={locked}>{locked?'LOCKED ✓':confirmLabel}</button>
            {onCancel&&<button className="agent-cancel-button" onClick={onCancel}>BACK TO MENU</button>}
          </div>
        </section>
      </div>
    </div>
  </div>;
}
