import {ALLOWED_CCS,PRESET_CCS,ccMessage,pcMessage,SafeMidi,LiveEditQueue,MidiFeedback,decodeFeedback,isChroma,isChromaPort,programLabel,validatePreset,parseLibrary,serializeLibrary,MODULES,EFFECT_VALUES} from '../protocol.mjs';
const lines=[];let passed=0,failed=0;
function assert(value,message='Assertion failed'){if(!value)throw new Error(message);}
function equal(a,b){assert(JSON.stringify(a)===JSON.stringify(b),`${JSON.stringify(a)} !== ${JSON.stringify(b)}`);}
function rejects(fn){let rejected=false;try{fn();}catch{rejected=true;}assert(rejected,'Unsafe input was accepted.');}
function test(name,fn){try{fn();passed++;lines.push(`PASS  ${name}`);}catch(e){failed++;lines.push(`FAIL  ${name}: ${e.message}`);}}
const preset={name:'Test sound',baseProgram:79,values:{16:44,64:50,70:110,84:64},notes:'Test only'};
test('All 16 channels, all 128 CCs and values enforce exact allowlist',()=>{for(let ch=1;ch<=16;ch++)for(let cc=0;cc<128;cc++)for(let v=0;v<128;v++){if(ALLOWED_CCS.includes(cc))equal(ccMessage(ch,cc,v),[0xb0+ch-1,cc,v]);else rejects(()=>ccMessage(ch,cc,v));}});
test('All 80 preset slots across all channels map to Program Change',()=>{for(let ch=1;ch<=16;ch++)for(let p=0;p<80;p++)equal(pcMessage(ch,p),[0xc0+ch-1,p]);});
test('Malformed channel, CC, value, and program rejected',()=>{for(const v of [-1,128,255,240,NaN,Infinity,1.5,'1',null,undefined,{},[]]){rejects(()=>ccMessage(1,64,v));rejects(()=>ccMessage(1,v,0));rejects(()=>pcMessage(1,v));}for(const v of [0,17,-1,1.5,'1',null]){rejects(()=>ccMessage(v,64,0));rejects(()=>pcMessage(v,0));}for(const v of [80,127])rejects(()=>pcMessage(1,v));});
test('Program boundaries use correct bank and slot',()=>{equal([0,19,20,39,40,59,60,79].map(programLabel),['A01','A20','B01','B20','C01','C20','D01','D20']);});
test('Only Chroma Console normal MIDI output is selectable',()=>{assert(isChroma({type:'output',name:'HOLOGRAM Chroma Console MIDI'}));for(const name of ['Other synthesizer','Chroma Console Bootloader','Chroma Console firmware','Chroma Console DFU','Chroma Console updater'])assert(!isChroma({type:'output',name}));assert(!isChroma({type:'input',name:'Chroma Console'}));});
test('Connecting and arming send nothing; sending requires live control',()=>{const sent=[],port={type:'output',name:'Chroma Console MIDI',state:'connected',send:b=>sent.push(b)},m=new SafeMidi();m.connect(port);equal(sent,[]);rejects(()=>m.cc(91,0));m.arm();equal(sent,[]);m.cc(91,0);m.program(79);equal(sent,[[176,91,0],[192,79]]);m.disarm();rejects(()=>m.program(0));equal(sent.length,2);});
test('Channel change and disconnect require explicit rearming',()=>{const sent=[],port={type:'output',name:'Chroma Console MIDI',state:'connected',send:b=>sent.push(b)},m=new SafeMidi();m.connect(port);m.arm();m.channel=16;rejects(()=>m.cc(64,10));m.arm();m.cc(64,10);equal(sent,[[191,64,10]]);port.state='disconnected';rejects(()=>m.cc(64,10));assert(!m.armed);port.state='connected';m.connect(port);rejects(()=>m.cc(64,10));});
test('No unlisted command can reach output',()=>{const sent=[],m=new SafeMidi();m.connect({type:'output',name:'Chroma Console',state:'connected',send:b=>sent.push(b)});m.arm();for(const cc of [0,1,6,32,96,97,98,99,100,101,102,120,121,123,127,240])rejects(()=>m.cc(cc,0));rejects(()=>m.program(127));equal(sent,[]);assert(m.send===undefined);});
test('Snapshot serialization round-trips only documented parameters',()=>{equal(parseLibrary(serializeLibrary([preset])),[preset]);assert(PRESET_CCS.every(cc=>ALLOWED_CCS.includes(cc)));});
test('Snapshot cannot replay Gesture, Capture, calibration, bypass, or arbitrary bytes',()=>{for(const cc of [80,81,82,91,92,93,94,95,103,104,105,106,120,240])rejects(()=>validatePreset({...preset,values:{[cc]:0}}));rejects(()=>validatePreset({...preset,values:{'064':10}}));rejects(()=>validatePreset({...preset,values:JSON.parse('{"__proto__":null}')}));});
test('Preset schema rejects malformed, oversized and out-of-range inputs',()=>{for(const value of [null,[],{},-1,128,'64',1.2])rejects(()=>validatePreset({...preset,values:{64:value}}));for(const baseProgram of [undefined,'0',80,-1])rejects(()=>validatePreset({...preset,baseProgram}));for(const name of ['',null,'x'.repeat(81)])rejects(()=>validatePreset({...preset,name}));rejects(()=>validatePreset({...preset,notes:[] }));rejects(()=>parseLibrary('bad json'));rejects(()=>parseLibrary(JSON.stringify({format:'other',version:1,presets:[]})));rejects(()=>parseLibrary(' '.repeat(1_000_001)));});
test('Effect selections and control mapping match manual',()=>{equal(EFFECT_VALUES,[0,22,44,66,88,110]);equal(MODULES.map(m=>[m.cc,m.bypass]),[[16,103],[17,104],[18,105],[19,106]]);equal(MODULES.flatMap(m=>m.controls.map(c=>c[1])).sort((a,b)=>a-b),[64,65,66,67,68,69,71,72,73,74,75,76,77,79]);});
test('Feedback decodes controls and presets only on the selected channel',()=>{
  equal(decodeFeedback(new Uint8Array([176,64,96]),1),{type:'cc',cc:64,value:96});
  equal(decodeFeedback([191,91,0],16),{type:'cc',cc:91,value:0});
  equal(decodeFeedback([207,79],16),{type:'program',program:79});
  for(const bytes of [[177,64,10],[176,64],[176,64,128],[176,120,0],[192,80],[240,64,10,247],[248],[144,64,127],[176,64,10,0],[],[176,64,-1]])equal(decodeFeedback(bytes,1),null);
});
test('Listening is passive, detaches old ports, and ignores disconnected inputs',()=>{
  const make=()=>Object.assign(new EventTarget(),{name:'Chroma Console MIDI',type:'input',state:'connected'});
  const first=make(),second=make(),messages=[],activity=[];let channel=1;
  const listener=new MidiFeedback(()=>channel,m=>messages.push(m),b=>activity.push(b));
  const emit=(port,bytes)=>{const event=new Event('midimessage');event.data=bytes;port.dispatchEvent(event);};
  listener.connect(first);listener.connect(first);equal(messages,[]);
  emit(first,[176,64,90]);equal(messages.length,1);equal(activity.length,1);
  emit(first,[248]);equal(messages.length,1);equal(activity.length,2);
  channel=2;emit(first,[176,64,40]);equal(messages.length,1);
  emit(first,[177,64,40]);equal(messages.length,2);
  listener.connect(second);emit(first,[177,64,42]);equal(messages.length,2);
  second.state='disconnected';emit(second,[177,64,43]);equal(messages.length,2);
  second.state='connected';listener.disconnect();emit(second,[177,64,44]);equal(messages.length,2);
  for(const name of ['Other device','Chroma Console Bootloader','Chroma Console DFU'])rejects(()=>listener.connect(Object.assign(make(),{name})));
  assert(isChromaPort(first,'input'));assert(!isChromaPort(first,'output'));
});
async function asyncTest(name,fn){try{await fn();passed++;lines.push(`PASS  ${name}`);}catch(e){failed++;lines.push(`FAIL  ${name}: ${e.message}`);}}
await asyncTest('Native transport records output only after successful completion',async()=>{
  const recorded=[],m=new SafeMidi(bytes=>recorded.push(bytes));let finish;
  m.connect({type:'output',name:'Chroma Console',state:'connected',send:()=>new Promise(resolve=>finish=resolve)});m.arm();
  const request=m.cc(64,66);equal(recorded,[]);finish();await request;equal(recorded,[[176,64,66]]);
});
await asyncTest('Native transport failures propagate without recording a successful send',async()=>{
  const recorded=[],m=new SafeMidi(bytes=>recorded.push(bytes));
  m.connect({type:'output',name:'Chroma Console',state:'connected',send:()=>Promise.reject(new Error('Disconnected'))});m.arm();
  let caught=false;try{await m.program(3);}catch(error){caught=error.message==='Disconnected';}assert(caught);equal(recorded,[]);
});
function editClock(){
  let now=0,next=0;const timers=new Map();
  return {now:()=>now,set:(fn,ms)=>{const id=++next;timers.set(id,{fn,at:now+ms});return id;},clear:id=>timers.delete(id),
    advance(ms){now+=ms;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}}};
}
await asyncTest('Rapid live edits stay automatic through delayed sends and deliver the final value',async()=>{
  const clock=editClock(),sent=[],done=[],settled=[],errors=[];
  const queue=new LiveEditQueue((cc,value)=>{sent.push([cc,value]);return new Promise(resolve=>done.push(resolve));},(cc,value)=>settled.push([value,queue.has(cc)]),error=>errors.push(error),clock);
  queue.set(64,10);queue.set(64,20);queue.set(64,30);
  equal(sent,[[64,10]]);assert(queue.has(64));
  done.shift()();await Promise.resolve();equal(settled,[[10,true]]);assert(queue.has(64));
  clock.advance(35);equal(sent,[[64,10],[64,30]]);assert(queue.has(64));
  done.shift()();await Promise.resolve();assert(!queue.has(64));equal(settled,[[10,true],[30,false]]);
  queue.set(64,30,true);equal(sent.length,2);assert(!queue.has(64));equal(errors,[]);
});
await asyncTest('A throttled final input sends automatically without waiting for blur or slider release',async()=>{
  const clock=editClock(),sent=[];
  const queue=new LiveEditQueue((cc,value)=>sent.push([cc,value]),()=>{},error=>{throw error;},clock);
  queue.set(64,10);await Promise.resolve();
  queue.set(64,11);queue.set(64,12);assert(queue.has(64));equal(sent,[[64,10]]);
  clock.advance(35);await Promise.resolve();equal(sent,[[64,10],[64,12]]);assert(!queue.has(64));
});
await asyncTest('Failed live sends become manual pending edits and never silently retry',async()=>{
  const clock=editClock(),errors=[];let attempts=0,rejectSend;
  const queue=new LiveEditQueue(()=>{attempts++;return new Promise((resolve,reject)=>rejectSend=reject);},()=>{throw new Error('Failure was marked sent');},error=>errors.push(error.message),clock);
  queue.set(64,10);queue.set(64,20);assert(queue.has(64));
  rejectSend(new Error('Disconnected'));await Promise.resolve();assert(!queue.has(64));equal(errors,['Disconnected']);
  clock.advance(100);equal(attempts,1);
});
await asyncTest('Clearing live edits cancels deferred sends and ignores old native completions',async()=>{
  const clock=editClock(),sent=[],done=[],settled=[];
  const queue=new LiveEditQueue((cc,value)=>{sent.push([cc,value]);return new Promise(resolve=>done.push(resolve));},(cc,value)=>settled.push([cc,value]),error=>{throw error;},clock);
  queue.set(64,10);done.shift()();await Promise.resolve();
  queue.set(64,20);queue.clear();clock.advance(35);equal(sent,[[64,10]]);
  queue.set(64,30);const old=done.shift();queue.clear();queue.set(64,40);old();await Promise.resolve();
  equal(settled,[[64,10]]);assert(queue.has(64));
  done.shift()();await Promise.resolve();equal(settled,[[64,10],[64,40]]);assert(!queue.has(64));
});
document.querySelector('#result').textContent=`${passed} passed · ${failed} failed`;
document.querySelector('#results').textContent=lines.join('\n');
document.title=`${failed?'FAIL':'PASS'} · Chroma Editor Diagnostics`;
