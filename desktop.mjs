// macOS adapter. The browser editor continues using Web MIDI and browser storage.
// The native side independently validates each typed CC/Program Change request.
const host = window.webkit?.messageHandlers?.chroma;
export const desktop = host ? await createDesktop() : null;

async function createDesktop(){
  const call = (op, fields={}) => host.postMessage({op,...fields});
  const simulation = new URLSearchParams(location.search).get('demo')==='1';
  let initial={},initialError=null;
  try{initial=await call('init');}catch(error){initialError=error;}
  const values=new Map();
  if(initial.library)values.set('chroma-studio-library-v1',initial.library);
  let access=null;
  class NativePort extends EventTarget{
    constructor(info,generation){super();Object.assign(this,info);this.generation=generation;}
    close(){return Promise.resolve(this);}
    send(bytes){
      if(this.type!=='output'||this.state!=='connected')throw new Error('Chroma Console disconnected.');
      const shared={id:this.id,generation:this.generation,channel:(bytes[0]&15)+1};
      if(bytes.length===3&&(bytes[0]&0xf0)===0xb0)return call('cc',{...shared,cc:bytes[1],value:bytes[2]});
      if(bytes.length===2&&(bytes[0]&0xf0)===0xc0)return call('program',{...shared,program:bytes[1]});
      throw new Error('Unsupported native MIDI message.');
    }
  }
  function updatePorts(payload,notify=true){
    if(!access)return;
    const previous=new Map([...access.inputs,...access.outputs]);
    access.inputs.clear();access.outputs.clear();
    for(const info of payload.ports){
      const port=previous.get(info.id)||new NativePort(info,payload.generation);
      Object.assign(port,info,{generation:payload.generation});previous.delete(info.id);
      (port.type==='input'?access.inputs:access.outputs).set(port.id,port);
    }
    for(const port of previous.values())port.state='disconnected';
    access.generation=payload.generation;
    if(notify)access.onstatechange?.();
  }
  function input(id,data){
    const port=access?.inputs.get(id);if(!port)return;
    const event=new Event('midimessage');event.data=new Uint8Array(data);port.dispatchEvent(event);
  }
  window.addEventListener('chroma-native',event=>{
    const {kind,payload}=event.detail;
    if(kind==='ports')updatePorts(payload);
    if(kind==='input'&&access&&payload.generation===access.generation){
      for(const message of payload.messages)input(message.id,message.data);
      for(const [id,count]of Object.entries(payload.clocks))for(let i=0;i<count;i++)input(id,[0xf8]);
    }
    if(kind==='error')window.dispatchEvent(new CustomEvent('chroma-error',{detail:payload.message}));
    if(kind==='menu')window.dispatchEvent(new CustomEvent('chroma-menu',{detail:payload}));
  });
  return {
    initialError,session:initial.session,
    storage:{
      getItem:key=>values.get(key)??null,
      async setItem(key,text){
        if(initialError)throw new Error('App storage could not be opened. Your existing files are unchanged.');
        if(!simulation)await call('saveLibrary',{text});
        values.set(key,text);
      }
    },
    async requestMIDIAccess(){
      if(simulation)throw new Error('Simulator cannot access hardware.');
      const payload=await call('ports');
      if(!access)access={inputs:new Map(),outputs:new Map(),onstatechange:null};
      updatePorts(payload,false);return access;
    },
    async refresh(){if(access)updatePorts(await call('ports'),false);},
    ready:()=>call('ready'),
    saveSession:text=>simulation?Promise.resolve():call('saveSession',{text}),
    flush:()=>simulation?Promise.resolve():call('flush'),
    importLibrary:()=>call('importLibrary'),
    exportLibrary:text=>call('exportLibrary',{text}),
    showLibrary:()=>call('showLibrary')
  };
}
