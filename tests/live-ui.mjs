// Runs only from ?demo=1&test=ui. All output is simulated; storage is isolated.
export async function run({connect,disconnect,midi}) {
  const $=selector=>document.querySelector(selector),lines=[];
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const assert=(condition,message)=>{if(!condition)throw new Error(message);};
  const input=(cc,value)=>{const element=$(`#cc-${cc}`);element.value=value;element.dispatchEvent(new Event('input',{bubbles:true}));};
  async function test(name,fn){try{await fn();lines.push(`PASS ${name}`);}catch(error){lines.push(`FAIL ${name}: ${error.message}`);}}
  await connect();$('#blank').click();
  const apply=$('#apply'),mutations=[],sent=[];
  midi.port.send=bytes=>new Promise(resolve=>setTimeout(()=>{sent.push([...bytes]);resolve();},18));
  const observer=new MutationObserver(records=>mutations.push(...records));
  observer.observe(apply,{attributes:true,childList:true,subtree:true});
  await test('Rapid live sliders do not mutate, reveal or relabel Apply',async()=>{
    for(let value=20;value<70;value++){input(64,value);input(68,127-value);assert(apply.hidden,'Apply appeared during input');await wait(5);}
    await wait(100);
    assert(apply.hidden,'Apply appeared after completion');
    assert(mutations.length===0,`${mutations.length} unnecessary Apply DOM mutations`);
    assert(sent.filter(bytes=>bytes[1]===64).at(-1)?.[2]===69,'Final Tilt value was lost');
    assert(sent.filter(bytes=>bytes[1]===68).at(-1)?.[2]===58,'Final Time value was lost');
  });
  observer.disconnect();
  await test('Offline edits reveal Apply; reconnect sends nothing; Apply completes quietly',async()=>{
    disconnect();input(64,73);assert(!apply.hidden&&apply.disabled,'Offline edit was not offered');
    const before=$('#send-count').textContent;await connect();assert($('#send-count').textContent===before,'Reconnect sent values');
    assert(!apply.hidden&&!apply.disabled,'Reconnect did not retain pending edit');
    apply.click();await wait(100);assert(apply.hidden,'Apply did not clear');
    assert($('#notice').textContent==='','Apply left a status sentence');
  });
  await test('Clear stays in place when Apply appears and leaves no status sentence',async()=>{
    const before=$('#blank').getBoundingClientRect().right;
    disconnect();input(64,74);
    assert(Math.abs($('#blank').getBoundingClientRect().right-before)<1,'Clear moved horizontally');
    $('#blank').click();assert(apply.hidden,'Clear retained pending edits');assert($('#notice').textContent==='','Clear left a status sentence');
  });
  await test('Requested copy is removed and module hints are brighter with a subtle glow',()=>{
    assert(!document.body.textContent.includes('Shape your signal.'),'Subtitle remains');
    const style=getComputedStyle($('.module-hint'));
    assert(style.color==='rgb(220, 226, 232)','Hint colour is incorrect');
    assert(style.textShadow!=='none','Hint glow is missing');
  });
  disconnect();
  const report=document.createElement('section');report.className='surface';
  const heading=document.createElement('h2'),body=document.createElement('pre');
  heading.textContent=`Interface checks: ${lines.filter(line=>line.startsWith('PASS')).length} passed · ${lines.filter(line=>line.startsWith('FAIL')).length} failed`;
  body.textContent=lines.join('\n');body.style.whiteSpace='pre-wrap';const back=document.createElement('a');back.href='./';back.textContent='← Back to editor';report.append(heading,body,back);$('#main').prepend(report);
  document.title=heading.textContent;
}
