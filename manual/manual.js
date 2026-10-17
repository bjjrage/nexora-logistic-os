'use strict';
(() => {
  const {modules,guides,journeys,roles}=window.NEXORA_MANUAL;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalize=v=>String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const byId=id=>guides.find(g=>g.id===id);
  let progress={},last=null,moduleId='',query='',role='',current=null,index=0,journey=null;
  const storage='nexora.academia.v1';
  try{const data=JSON.parse(localStorage.getItem(storage)||'{}');for(const g of guides)if(Array.isArray(data.progress?.[g.id]))progress[g.id]=data.progress[g.id].filter(i=>Number.isInteger(i)&&i>=0&&i<g.steps.length);if(byId(data.last?.id))last={id:data.last.id,step:Math.min(Math.max(Number(data.last.step)||0,0),byId(data.last.id).steps.length-1)};}catch{}
  const done=(id,step)=>progress[id]?.includes(step);
  const complete=id=>byId(id).steps.every((_,i)=>done(id,i));
  function save(){try{localStorage.setItem(storage,JSON.stringify({progress,last}));}catch{}}
  function announce(text){$('announcer').textContent=text;}
  function nav(){
    const completed=guides.filter(g=>complete(g.id)).length;
    $('overall-count').textContent=`${completed} / ${guides.length}`;
    $('overall').value=completed;$('overall').max=guides.length;
    $('modules').innerHTML=modules.map(m=>`<button class="module-button" data-module="${m.id}" ${((current?.module||moduleId)===m.id)?'aria-current="page"':''}><span class="module-icon">${m.icon}</span>${esc(m.name)}<small>${guides.filter(g=>g.module===m.id).length}</small></button>`).join('');
  }
  const guideHash=(id,step=0,j=null)=>`#guia/${id}/${step+1}${j?'/'+j.id:''}`;
  function go(hash){if(location.hash===hash)route();else location.hash=hash;}
  function card(g){return `<button class="lesson-card" data-guide="${g.id}"><div class="card-top"><span>${esc(modules.find(m=>m.id===g.module).name)}</span>${complete(g.id)?'<b>✓ Completada</b>':''}</div><h3>${esc(g.title)}</h3><p>${esc(g.description)}</p><div class="card-bottom"><span>${g.steps.length} pasos · ${esc(g.roles[0])}</span><strong>Practicar ↗</strong></div></button>`;}
  function matching(){return guides.filter(g=>(!moduleId||g.module===moduleId)&&(!role||g.roles.includes(role))&&(!query||normalize([g.title,g.description,g.prereq,...g.steps.flatMap(s=>[s.title,s.instruction,s.action,...(s.fields||[]).map(f=>f.label)])].join(' ')).includes(normalize(query))));}
  function cards(){const items=matching();$('cards').innerHTML=items.length?items.map(card).join(''):'<div class="empty"><h3>No encontramos esa tarea</h3><p>Probá con “recibir”, “catálogo”, “GPS” o cambiá el rol.</p><button class="secondary" data-clear>Quitar filtros</button></div>';$('result-count').textContent=`${items.length} funciones`;$('cards').setAttribute('aria-label',`${items.length} funciones disponibles`);}
  function library(){
    current=null;journey=null;nav();
    const m=modules.find(m=>m.id===moduleId);
    $('main').innerHTML=`<span class="eyebrow">MENOS LEER. MÁS HACER.</span><h1>${m?esc(m.name):'¿Qué necesitás hacer hoy?'}</h1><p class="intro">Elegí una tarea. Te mostramos dónde entrar, qué completar y qué tiene que pasar. Una acción por pantalla.</p>
      ${!m?`${last?`<div class="resume"><span>↳</span><strong>Seguí donde quedaste: ${esc(byId(last.id).title)}</strong><button class="quiet" data-resume>Retomar →</button></div>`:''}<section class="hero"><div><span class="eyebrow">TU PRIMERA OPERACIÓN</span><h2>Del depósito al destinatario.</h2><p>Recorré el circuito con un cliente ficticio. Registrá, recibí, prepará y entregá sin tocar tus datos reales.</p><button class="primary" data-journey="completo">Empezar recorrido <span>→</span></button></div><div class="hero-art" aria-hidden="true"><div class="flow-box"><span>▤</span><small>RECIBIR</small></div><span class="flow-arrow">→</span><div class="flow-box featured"><span>⇢</span><small>REPARTIR</small></div><span class="flow-arrow">→</span><div class="flow-box"><span>✓</span><small>ENTREGAR</small></div></div></section><div class="section-head"><h2>O elegí un recorrido</h2><span>En el orden correcto</span></div><section class="journeys" aria-label="Recorridos guiados">${journeys.map((j,i)=>`<button class="journey" data-journey="${j.id}"><span>RECORRIDO 0${i+1}</span><strong>${esc(j.title)} →</strong><small>${j.ids.length} funciones · ${esc(j.description)}</small></button>`).join('')}</section>`:''}
      <section aria-labelledby="library-title"><div class="section-head"><h2 id="library-title">${m?'Funciones de este módulo':'Función por función'}</h2><span id="result-count"></span></div><div class="filters"><label class="search"><span class="sr-only">Buscar una función</span><input id="search" type="search" placeholder="Buscá una tarea: recibir, cliente, GPS…" value="${esc(query)}" autocomplete="off"></label><label><span class="sr-only">Filtrar por rol</span><select id="role"><option value="">Todos los roles</option>${roles.map(r=>`<option ${role===r?'selected':''}>${esc(r)}</option>`).join('')}</select></label></div><div id="cards" class="cards"></div></section>
      ${!m?'<section class="statusboard" aria-label="Límites de la práctica"><div><b>Datos de ejemplo</b><p>Demo Hogar, sus unidades y los mapas son ficticios. No uses esta guía como confirmación de una operación real.</p></div><div><b>Universo · QuadMinds</b><p>Su conexión sigue pendiente de contrato y credenciales del proveedor. El ejercicio explica el circuito previsto.</p></div><div><b>Comprobación física pendiente</b><p>Pasarela conectada no prueba el GPS de tu celular. La guía te muestra cómo verificar una medición nueva.</p></div></section>':''}`;
    cards();$('search').addEventListener('input',e=>{query=e.target.value;cards();});$('role').addEventListener('change',e=>{role=e.target.value;cards();});
  }
  function fields(step){return (step.fields||[]).map((f,i)=>`<label class="sim-field ${f.wide?'wide':''}">${esc(f.label)}${f.options?`<select name="f${i}" aria-label="${esc(f.label)}">${f.options.map(v=>`<option ${v===f.value?'selected':''}>${esc(v)}</option>`).join('')}</select>`:`<input name="f${i}" type="${f.type||'text'}" aria-label="${esc(f.label)}" required value="${esc(f.blank&&!done(current.id,index)?'':f.value)}" ${f.type==='number'?'step="any"':''} autocomplete="off" placeholder="${esc(f.value)}">`}</label>`).join('');}
  function lesson(){
    const step=current.steps[index],isDone=done(current.id,index),jIndex=journey?.ids.indexOf(current.id);
    last={id:current.id,step:index};save();nav();
    $('main').innerHTML=`<div class="bread"><button data-home>Biblioteca</button><span>/</span><button data-module="${current.module}">${esc(modules.find(m=>m.id===current.module).name)}</button><span>/</span><span>Práctica guiada</span></div><header class="lesson-heading"><div><div>${current.roles.map(r=>`<span class="role">${esc(r)}</span>`).join('')}</div><h1>${esc(current.title)}</h1><p class="muted">${esc(current.description)}</p></div><div class="lesson-tools"><button class="quiet" data-restart>↺ Repetir</button><button class="quiet" data-print>Imprimir pasos</button></div></header>
      ${journey?`<div class="route-strip"><span>${esc(journey.title)}</span><strong>Etapa ${jIndex+1} de ${journey.ids.length}</strong><button class="quiet" data-exit-tour>Salir del recorrido</button></div>`:''}
      ${current.pending?'<div class="pending">Conexión externa pendiente. Este ejercicio explica el circuito de Universo; no habilita QuadMinds.</div>':''}
      <div class="learning-layout"><section class="practice" aria-label="Pantalla de práctica"><header class="practice-top"><strong>NEXORA OS</strong><span>SIMULACIÓN · NO MODIFICA TU OS</span></header><div class="practice-path">${esc(step.path||current.steps[0].path||modules.find(m=>m.id===current.module).name)}</div><div class="practice-body"><h2>${esc(step.screen||step.title)}</h2><p class="practice-sub">Representación simplificada · todos los valores son de ejemplo</p>${step.tabs?`<div class="sim-tabs">${step.tabs.map(t=>`<span class="sim-tab">${esc(t)}</span>`).join('')}</div>`:''}
      ${step.metrics?`<div class="sim-metrics">${step.metrics.map(([value,label])=>`<div class="sim-metric"><strong>${esc(value)}</strong><small>${esc(label)}</small></div>`).join('')}</div>`:''}
      ${step.rows?`<div class="sim-list">${step.rows.map(([a,b])=>`<div class="sim-row"><strong>${esc(a)}</strong><span>${esc(b)}</span></div>`).join('')}</div>`:''}
      ${step.code?`<div class="code">${esc(step.code)}</div>`:''}${step.map?'<div class="map" aria-label="Mapa ilustrativo, no es una ubicación real"><div class="map-pin"></div><small>MAPA ILUSTRATIVO · SIN DATOS GPS REALES</small></div>':''}${step.photo?'<div class="photo-placeholder">▧ Foto de ejemplo · en el OS adjuntá evidencia real</div>':''}
      ${step.download?`<button class="secondary" data-download="${step.download}">Descargar CSV ficticio ↓</button>`:''}<form id="practice-form"><div class="sim-fields">${fields(step)}</div><div class="practice-actions"><button class="primary ${isDone?'':'target'}" id="practice-action" type="submit" ${isDone?'disabled':''}>${isDone?'✓ Paso realizado':esc(step.action)}</button>${step.fields&&!isDone?'<button class="example" type="button" data-example>Usar datos de ejemplo</button>':''}</div><p id="form-error" class="form-error" role="alert"></p></form><div id="step-result" ${isDone?'':'hidden'} class="result" role="status"><strong>✓ Resultado de la práctica</strong><p>${esc(step.result)}</p></div></div></section>
      <aside class="coach" aria-label="Instrucciones del paso"><div class="coach-step"><strong>PASO ${String(index+1).padStart(2,'0')}</strong><span>${index+1} de ${current.steps.length}</span></div><progress value="${index+1}" max="${current.steps.length}" aria-label="Posición en la función"></progress><h2>${esc(step.title)}</h2><p class="instruction">${esc(step.instruction)}</p><div class="expectation"><b>Qué debe pasar</b>${esc(step.result)}</div>${step.why||step.tip?`<details class="why"><summary>¿Por qué? / Si no funciona</summary>${step.why?`<p>${esc(step.why)}</p>`:''}${step.tip?`<p>${esc(step.tip)}</p>`:''}</details>`:''}<ol class="step-index">${current.steps.map((v,i)=>`<li><button data-step="${i}" ${i===index?'aria-current="step"':''} class="${done(current.id,i)?'done':''}"><b>${done(current.id,i)?'✓':i+1}</b>${esc(v.title)}</button></li>`).join('')}</ol><div class="prereq"><strong>Antes de empezar</strong>${esc(current.prereq)}</div></aside></div>
      <footer class="lesson-footer"><button class="secondary" id="previous" ${index===0?'disabled':''}>← Anterior</button><span>Realizá la acción señalada para avanzar.</span><button class="primary" id="next" ${isDone?'':'disabled'}>${index===current.steps.length-1?'Completar función':'Continuar'} →</button></footer><section class="print-only"><h2>${esc(current.title)}</h2><p>Antes: ${esc(current.prereq)}</p>${current.steps.map((v,i)=>`<article class="print-step"><h2>${i+1}. ${esc(v.title)}</h2><p>${esc(v.instruction)}</p><strong>Acción: ${esc(v.action)}</strong><p>Resultado: ${esc(v.result)}</p>${v.tip?`<p>${esc(v.tip)}</p>`:''}</article>`).join('')}</section>`;
    $('practice-form').addEventListener('submit',event=>{
      event.preventDefault();if(done(current.id,index))return;
      const data=new FormData(event.target);
      const mismatch=(step.fields||[]).findIndex((f,i)=>f.expect&&normalize(data.get('f'+i)?.trim())!==normalize(f.expect));
      if(mismatch>=0){$('form-error').textContent=`Para este ejercicio, usá “${step.fields[mismatch].expect}” en ${step.fields[mismatch].label}.`;event.target.elements.namedItem('f'+mismatch).focus();return;}
      if(!progress[current.id])progress[current.id]=[];progress[current.id].push(index);save();
      $('form-error').textContent='';$('step-result').hidden=false;$('practice-action').disabled=true;$('practice-action').classList.remove('target');$('practice-action').textContent='✓ Paso realizado';$('next').disabled=false;
      document.querySelector('[data-example]')?.remove();nav();
      const item=document.querySelector(`[data-step="${index}"]`);item?.classList.add('done');if(item)item.querySelector('b').textContent='✓';
      announce('Paso realizado. '+step.result);
    });
    $('previous').addEventListener('click',()=>go(guideHash(current.id,index-1,journey)));
    $('next').addEventListener('click',()=>{if(!done(current.id,index))return;if(index<current.steps.length-1)go(guideHash(current.id,index+1,journey));else if(complete(current.id))go(`#final/${current.id}${journey?'/'+journey.id:''}`);else{const missing=current.steps.findIndex((_,i)=>!done(current.id,i));go(guideHash(current.id,missing,journey));}});
  }
  function completed(){
    nav();const nextId=journey?journey.ids[journey.ids.indexOf(current.id)+1]:current.steps.findLast(v=>v.next)?.next;
    const next=byId(nextId);const allJourney=journey&&!next;
    $('main').innerHTML=`<div class="bread"><button data-home>Biblioteca</button><span>/</span><span>Función completada</span></div><section class="celebrate"><span aria-hidden="true">✓</span><span class="eyebrow">${allJourney?'RECORRIDO COMPLETADO':'PRÁCTICA COMPLETADA'}</span><h1>${allJourney?'Ya recorriste el circuito.':esc(current.title)}</h1><p>Completaste ${current.steps.length} pasos de esta función. La operación real se realiza en el OS, con datos y evidencia reales.</p><div class="complete-actions">${next?`<button class="primary" data-continue-guide="${next.id}">Seguir: ${esc(next.title)} →</button>`:'<button class="primary" data-home>Elegir otra función</button>'}<button class="secondary" data-restart>Repetir práctica</button><a class="secondary" href="https://nexora-logistic-production.up.railway.app" target="_blank" rel="noreferrer">Ir al OS real ↗</a></div></section><div class="section-head"><h2>Más de este módulo</h2></div><div class="cards">${guides.filter(g=>g.module===current.module&&g.id!==current.id).slice(0,6).map(card).join('')}</div>`;
  }
  function route(){
    const [kind,id,n,j]=location.hash.slice(1).split('/');
    if(kind==='guia'&&byId(id)){
      current=byId(id);index=Math.min(Math.max(Math.trunc(Number(n)||1)-1,0),current.steps.length-1);journey=journeys.find(x=>x.id===j&&x.ids.includes(id))||null;lesson();
    }else if(kind==='final'&&byId(id)&&complete(id)){
      current=byId(id);journey=journeys.find(x=>x.id===n&&x.ids.includes(id))||null;completed();
    }else{moduleId=kind==='modulo'&&modules.some(m=>m.id===id)?id:'';library();}
    window.scrollTo({top:0,behavior:'instant'});$('main').focus({preventScroll:true});
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.dataset.guide)go(guideHash(b.dataset.guide));
    else if(b.dataset.module){query='';go('#modulo/'+b.dataset.module);}
    else if(b.dataset.journey){const j=journeys.find(x=>x.id===b.dataset.journey);go(guideHash(j.ids[0],0,j));}
    else if(b.hasAttribute('data-home')||b.id==='home'){query='';go('#inicio');}
    else if(b.hasAttribute('data-clear')){query='';role='';$('search').value='';$('role').value='';cards();}
    else if(b.hasAttribute('data-resume')&&last)go(guideHash(last.id,last.step));
    else if(b.hasAttribute('data-step'))go(guideHash(current.id,Number(b.dataset.step),journey));
    else if(b.hasAttribute('data-example'))(current.steps[index].fields||[]).forEach((f,i)=>{$('practice-form').elements.namedItem('f'+i).value=f.value;});
    else if(b.hasAttribute('data-restart')){progress[current.id]=[];save();go(guideHash(current.id,0,journey));}
    else if(b.hasAttribute('data-exit-tour'))go(guideHash(current.id,index));
    else if(b.dataset.continueGuide)go(guideHash(b.dataset.continueGuide,0,journey));
    else if(b.hasAttribute('data-print'))window.print();
    else if(b.dataset.download){
      const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Asuncion'}).format(new Date());
      const csv=b.dataset.download==='catalogo'?'sku,name,barcode,tracking,unit,weightGrams,volumeCm3\nDEMO-001,Toalla demo,000000000001,QUANTITY,unidad,500,1000\nDEMO-002,Vaso demo,000000000002,QUANTITY,unidad,200,500\nDEMO-003,Equipo demo,000000000003,SERIAL,unidad,1000,2000\n':`externalId,date,destination,recipientName,sku,quantity\nPED-DEMO-001,${date},Direccion de ejemplo - Asuncion,Destinatario Demo,DEMO-001,2\n`;
      const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
      const a=document.createElement('a');a.href=url;a.download=`${b.dataset.download}-demo-hogar.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      announce('CSV ficticio descargado. Importalo únicamente en la demo aislada.');
    }
  });
  $('help').addEventListener('click',()=>$('help-dialog').showModal());
  for(const id of ['close-help','start-help'])$(id).addEventListener('click',()=>$('help-dialog').close());
  window.addEventListener('hashchange',route);route();
})();
