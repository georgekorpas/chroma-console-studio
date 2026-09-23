// Source: Hologram Chroma Console manual, MIDI chart pp. 46–49 (v1.04).
// This is the only module allowed to call MIDIOutput.send().
export const MODULES = [
  {name:'Character', key:'character', cc:16, bypass:103, effects:['Drive','Sweeten','Fuzz','Howl','Swell'], controls:[['Tilt',64],['Amount',65],['Sensitivity',72],['Effect volume',73]]},
  {name:'Movement', key:'movement', cc:17, bypass:104, effects:['Doubler','Vibrato','Phaser','Tremolo','Pitch'], controls:[['Rate',66],['Amount',67],['Drift',74],['Effect volume',75]]},
  {name:'Diffusion', key:'diffusion', cc:18, bypass:105, effects:['Cascade','Reels','Space','Collage','Reverse'], controls:[['Time',68],['Amount',69],['Drift',76],['Effect volume',77]]},
  {name:'Texture', key:'texture', cc:19, bypass:106, effects:['Filter','Squash','Cassette','Broken','Interference'], controls:[['Amount',71],['Effect volume',79]]},
];
export const ALLOWED_CCS = Object.freeze([16,17,18,19,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,91,92,93,94,95,103,104,105,106]);
// Transient actions, global calibration, and bypass are deliberately not preset data.
export const PRESET_CCS = Object.freeze([16,17,18,19,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,83,84]);
export const EFFECT_VALUES = Object.freeze([0,22,44,66,88,110]);
export function integer(n, min, max, label='Value') {
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  return n;
}
export function ccMessage(channel, cc, value) {
  integer(channel,1,16,'MIDI channel'); integer(cc,0,127,'CC'); integer(value,0,127);
  if (!ALLOWED_CCS.includes(cc)) throw new Error(`CC ${cc} is not on the documented control allowlist.`);
  return [0xb0 + channel - 1, cc, value];
}
export function pcMessage(channel, program) {
  integer(channel,1,16,'MIDI channel'); integer(program,0,79,'Preset');
  return [0xc0 + channel - 1, program];
}
export function isChroma(port) {
  return isChromaPort(port,'output');
}
export function isChromaPort(port,type) {
  return port?.type === type && /chroma\s*console/i.test(port.name || '') && !/boot|firmware|dfu|update/i.test(`${port.name} ${port.manufacturer || ''}`);
}
// Incoming data is display feedback only. It can never call the MIDI output.
export function decodeFeedback(data,channel) {
  if (!data || !Number.isInteger(channel) || channel<1 || channel>16) return null;
  const bytes=Array.from(data);
  if (!bytes.length || !Number.isInteger(bytes[0]) || (bytes[0]&15)!==channel-1) return null;
  if (bytes.slice(1).some(n=>!Number.isInteger(n)||n<0||n>127)) return null;
  if (bytes[0]===0xb0+channel-1 && bytes.length===3 && ALLOWED_CCS.includes(bytes[1])) return {type:'cc',cc:bytes[1],value:bytes[2]};
  if (bytes[0]===0xc0+channel-1 && bytes.length===2 && bytes[1]<=79) return {type:'program',program:bytes[1]};
  return null;
}
export class MidiFeedback {
  #port=null;
  #listener;
  constructor(channel,onControl,onActivity=()=>{}) {
    this.#listener=event=>{
      if (this.#port?.state!=='connected') return;
      const bytes=Array.from(event.data);
      const message=decodeFeedback(bytes,channel());
      onActivity(bytes,message);
      if(message) onControl(message,bytes);
    };
  }
  get port(){return this.#port;}
  connect(port) {
    if(port===this.#port)return;
    this.disconnect();
    if(!isChromaPort(port,'input')||port.state!=='connected')throw new Error('Select a connected Chroma Console MIDI input.');
    this.#port=port;
    // Web MIDI implicitly opens an input when a midimessage listener is added.
    port.addEventListener('midimessage',this.#listener);
  }
  disconnect(){
    const old=this.#port;this.#port=null;
    if(old){old.removeEventListener('midimessage',this.#listener);old.close?.().catch(()=>{});}
  }
}
export function programLabel(n) { integer(n,0,79); return `${'ABCD'[Math.floor(n/20)]}${String(n%20+1).padStart(2,'0')}`; }
export function validatePreset(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid preset.');
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 80) throw new Error('Preset names must contain 1–80 characters.');
  if (raw.baseProgram !== null) integer(raw.baseProgram,0,79,'Base preset');
  if (!raw.values || typeof raw.values !== 'object' || Array.isArray(raw.values)) throw new Error('Invalid parameter map.');
  const values = {};
  for (const [key,value] of Object.entries(raw.values)) {
    const cc = Number(key);
    if (String(cc) !== key || !PRESET_CCS.includes(cc)) throw new Error(`Preset contains unsupported control: ${key}`);
    values[key] = integer(value,0,127);
  }
  if (raw.notes !== undefined && (typeof raw.notes !== 'string' || raw.notes.length > 2000)) throw new Error('Notes must be text, up to 2,000 characters.');
  return {name:raw.name.trim(),baseProgram:raw.baseProgram,values,notes:raw.notes || ''};
}
export function parseLibrary(text) {
  if (text.length > 1_000_000) throw new Error('Library is too large (maximum 1 MB).');
  const data = JSON.parse(text);
  if (data?.format !== 'chroma-console-editor' || data.version !== 1 || !Array.isArray(data.presets) || data.presets.length > 500) throw new Error('Unsupported library format.');
  return data.presets.map(validatePreset);
}
export function serializeLibrary(presets) {
  return JSON.stringify({format:'chroma-console-editor',version:1,presets:presets.map(validatePreset)}, null, 2);
}
// Coalesce continuous edits without treating an automatic send as a manual edit.
// Only the latest value is retained while a send is in flight. Clearing the queue
// cancels timers and makes completions from the previous connection inert.
export class LiveEditQueue {
  #states = new Map();
  constructor(send,onSent,onError,clock={now:()=>performance.now(),set:(fn,ms)=>setTimeout(fn,ms),clear:id=>clearTimeout(id)}) {
    this.send=send;this.onSent=onSent;this.onError=onError;this.clock=clock;
  }
  has(cc) { return Boolean(this.#states.get(cc)?.pending); }
  delete(cc) {
    const state=this.#states.get(cc);
    if(state?.timer!==null&&state?.timer!==undefined)this.clock.clear(state.timer);
    this.#states.delete(cc);
  }
  clear() { for(const cc of this.#states.keys())this.delete(cc); }
  set(cc,value,force=false) {
    let state=this.#states.get(cc);
    if(!state){state={value,lastValue:undefined,lastAt:-Infinity,pending:false,inFlight:false,force:false,timer:null};this.#states.set(cc,state);}
    state.value=value;state.pending=true;state.force=state.force||force;
    this.#schedule(cc,state);
  }
  #schedule(cc,state) {
    if(state.inFlight)return;
    if(state.timer!==null){this.clock.clear(state.timer);state.timer=null;}
    if(state.value===state.lastValue){state.pending=false;state.force=false;this.onSent(cc,state.value);return;}
    const delay=state.force?0:Math.max(0,35-(this.clock.now()-state.lastAt));
    if(delay)state.timer=this.clock.set(()=>{state.timer=null;this.#flush(cc,state);},delay);
    else this.#flush(cc,state);
  }
  async #flush(cc,state) {
    if(this.#states.get(cc)!==state)return;
    const value=state.value;state.inFlight=true;state.force=false;state.lastAt=this.clock.now();
    try { await this.send(cc,value); }
    catch(error) {
      if(this.#states.get(cc)!==state)return;
      this.delete(cc);this.onError(error);return;
    }
    if(this.#states.get(cc)!==state)return;
    state.inFlight=false;state.lastValue=value;
    if(state.value===value){state.pending=false;state.force=false;}
    else this.#schedule(cc,state);
    this.onSent(cc,value);
  }
}

export class SafeMidi {
  #port = null;
  #channel = 1;
  #armed = false;
  constructor(onSend = () => {}) { this.onSend = onSend; }
  get armed() { return this.#armed; }
  get port() { return this.#port; }
  get channel() { return this.#channel; }
  set channel(value) { this.#channel = integer(value,1,16,'MIDI channel'); this.disarm(); }
  connect(port) {
    this.disarm();
    if (!isChroma(port) || port.state !== 'connected') throw new Error('Select a connected Chroma Console MIDI output.');
    this.#port = port;
  }
  arm() {
    if (!this.#port || this.#port.state !== 'connected') throw new Error('Connect your Chroma Console first.');
    this.#armed = true;
  }
  disarm() { this.#armed = false; }
  disconnect() { this.disarm(); this.#port = null; }
  #send(bytes) {
    if (!this.#armed) throw new Error('Enable live control first.');
    if (!isChroma(this.#port) || this.#port.state !== 'connected') { this.disconnect(); throw new Error('Chroma Console disconnected.'); }
    // No raw-message interface, no SysEx, no system messages, no scheduling.
    const result=this.#port.send(bytes);
    if(result?.then)return result.then(()=>this.onSend([...bytes]));
    this.onSend([...bytes]);
  }
  cc(cc,value) { return this.#send(ccMessage(this.#channel,cc,value)); }
  program(n) { return this.#send(pcMessage(this.#channel,n)); }
}
