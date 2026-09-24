import {desktop} from './desktop.mjs';
import {MODULES,EFFECT_VALUES,PRESET_CCS,SafeMidi,LiveEditQueue,MidiFeedback,isChroma,isChromaPort,programLabel,parseLibrary,serializeLibrary,validatePreset} from './protocol.mjs';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const SIMULATOR = new URLSearchParams(location.search).get('demo') === '1';
const LIBRARY_KEY = SIMULATOR ? 'chroma-studio-demo-v1' : 'chroma-studio-library-v1';
const storage = desktop?.storage ?? (SIMULATOR ? sessionStorage : localStorage);
let desktopReady = false;
const midi = new SafeMidi(recordSend);
const feedback = new MidiFeedback(()=>midi.channel,receiveControl,recordInput);
let access = null, draft = {name:'',notes:'',baseProgram:null,values:{}}, library = [], bank = 0, recalled = null;
let sendCount = 0, busy = false, cancelToken = 0, lastTap = 0, tapIntervals = [], toastTimer, removed = null;
let engaged=null, inputCount=0, inputClock=0, inputControls=0, inputIgnored=0, lastClockAt=0, autoSelect=true, logFilter='all';
const logs = [], ranges = new Map();
const recentSends = new Map();
const pendingControls = new Set();
let pendingBase = false, loadedPreset = false;
let renderedApplyState = '';
const liveEdits = new LiveEditQueue((cc,value)=>midi.cc(cc,value),(cc,value)=>{
  if(draft.values[cc]===value)pendingControls.delete(cc);
  updateConnection();
},fail);
const effectHints = {
  Drive:'Warm drive, from subtle breakup to overdrive.', Sweeten:'Compression and saturation for a little extra color.', Fuzz:'Expressive fuzz; explore Tilt for different voicings.', Howl:'Resonant filter fuzz with a synth-like edge.', Swell:'Envelope-triggered swells; sensitivity sets response.',
  Doubler:'Stereo doubling, from tight pairs to short echoes.', Vibrato:'Pitch modulation with variable depth and drift.', Phaser:'Sweeping phase modulation with an evolving character.', Tremolo:'Amplitude modulation, from gentle pulses to hard chops.', Pitch:'Continuous pitch shifts; Rate centers at unison.',
  Cascade:'Analog-style delay. High Amount can self-oscillate.', Reels:'Tape-style echo. High Amount can self-oscillate.', Space:'Reverb, from small rooms to long, sustaining clouds.', Collage:'Looping delay. High Amount can self-oscillate.', Reverse:'Reverse delay; Time changes playback speed and pitch.',
  Filter:'Choose a filter style below; Amount sets its cutoff.', Squash:'Compression and drive that build with Amount.', Cassette:'Tape-inspired saturation, filtering and instability.', Broken:'Pitch dips, wobble and mechanical misbehavior.', Interference:'Signal degradation and musical disturbance.', Off:'This module is off. Choose an effect to bring it back.'
};
function notice(message,error=false){const element=$('#notice');element.textContent=error?message:'';element.classList.toggle('error',error);element.hidden=!error;}
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4200);}
function guarded(fn){return (...args)=>{try{const p=fn(...args);if(p?.catch)return p.catch(fail);return p;}catch(e){fail(e);}};}
function fail(e){notice(e.message || String(e),true);toast(e.message || String(e));updateConnection();}
const controlNames = new Map(MODULES.flatMap(module=>[[module.cc,`${module.name} effect`],...module.controls.map(([label,cc])=>[cc,`${module.name} ${label.toLowerCase()}`])]));
for(const [cc,name] of [[70,'Master mix'],[78,'Output level'],[80,'Gesture'],[81,'Erase gesture'],[82,'Capture'],[83,'Capture position'],[84,'Filter style'],[91,'Engage'],[92,'Dual bypass'],[93,'Tap tempo'],[94,'Input headroom'],[95,'Calibration'],[103,'Character bypass'],[104,'Movement bypass'],[105,'Diffusion bypass'],[106,'Texture bypass']])controlNames.set(cc,name);
function logMessage(direction,bytes){
  const type=bytes[0]&0xf0;
  logs.unshift({time:new Date().toLocaleTimeString([], {hour12:false}),direction,channel:(bytes[0]&15)+1,name:type===0xb0?(controlNames.get(bytes[1])||'Control change'):'Preset recall',message:type===0xb0?`CC ${bytes[1]}`:`PC ${bytes[1]}`,value:type===0xb0?String(bytes[2]):programLabel(bytes[1])});
  logs.length=Math.min(logs.length,100);renderLog();
}
function renderLog(){
  const target=$('#log');target.replaceChildren();
  const visible=logs.filter(entry=>logFilter==='all'||entry.direction.toLowerCase()===logFilter);
  if(!visible.length){const empty=document.createElement('div');empty.className='log-empty';empty.textContent=logFilter==='all'?'No control activity yet.':`No ${logFilter==='in'?'received':'sent'} controls.`;target.append(empty);return;}
  for(const entry of visible){
    const row=document.createElement('div');row.className='log-row';
    const time=document.createElement('span');time.textContent=entry.time;
    const direction=document.createElement('span');direction.className=`log-direction ${entry.direction.toLowerCase()}`;direction.textContent=entry.direction==='OUT'?'↗ SENT':'↙ IN';
    const name=document.createElement('span');name.className='log-name';name.textContent=entry.name;
    const message=document.createElement('small');message.textContent=entry.message;name.append(message);
    const value=document.createElement('span');value.textContent=entry.value;
    const channel=document.createElement('span');channel.textContent=`CH ${entry.channel}`;
    row.append(time,direction,name,value,channel);target.append(row);
  }
}
function renderActivity(){
  $('#send-count').textContent=`OUT ${sendCount} · IN ${inputControls}`;
  $('#monitor-count').textContent=`${sendCount+inputControls} control messages`;
  $('#sent-total').textContent=sendCount.toLocaleString();$('#received-total').textContent=inputControls.toLocaleString();
  $('#input-status').textContent=feedback.port?`${feedback.port.name} · channel ${midi.channel}`:'Not connected';
  renderClock();
}
function renderClock(){
  const active=Boolean(feedback.port&&lastClockAt&&performance.now()-lastClockAt<2500);
  const state=active?'Receiving':feedback.port?'No signal':'Not connected';
  if($('#clock-state').textContent!==state){$('#clock-state').textContent=state;$('#clock-state').classList.toggle('active',active);}
  // Background clock is not a control event. Only update its counter when requested.
  if($('#clock-details').open){$('#clock-count').textContent=inputClock.toLocaleString();$('#ignored-count').textContent=inputIgnored.toLocaleString();}
}
function recordSend(bytes){
  sendCount++;recentSends.set(bytes.join(','),performance.now());
  for(const [key,time] of recentSends)if(performance.now()-time>1000)recentSends.delete(key);
  logMessage('OUT',bytes);renderActivity();
  if((bytes[0]&15)!==midi.channel-1)return;
  if(bytes[1]===91&&(bytes[0]&0xf0)===0xb0)setEngaged(bytes[2]>=64);
  if(bytes[1]===92&&(bytes[0]&0xf0)===0xb0)setEngaged(bytes[2]<32?false:bytes[2]>=64?true:null);
  if((bytes[0]&0xf0)===0xc0)setEngaged(null);
}
function recordInput(bytes,message){
  inputCount++;
  if(bytes.length===1&&bytes[0]===0xf8){inputClock++;lastClockAt=performance.now();return;}
  if(message){inputControls++;logMessage('IN',bytes);renderActivity();}
  else inputIgnored++;
}
function setEngaged(value){
  engaged=value;const toggle=$('#engage');
  toggle.setAttribute('aria-pressed',value===null?'mixed':String(value));
  toggle.dataset.state=value===null?'unknown':value?'on':'off';
  $('#engage-label').textContent=value===null?'—':value?'On':'Off';
  toggle.title=value===null?'State not reported; click to engage':`Last set to ${value?'engaged':'bypassed'}; click to ${value?'bypass':'engage'}`;
}
function receiveControl(message,bytes){
  // Ignore immediate MIDI loopback; receiving never sends a response.
  const sentAt=recentSends.get(bytes.join(','));
  if(sentAt!==undefined&&performance.now()-sentAt<1000)return;
  if(message.type==='program'){
    cancelToken++;recalled=message.program;bank=Math.floor(recalled/20);resetDraft(recalled);setEngaged(null);renderBanks();return;
  }
  const {cc,value}=message;
  if(PRESET_CCS.includes(cc)){draft.values[cc]=value;pendingControls.delete(cc);liveEdits.delete(cc);renderValues();}
  else if(cc===91)setEngaged(value>=64);
  else if(cc===92)setEngaged(value<32?false:value>=64?true:null);
  else if(cc>=103&&cc<=106){
    const module=MODULES.find(m=>m.bypass===cc);
    $$(`.${module.key} .module-bypass button`).forEach(button=>button.classList.toggle('selected',Number(button.dataset.action.split(':')[1])===(value>=64?127:0)));
  }
}
function updateConnection(){
  const connected=midi.port?.state==='connected';
  $('#status').textContent=connected?'Connected · Live':'Not connected';
  $('#connection-pill').classList.toggle('connected',connected);
  $('#connection-note').textContent=connected?`${midi.port.name}`:'Connect your Chroma Console';
  $('#status-dot').style.background=midi.armed?'#aed4ab':connected?'#cfb45c':'#888a7e';
  $('#connect').textContent=access?'Refresh ports':'Connect MIDI';
  $$('[data-live]:not(#apply)').forEach(el=>{const disabled=!midi.armed||busy;if(el.disabled!==disabled)el.disabled=disabled;});
  const pending=pendingBase||[...pendingControls].some(cc=>!liveEdits.has(cc));
  const applyState=`${pending}:${midi.armed}:${busy}:${loadedPreset}`;
  if(applyState!==renderedApplyState){
    renderedApplyState=applyState;
    const button=$('#apply'),label=$('#apply-label');
    const disabled=!midi.armed||busy||!pending;
    const text=loadedPreset?'Apply loaded preset':'Apply unsent edits';
    if(button.hidden!==!pending)button.hidden=!pending;
    if(button.disabled!==disabled)button.disabled=disabled;
    if(label.textContent!==text)label.textContent=text;
  }
  $$('[data-edit], [data-cc]').forEach(el=>el.disabled=busy);
  $('#blank').disabled=busy;$('#ports').disabled=busy;$('#channel').disabled=busy;
}
function disconnectPedal(){cancelToken++;midi.disconnect();feedback.disconnect();lastClockAt=0;liveEdits.clear();recentSends.clear();setEngaged(null);updateConnection();renderActivity();}
function queueDraft(){liveEdits.clear();pendingControls.clear();Object.keys(draft.values).forEach(cc=>pendingControls.add(Number(cc)));pendingBase=draft.baseProgram!==null;}
function selectOutput(port){
  if(midi.port&&midi.port.id!==port.id)queueDraft();
  cancelToken++;liveEdits.clear();recentSends.clear();setEngaged(null);
  midi.connect(port);midi.arm();bindInput();updateConnection();
}
function bindInput(){
  if(SIMULATOR)return;
  const available=access?[...access.inputs.values()].filter(p=>isChromaPort(p,'input')&&p.state==='connected'):[];
  const matching=available.filter(p=>p.name===midi.port?.name&&p.manufacturer===midi.port?.manufacturer);
  const candidates=matching.length?matching:available;
  const port=midi.port&&candidates.length===1?candidates[0]:null;
  if(port)feedback.connect(port);else{feedback.disconnect();lastClockAt=0;}renderActivity();
}
function refreshPorts(){
  const previous=midi.port?.id, ports=[...access.outputs.values()].filter(p=>isChroma(p)&&p.state==='connected');
  const select=$('#ports');select.replaceChildren(new Option(ports.length?'Select Chroma output…':'No Chroma Console found',''));
  ports.forEach(p=>select.add(new Option(p.name,p.id)));
  if(previous&&ports.some(p=>p.id===previous)){select.value=previous;}
  else if(previous){disconnectPedal();notice('Pedal disconnected. Live control resumes when it reconnects.');}
  if(!midi.port&&ports.length===1&&autoSelect){selectOutput(ports[0]);select.value=ports[0].id;notice('Connected. Live control is on.');}
  bindInput();updateConnection();
}
async function connect(){
  if(SIMULATOR){selectOutput({id:'simulator',type:'output',name:'Simulated Chroma Console',state:'connected',send:()=>{}});feedback.connect(simulatedInput);$('#ports').replaceChildren(new Option('SIMULATOR — no hardware','simulator'));renderActivity();notice('Simulator connected · live control on. No hardware access.');return;}
  if(!desktop&&!navigator.requestMIDIAccess)throw new Error('Web MIDI is unavailable. Open this local editor in Google Chrome or Microsoft Edge.');
  autoSelect=true;
  if(!access){access=desktop?await desktop.requestMIDIAccess():await navigator.requestMIDIAccess({sysex:false});access.onstatechange=guarded(refreshPorts);}else if(desktop){await desktop.refresh();}
  refreshPorts();
  notice(midi.port?'Connected. Live control is on. Move a control to play.':'No matching output. Check the pedal’s power and USB data cable, then refresh ports.');
}
function makeControl(label,cc,context){
  const wrap=document.createElement('div');wrap.className='control unknown';
  const name=`${context} ${label}`, id=`cc-${cc}`;
  wrap.innerHTML=`<div class="control-head"><label for="${id}">${label}</label><input type="number" id="number-${cc}" aria-label="${name} value" min="0" max="127" step="1" placeholder="—" data-edit></div><input type="range" id="${id}" aria-label="${name}" min="0" max="127" step="1" value="64" data-edit><div class="control-meta"><span>0</span><span>127</span></div>`;
  const range=wrap.querySelector('[type=range]'),number=wrap.querySelector('[type=number]');
  const update=guarded((value,force)=>{if(value==='')return;const n=Number(value);if(!Number.isInteger(n)||n<0||n>127)throw new Error('Control values range from 0 to 127.');return setValue(cc,n,force);});
  range.addEventListener('input',()=>update(range.value,false));range.addEventListener('change',()=>update(range.value,true));
  number.addEventListener('input',()=>{if(number.value!==''&&number.checkValidity())update(number.value,false);});
  number.addEventListener('change',()=>{if(number.value===''){liveEdits.delete(cc);delete draft.values[cc];pendingControls.delete(cc);renderValues();return;}if(!number.checkValidity()){renderValues();toast('Use a whole number from 0 to 127.');return;}update(number.value,true);});
  ranges.set(cc,{wrap,range,number});return wrap;
}
function buildModules(){
  MODULES.forEach(module=>{
    const card=document.createElement('article');card.className=`module ${module.key}`;
    const visuals={character:['M3 17V7h6v10h6V7h6','Dynamics & colour'],movement:['M2 12c4-16 6 16 10 0s6 16 10 0','Pitch & motion'],diffusion:['M3 6h18M5 12h14M8 18h8','Time & space'],texture:['M3 17 7 8l4 7 4-11 3 12 3-5','Tone & texture']};
    const [path,description]=visuals[module.key];
    const top=document.createElement('div');top.className='module-heading';top.innerHTML=`<span class="module-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${path}"/></svg></span><div><h2>${module.name}</h2><small>${description}</small></div>`;card.append(top);
    card.append(makeChoices(`effect-${module.cc}`,`${module.name} effect`,module.cc,[...module.effects,'Off'].map((name,i)=>[name,EFFECT_VALUES[i]])));
    module.controls.forEach(([label,cc],i)=>{if(i===(module.key==='texture'?1:2)){const divider=document.createElement('div');divider.className='secondary-divider';divider.textContent='SECONDARY';card.append(divider);}card.append(makeControl(label,cc,module.name));});
    if(module.key==='texture'){
      const style=document.createElement('div');style.className='control filter-control';
      const label=document.createElement('span');label.className='choice-label';label.textContent='Filter style';style.append(label);
      style.append(makeChoices('filter-mode','Filter style',84,[['Low-pass',0],['Tilt',64],['High-pass',127]],'compact-choices'));card.append(style);
    }
    const hint=document.createElement('p');hint.className='module-hint';hint.id=`hint-${module.cc}`;hint.textContent='Choose an effect to shape this module.';card.append(hint);
    const controls=document.createElement('div');controls.className='module-bypass';controls.hidden=true;controls.innerHTML=`<button data-action="${module.bypass}:127" data-live aria-label="Engage ${module.name}">Engage module</button><button data-action="${module.bypass}:0" data-live aria-label="Bypass ${module.name}">Bypass</button>`;card.append(controls);
    $('#modules').append(card);
  });
  $('#master-controls').append(makeControl('Mix',70,'Master'),makeControl('Output level',78,'Master'));
}
function makeChoices(id,label,cc,options,className='effect-options'){
  const group=document.createElement('div');group.id=id;group.className=className;group.setAttribute('role','radiogroup');group.setAttribute('aria-label',label);
  options.forEach(([name,value])=>{
    const choice=document.createElement('label');choice.className='effect-choice';if(name==='Off')choice.classList.add('off-choice');
    const input=document.createElement('input');input.type='radio';input.name=id;input.value=String(value);input.dataset.edit='';input.setAttribute('aria-label',name);
    input.addEventListener('change',guarded(()=>{if(input.checked)return setValue(cc,value,true);}));
    const text=document.createElement('span');text.textContent=name;
    const mark=document.createElement('span');mark.className='choice-check';mark.setAttribute('aria-hidden','true');mark.textContent='✓';
    choice.append(input,text,mark);group.append(choice);
  });return group;
}
function renderChoices(id,value){
  $$(`#${id} input`).forEach(input=>{input.checked=value!==undefined&&Number(input.value)===value;});
}
function setValue(cc,value,force=false){
  draft.values[cc]=value;pendingControls.add(cc);
  if(midi.armed&&!busy)liveEdits.set(cc,value,force);
  else liveEdits.delete(cc);
  renderValues();
}
function renderValues(){
  for(const [cc,{wrap,range,number}] of ranges){const value=draft.values[cc];wrap.classList.toggle('unknown',value===undefined);range.value=value??64;range.style.setProperty('--progress',`${(value??64)/127*100}%`);range.setAttribute('aria-valuetext',value===undefined?'Unknown; move to set a value':String(value));number.value=value??'';}
  for(const module of MODULES){const value=draft.values[module.cc],idx=value===undefined?-1:Math.min(5,Math.floor(value/22));renderChoices(`effect-${module.cc}`,idx===-1?undefined:EFFECT_VALUES[idx]);$(`#hint-${module.cc}`).textContent=idx===-1?'Choose an effect to shape this module.':effectHints[[...module.effects,'Off'][idx]];}
  const route=draft.values[83],filter=draft.values[84];
  $('#capture-route').value=route===undefined?'':String(route<64?0:127);
  renderChoices('filter-mode',filter===undefined?undefined:filter<44?0:filter<88?64:127);
  updateConnection();persistSession();
}
function resetDraft(base=null){pendingControls.clear();pendingBase=false;loadedPreset=false;draft={name:'',notes:'',baseProgram:base,values:{}};$('#preset-name').value='';$('#preset-notes').value='';liveEdits.clear();renderValues();}
function selectBank(value){bank=value;renderBanks();persistSession();}
// Each bank has five LED colours, each with four cursor positions (manual pp. 31, 49).
const slotGroups=[['Red','#ff8977'],['Yellow','#f4ce69'],['Green','#8bd88b'],['Blue','#6dd8ea'],['Purple','#c39aed']];
function renderBanks(){
  $('#banks').replaceChildren();'ABCD'.split('').forEach((letter,i)=>{
    const button=document.createElement('button'),name=document.createElement('small');
    button.textContent=`BANK ${letter}`;name.textContent=MODULES[i].name;button.append(name);
    button.classList.toggle('selected',i===bank);button.setAttribute('aria-pressed',String(i===bank));button.onclick=()=>selectBank(i);$('#banks').append(button);
  });
  $('#slots').replaceChildren();slotGroups.forEach(([name,color],group)=>{
    const row=document.createElement('div'),label=document.createElement('span'),slots=document.createElement('div');
    row.className='slot-group';row.style.setProperty('--slot-color',color);label.className='slot-group-label';label.textContent=name;slots.className='slot-row';
    for(let position=0;position<4;position++){
      const n=bank*20+group*4+position,b=document.createElement('button');b.textContent=programLabel(n);
      b.setAttribute('aria-label',`Recall pedal preset ${programLabel(n)} · ${name} group · bar ${position+1}`);b.dataset.live='';b.classList.toggle('selected',recalled===n);b.onclick=guarded(()=>recall(n));slots.append(b);
    }
    row.append(label,slots);$('#slots').append(row);
  });
  $('#selected-slot').textContent=recalled===null?'No slot recalled':`Selected · ${programLabel(recalled)} · ${slotGroups[Math.floor(recalled%20/4)][0]} · bar ${recalled%4+1}`;updateConnection();
}
async function recall(n){
  if(busy)return;liveEdits.clear();const token=cancelToken;await midi.program(n);if(token!==cancelToken)return;recalled=n;bank=Math.floor(n/20);resetDraft(n);renderBanks();notice(`Loaded pedal preset ${programLabel(n)}.`);
}
async function applyDraft(){
  const snapshot=validatePreset({...draft,name:'Editor'});
  if(!midi.armed)throw new Error('Connect your Chroma Console first.');
  const applyBase=pendingBase, controls=new Set(applyBase?Object.keys(snapshot.values).map(Number):pendingControls);
  if(!applyBase&&!controls.size)return;
  busy=true;const token=++cancelToken;liveEdits.clear();updateConnection();
  const check=()=>{if(token!==cancelToken||!midi.armed)throw new Error('Sending stopped. The pedal may have received part of the sound.');};
  try{
    if(applyBase&&snapshot.baseProgram!==null){check();await midi.program(snapshot.baseProgram);check();recalled=snapshot.baseProgram;bank=Math.floor(recalled/20);await new Promise(r=>setTimeout(r,750));}
    // Select effects first, then parameters and setup. Never include transient actions.
    for(const cc of PRESET_CCS){if(controls.has(cc)&&snapshot.values[cc]!==undefined){check();await midi.cc(cc,snapshot.values[cc]);await new Promise(r=>setTimeout(r,15));}}
    check();pendingControls.clear();pendingBase=false;loadedPreset=false;
    liveEdits.clear();notice('');toast('Settings applied to Chroma Console.');
  }finally{busy=false;renderBanks();updateConnection();}
}
async function saveLibrary(next){const json=serializeLibrary(next);try{await storage.setItem(LIBRARY_KEY,json);}catch{throw new Error(desktop?'The preset library could not be saved. Export a backup before closing the app.':'Browser storage is full or unavailable. Export your library before closing this page.');}library=next;renderLibrary();}
function renderLibrary(){
  const list=$('#library-list');list.replaceChildren();
  $('#library-total').textContent=`${library.length} SOUND${library.length===1?'':'S'}`;
  const query=$('#library-search').value.trim().toLowerCase();
  if(!library.length){const p=document.createElement('div');p.className='library-empty';p.textContent='No saved sounds yet.';list.append(p);return;}
  library.forEach((preset,i)=>{if(query&&!`${preset.name} ${preset.notes}`.toLowerCase().includes(query))return;const row=document.createElement('div');row.className='library-item';const info=document.createElement('div'),name=document.createElement('strong'),meta=document.createElement('small');name.textContent=preset.name;meta.textContent=preset.baseProgram===null?'Editor preset':`Based on ${programLabel(preset.baseProgram)}`;info.append(name,meta);row.append(info);const load=document.createElement('button');load.textContent='Load';load.setAttribute('aria-label',`Load ${preset.name} into editor`);load.onclick=guarded(()=>{if(busy)throw new Error('Wait for the current send to finish.');liveEdits.clear();draft=validatePreset(preset);queueDraft();loadedPreset=true;$('#preset-name').value=draft.name;$('#preset-notes').value=draft.notes;renderValues();location.hash='editor';notice(`Loaded “${preset.name}”. Select Apply loaded preset to hear it.`);toast('Loaded into editor. No messages sent.');});row.append(load);const remove=document.createElement('button');remove.className='remove';remove.textContent='×';remove.title='Remove from library';remove.setAttribute('aria-label',`Remove ${preset.name} from library`);remove.onclick=guarded(async()=>{const copy=library.slice();copy.splice(i,1);await saveLibrary(copy);removed={preset,i};$('#undo-remove').hidden=false;toast(`Removed “${preset.name}”. Undo is available below the library until this page closes.`);});row.append(remove);list.append(row);});
  if(!list.children.length){const empty=document.createElement('div');empty.className='library-empty';empty.textContent='No matching sounds.';list.append(empty);}
}
async function downloadLibrary(){if(desktop){if(await desktop.exportLibrary(serializeLibrary(library)))toast('Library exported.');return;}const blob=new Blob([serializeLibrary(library)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`chroma-library-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
buildModules();
for(let i=1;i<=16;i++)$('#channel').add(new Option(String(i),i));
$('#connect').onclick=guarded(connect);
$('#ports').onchange=guarded(()=>{autoSelect=Boolean($('#ports').value);if(!autoSelect)disconnectPedal();else selectOutput(access.outputs.get($('#ports').value));notice(autoSelect?'Connected. Live control is on.':'Disconnected. Edits stay in the editor.');});
$('#channel').onchange=guarded(()=>{cancelToken++;queueDraft();midi.channel=Number($('#channel').value);liveEdits.clear();recentSends.clear();setEngaged(null);if(midi.port?.state==='connected')midi.arm();renderValues();renderActivity();notice(`Channel ${midi.channel} selected.`);});
$('#blank').onclick=()=>{resetDraft();notice('');};
$('#apply').onclick=guarded(applyDraft);
$('#show-save-guide').onclick=()=>$('#pedal-save-guide').scrollIntoView({block:'start'});
$('#engage').onclick=guarded(()=>midi.cc(91,engaged===true?0:127));
$$('[data-action]').forEach(b=>b.onclick=guarded(async()=>{const [cc,value]=b.dataset.action.split(':').map(Number);await midi.cc(cc,value);toast(`${b.textContent.trim()} sent.`);}));
$$('[data-cc]').forEach(select=>select.onchange=guarded(()=>{if(select.value!=='')return setValue(Number(select.dataset.cc),Number(select.value),true);else{liveEdits.delete(Number(select.dataset.cc));delete draft.values[select.dataset.cc];pendingControls.delete(Number(select.dataset.cc));renderValues();notice('Setting omitted from the editor. The pedal is unchanged.');}}));
$('#calibration').onchange=guarded(async()=>{if($('#calibration').value!==''){await midi.cc(94,Number($('#calibration').value));toast('Input calibration level sent (global setting).');$('#calibration').value='';}});
$('#modern-bypass').onchange=()=>{$$('.module-bypass').forEach(x=>x.hidden=!$('#modern-bypass').checked);persistSession();};
$('#previous').onclick=guarded(()=>recall(recalled===null?bank*20:(recalled+79)%80));$('#next').onclick=guarded(()=>recall(recalled===null?bank*20:(recalled+1)%80));
$('#tap').onclick=guarded(async()=>{await midi.cc(93,127);const now=performance.now(),interval=now-lastTap;if(interval>250&&interval<3000){tapIntervals.push(interval);if(tapIntervals.length>4)tapIntervals.shift();$('#tap-readout').textContent=`${Math.round(60000/(tapIntervals.reduce((a,b)=>a+b,0)/tapIntervals.length))} BPM`;}else{tapIntervals=[];$('#tap-readout').textContent='Tap again';}lastTap=now;});
$('#save').onclick=guarded(async()=>{if(library.length>=500)throw new Error('Library is full (500 presets). Export a backup, then remove unused entries.');if(!Object.keys(draft.values).length&&draft.baseProgram===null)throw new Error('Set a control or recall a pedal preset before saving.');const preset=validatePreset({...draft,name:$('#preset-name').value,notes:$('#preset-notes').value});await saveLibrary([...library,preset]);toast(`Saved “${preset.name}” on this Mac.`);});
$('#export').onclick=guarded(downloadLibrary);
$('#undo-remove').onclick=guarded(async()=>{if(!removed)return;const next=library.slice();next.splice(removed.i,0,removed.preset);await saveLibrary(next);removed=null;$('#undo-remove').hidden=true;toast('Preset restored.');});
$('#import').onchange=guarded(async()=>{const file=$('#import').files[0];if(!file)return;try{if(file.size>1_000_000)throw new Error('Library is too large (maximum 1 MB).');const imported=parseLibrary(await file.text());if(library.length+imported.length>500)throw new Error('Import would exceed 500 presets.');await saveLibrary([...library,...imported]);toast(`Imported ${imported.length} presets. No MIDI sent.`);}finally{$('#import').value='';}});
// Connections enable live editing but never transmit stored values.
window.addEventListener('pagehide',()=>{if(access)access.onstatechange=null;disconnectPedal();});
try{const stored=storage.getItem(LIBRARY_KEY);if(stored)library=parseLibrary(stored);}catch(e){notice(`Could not load browser library: ${e.message}. Existing storage was left untouched.`,true);}
renderLibrary();renderBanks();renderValues();setEngaged(null);renderActivity();renderLog();
if(SIMULATOR){document.title='SIMULATOR · Chroma Console Editor';$('.hero-note').textContent='SIMULATOR · NO HARDWARE';document.body.classList.add('simulator');notice('SIMULATOR: MIDI is simulated. The test library is separate and lasts for this tab’s session.');}

// Simulator-only feedback controls use the same input listener as the pedal.
// They never request access to physical MIDI ports.
const simulatedInput = Object.assign(new EventTarget(),{id:'sim-input',type:'input',name:'Simulated Chroma Console',state:'connected'});
if(SIMULATOR){
  $('#simulator-input').hidden=false;
  $('#sim-receive').onclick=guarded(()=>{
    const channel=Number($('#sim-channel').value),kind=$('#sim-type').value;
    const number=Number($('#sim-number').value),value=Number($('#sim-value').value);
    const bytes=kind==='clock'?[0xf8]:kind==='program'?[0xc0+channel-1,number]:[0xb0+channel-1,number,value];
    const event=new Event('midimessage');event.data=bytes;simulatedInput.dispatchEvent(event);
  });
  $('#sim-clock-burst').onclick=()=>{for(let i=0;i<240;i++){const event=new Event('midimessage');event.data=[0xf8];simulatedInput.dispatchEvent(event);}renderClock();};
  $('#sim-disconnect').onclick=()=>{simulatedInput.state='disconnected';disconnectPedal();};
  $('#sim-reconnect').onclick=()=>{simulatedInput.state='connected';connect();};
}

// Navigation changes the visible workspace only. It never sends MIDI.
function showPage(){
  const labels={editor:'Sound',presets:'Presets',performance:'Performance',activity:'MIDI activity',guide:'Settings & help'};
  const requested=location.hash.slice(1);if(requested==='main')return;
  const page=Object.hasOwn(labels,requested)?requested:'editor';
  $$('.page-panel').forEach(panel=>panel.hidden=panel.id!==page);
  $$('.workspace-nav a, .settings-link').forEach(link=>{const active=link.hash===`#${page}`;link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  $('#page-label').textContent=labels[page];renderClock();persistSession();
}
window.addEventListener('hashchange',showPage);showPage();
$('#library-search').oninput=renderLibrary;
$('#clear-log').onclick=()=>{logs.length=0;sendCount=0;inputControls=0;renderLog();renderActivity();};
$$('[data-log-filter]').forEach(button=>button.onclick=()=>{logFilter=button.dataset.logFilter;$$('[data-log-filter]').forEach(other=>{const selected=other===button;other.classList.toggle('selected',selected);other.setAttribute('aria-pressed',String(selected));});renderLog();});
$('#clock-details').ontoggle=renderClock;
// UI-only clock indicator. No polling, MIDI output or per-clock DOM work.
setInterval(renderClock,1000);


function sessionSnapshot(){
  return JSON.stringify({format:'chroma-session',version:1,draft:{...draft,name:$('#preset-name').value,notes:$('#preset-notes').value},channel:midi.channel,bank,page:$('.page-panel:not([hidden])').id,moduleBypass:$('#modern-bypass').checked});
}
function persistSession(){if(desktopReady&&!SIMULATOR)desktop.saveSession(sessionSnapshot()).catch(fail);}
async function importDesktopLibrary(){
  const text=await desktop.importLibrary();if(text===null)return;
  const imported=parseLibrary(text);
  if(library.length+imported.length>500)throw new Error('Import would exceed 500 presets.');
  await saveLibrary([...library,...imported]);toast(`Imported ${imported.length} presets. No MIDI sent.`);
}
if(desktop){
  document.body.classList.add('desktop');
  if(desktop.version){const label=$('#app-version');label.textContent=`v${desktop.version}`;label.title=`Build ${desktop.buildNumber}`;label.hidden=false;}
  if(!SIMULATOR)$('.hero-note').textContent='NATIVE MIDI';
  $('.independent').remove();
  $('#guide .help-grid article:first-child li:nth-child(2)').textContent='The app detects your pedal automatically. Select Refresh MIDI if it is not listed.';
  $('#guide .help-grid article:nth-child(3) p:last-child').textContent='Presets are stored in this app’s library on your Mac. Export a copy to keep a backup.';

  $('label[for=import]').removeAttribute('for');
  const importButton=document.createElement('button');importButton.className='quiet-button';importButton.textContent='Import library ↑';importButton.onclick=guarded(importDesktopLibrary);
  $('.library-tools label').replaceWith(importButton);
  window.addEventListener('chroma-error',event=>fail(new Error(event.detail)));
  window.addEventListener('chroma-menu',guarded(async event=>{
    const {action,page}=event.detail;
    if(action==='page'){location.hash=page;return;}
    if(action==='save'){location.hash='presets';showPage();$('#preset-name').focus();return;}
    if(action==='import'){await importDesktopLibrary();return;}
    if(action==='export'){await downloadLibrary();return;}
    if(action==='connect'){await connect();return;}
    if(action==='disconnect'){autoSelect=false;disconnectPedal();notice('Disconnected. Edits stay in the editor.');}
  }));
  window.chromaFlushSession=async()=>{if(desktopReady&&!SIMULATOR){await desktop.saveSession(sessionSnapshot());await desktop.flush();}return true;};
  $('#preset-name').addEventListener('input',persistSession);$('#preset-notes').addEventListener('input',persistSession);
  if(desktop.initialError){fail(new Error(`App storage could not be opened: ${desktop.initialError.message||desktop.initialError}`));}
  else {
    if(desktop.session&&!SIMULATOR){
      try{
        const saved=JSON.parse(desktop.session),name=saved.draft.name;
        draft=validatePreset({...saved.draft,name:name||'Untitled sound'});draft.name=name;
        $('#preset-name').value=name;$('#preset-notes').value=draft.notes;
        midi.channel=saved.channel;$('#channel').value=String(saved.channel);bank=saved.bank;
        $('#modern-bypass').checked=saved.moduleBypass;$$('.module-bypass').forEach(el=>el.hidden=!saved.moduleBypass);
        queueDraft();loadedPreset=false;location.hash=saved.page;renderValues();renderBanks();showPage();
      }catch(error){fail(new Error(`The saved session could not be restored: ${error.message}`));}
    }
    await desktop.ready();desktopReady=true;
    if(!SIMULATOR){await guarded(connect)();if(pendingBase||pendingControls.size)notice('Session restored. Live control is on; use Apply unsent edits to restore the whole sound.');}
  }
}

// End-to-end interface checks are available only in the isolated simulator.
if(SIMULATOR&&new URLSearchParams(location.search).get('test')==='ui'){
  const {run}=await import('./tests/live-ui.mjs');
  await run({connect,disconnect:disconnectPedal,midi});
}
