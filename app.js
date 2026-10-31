import geography from './assets/world-map.js';
import {synchronizeTrainWindows} from './train-windows.js';
import {purposes, findCountry, contactError, contactHref, safeImage, safeApiBase} from './core.js';
const $ = s => document.querySelector(s);
const all = s => [...document.querySelectorAll(s)];
const create = (tag, text, cls) => {const n=document.createElement(tag); if(text)n.textContent=text;if(cls)n.className=cls;return n;};
let catalog, apiBase=null, collectionEnabled=false, selection={citizenship:'',destination:'',purpose:'study'};
let mapSelected='CZ', zoom=1, submitPending=false, requestId=null, submittedFingerprint=null,lastAttemptFingerprint=null;
let activeTrigger=null;
const configResponse=await fetch('config/site.json');
if(!configResponse.ok) throw new Error('Configuration unavailable');
const config=await configResponse.json();
catalog=config.catalog;
apiBase=safeApiBase(config.apiBase,location.origin);
const isPublicPreview=location.hostname.endsWith('.github.io');
if(apiBase && !isPublicPreview) {
  try {
    const response=await fetch(apiBase+'/api/catalog',{signal:AbortSignal.timeout(8000),credentials:'omit'});
    if(!response.ok)throw new Error();
    const state=await response.json();
    if(!Array.isArray(state.catalog?.destinations))throw new Error();
    catalog=state.catalog;
    collectionEnabled=state.collectionEnabled===true;
  } catch {$('#preview-notice').textContent='Связь с сервисом заявок временно недоступна. Можно изучить направления и подготовить заявку.';}
}
const countries=catalog.destinations.filter(c=>c.services?.some(s=>purposes[s]));
const citizenships=[...catalog.citizenships];
const displayNames=new Intl.DisplayNames(['ru'],{type:'region'});
// ISO 3166 country codes, displayed locally without a third-party request.
const iso='AF AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BA BW BR BN BG BF BI CV KH CM CA KY CF TD CL CN CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UY UZ VU VA VE VN VG VI WF EH YE ZM ZW'.split(' ');
for(const id of iso) if(!citizenships.some(c=>c.id===id))citizenships.push({id,name:displayNames.of(id)});
citizenships.push({id:'other',name:'Другая страна'});
function setOptions(selector, values){$(selector).replaceChildren(...values.map(c=>{const o=create('option');o.value=c.name;return o;}));}
setOptions('#citizenship-options',citizenships);
setOptions('#residence-options',citizenships.filter(c=>c.id!=='other'));
setOptions('#destination-options',[...countries,{id:'undecided',name:'Ещё выбираю'}]);
const otherCitizenField=create('div',null,'field');
otherCitizenField.id='other-citizenship-field';otherCitizenField.hidden=true;
const otherCitizenLabel=create('label','Укажите страну гражданства');otherCitizenLabel.htmlFor='citizenship-other';
const otherCitizenInput=create('input');otherCitizenInput.id='citizenship-other';otherCitizenInput.maxLength=100;
otherCitizenField.append(otherCitizenLabel,otherCitizenInput);$('#selection-editor').append(otherCitizenField);
function toggleOtherCitizenship(){
  const isOther=findCountry(citizenships,$('#application-citizenship').value)?.id==='other';
  otherCitizenField.hidden=!isOther;otherCitizenInput.required=isOther;
  if(isOther)$('#selection-editor').hidden=false;
}
for (const [id,p] of Object.entries(purposes)) {
  const label=create('label',null,'purpose-option'), input=create('input'), span=create('span',p.name);
  input.type='radio';input.name='purpose';input.value=id;input.checked=id===selection.purpose;
  input.addEventListener('change',()=>{selection.purpose=id;});
  label.append(input,span);$('#hero-purposes').append(label);
}
function destinationByInput(value){return findCountry([...countries,{id:'undecided',name:'Ещё выбираю',services:Object.keys(purposes)}],value);}
function updateHeroServices(){
  const c=destinationByInput($('#destination').value);
  all('[name=purpose]').forEach(input=>{input.disabled=!!c&&!c.services.includes(input.value);});
  if(c&&!c.services.includes(selection.purpose)){selection.purpose=c.services[0];const radio=$('[name=purpose][value="'+selection.purpose+'"]');if(radio)radio.checked=true;}
}
$('#destination').addEventListener('input',()=>{$('#destination').setCustomValidity('');updateHeroServices();});
$('#citizenship').addEventListener('input',()=>$('#citizenship').setCustomValidity(''));
function syncHero(){
  $('#citizenship').value=citizenships.find(c=>c.id===selection.citizenship)?.name||'';
  $('#destination').value=countries.find(c=>c.id===selection.destination)?.name||(selection.destination==='undecided'?'Ещё выбираю':'');
  const radio=$('[name=purpose][value="'+selection.purpose+'"]');if(radio)radio.checked=true;updateHeroServices();
}
function track(type) {
  if(!apiBase||!collectionEnabled||isPublicPreview||navigator.doNotTrack==='1')return;
  const payload={type};
  if(selection.destination)payload.destination=selection.destination;
  if(selection.purpose)payload.purpose=selection.purpose;
  fetch(apiBase+'/api/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),credentials:'omit',keepalive:true}).catch(()=>{});
}
function modalOpen(dialog){
  if(!all('dialog').some(d=>d.open))activeTrigger=document.activeElement;
  for(const d of all('dialog')) if(d.open)d.close();
  dialog.showModal();document.body.style.overflow='hidden';
}
all('[data-close]').forEach(btn=>btn.addEventListener('click',()=>{if(!submitPending)btn.closest('dialog').close();}));
all('dialog').forEach(dialog=>{
  dialog.addEventListener('cancel',e=>{if(submitPending)e.preventDefault();});
  dialog.addEventListener('close',()=>{if(!all('dialog').some(d=>d.open)){document.body.style.overflow='';activeTrigger?.focus();}});
  dialog.addEventListener('click',e=>{if(submitPending||e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();});
});
function choiceButton(id, detailed=false){
  const p=purposes[id],button=create('button',null,detailed?'service-choice':'');
  button.type='button';button.dataset.service=id;
  if(detailed){const text=create('div');text.append(create('strong',p.name),create('small',p.description));button.append(text,create('span','↗'));}else button.textContent=p.name;
  button.addEventListener('click',()=>{selection.destination=mapSelected;selection.purpose=id;openApplication();});
  return button;
}
function showServices(id) {
  selectCountry(id);$('#service-title').textContent=countries.find(c=>c.id===id).name;
  $('#service-choices').replaceChildren(...countries.find(c=>c.id===id).services.filter(s=>purposes[s]).map(s=>choiceButton(s,true)));
  modalOpen($('#service-dialog'));
}
for(const c of countries.filter(c=>c.popular).slice(0,5)){
  const button=create('button',null,'country-tile');button.type='button';button.setAttribute('aria-label','Выбрать направление: '+c.name);
  const imageWrap=create('div',null,'tile-image'),img=create('img');img.src=safeImage(c.image);img.alt=c.alt||c.name;img.loading='lazy';imageWrap.append(img);
  const title=create('span',c.name,'tile-title');title.append(create('b','↗'));
  button.append(imageWrap,create('span',c.id,'tile-code'),title,create('span',c.city||'Узнать о направлении','tile-caption'));
  button.addEventListener('click',()=>showServices(c.id));$('#popular-countries').append(button);
}
const ns='http://www.w3.org/2000/svg';
for(const feature of geography.features){
  const path=document.createElementNS(ns,'path');path.setAttribute('d',feature.path);path.setAttribute('fill-rule','evenodd');path.setAttribute('class','country-path');
  const title=document.createElementNS(ns,'title');title.textContent=feature.name;path.append(title);
  if(countries.some(c=>c.id===feature.id)){
    path.classList.add('selectable');path.dataset.country=feature.id;path.setAttribute('role','button');path.setAttribute('tabindex','0');path.setAttribute('aria-label','Выбрать страну: '+feature.name);
    path.addEventListener('click',()=>{selectCountry(feature.id);setZoom(Math.max(zoom,3.5));});
    path.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();selectCountry(feature.id);setZoom(Math.max(zoom,3.5));}});
    for(const evt of ['mouseenter','focus'])path.addEventListener(evt,()=>{$('#map-tooltip').textContent=feature.name;$('#map-tooltip').classList.add('visible');});
    for(const evt of ['mouseleave','blur'])path.addEventListener(evt,()=>$('#map-tooltip').classList.remove('visible'));
  }else path.setAttribute('aria-hidden','true');
  $('#map-geography').append(path);
}
for(const c of countries){const b=create('button',c.name);b.type='button';b.dataset.country=c.id;b.addEventListener('click',()=>{selectCountry(c.id);setZoom(3.5);});$('#country-list').append(b);}
function selectCountry(id) {
  const country=countries.find(c=>c.id===id);if(!country)return;
  mapSelected=id;selection.destination=id;
  if(!country.services.includes(selection.purpose))selection.purpose=country.services[0];
  $('#map-country').value=country.name;
  $('#country-name').textContent=country.name;$('#country-code').textContent=country.id;
  $('#destination-image').src=safeImage(country.image);$('#destination-image').alt=country.alt||country.name;
  $('#country-services').replaceChildren(...country.services.filter(s=>purposes[s]).map(s=>choiceButton(s)));
  all('[data-country]').forEach(el=>{const on=el.dataset.country===id;el.classList.toggle('selected',on);el.setAttribute('aria-pressed',on);});
  $('#map-service-note').textContent=catalog.reviewed?'Возможность оформления уточняется для вашей ситуации.':'Категории показаны для предпросмотра. Список услуг уточняется.';
  if(zoom>1)setZoom(zoom);
}
function setZoom(value){
  zoom=Math.max(1,Math.min(8,value));const f=geography.features.find(f=>f.id===mapSelected);
  const width=1000/zoom,height=520/zoom;
  const x=Math.max(0,Math.min(1000-width,(f?.cx||500)-width/2)),y=Math.max(0,Math.min(520-height,(f?.cy||260)-height/2));
  $('#world-map').setAttribute('viewBox',[x,y,width,height].join(' '));
  $('#zoom-in').disabled=zoom>=8;$('#zoom-out').disabled=zoom<=1;
}
$('#zoom-in').addEventListener('click',()=>setZoom(zoom*1.8));
$('#zoom-out').addEventListener('click',()=>setZoom(zoom/1.8));
$('#zoom-reset').addEventListener('click',()=>setZoom(1));
$('#map-country').addEventListener('input',e=>{const c=findCountry(countries,e.target.value);if(c){selectCountry(c.id);setZoom(3.5);}});
$('#map-country').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();const c=findCountry(countries,e.target.value);if(c)showServices(c.id);}});
$('#destination-count').textContent='МИР / '+countries.length+' НАПРАВЛЕНИЙ';
mapSelected=countries.some(c=>c.id==='CZ')?'CZ':countries[0]?.id;
if(mapSelected)selectCountry(mapSelected);
selection.destination=''; // The map preview never chooses a route on the visitor's behalf.
setZoom(1);
function summaryText(){return [citizenships.find(c=>c.id===selection.citizenship)?.name||'Укажите гражданство',countries.find(c=>c.id===selection.destination)?.name||'Ещё выбираю',purposes[selection.purpose]?.name].join(' → ');}
function refreshPurposeSelect(){
  const c=destinationByInput($('#application-destination').value);const services=c?.services||Object.keys(purposes);
  $('#application-purpose').replaceChildren(...services.filter(s=>purposes[s]).map(id=>{const opt=create('option',purposes[id].name);opt.value=id;return opt;}));
  $('#application-purpose').value=services.includes(selection.purpose)?selection.purpose:services[0];
}
function openApplication(){
  const heroCitizen=findCountry(citizenships,$('#citizenship').value);
  if(heroCitizen)selection.citizenship=heroCitizen.id;
  if(!selection.destination){const c=destinationByInput($('#destination').value);selection.destination=c?.id||'undecided';}
  $('#application-panel').hidden=false;$('#application-result').hidden=true;$('#application-error').hidden=true;
  $('#application-dialog').setAttribute('aria-labelledby','application-title');
  $('#application-summary').textContent=summaryText();
  $('#application-citizenship').value=citizenships.find(c=>c.id===selection.citizenship)?.name||'';
  $('#application-destination').value=countries.find(c=>c.id===selection.destination)?.name||'Ещё выбираю';
  refreshPurposeSelect();$('#selection-editor').hidden=!!selection.citizenship;toggleOtherCitizenship();
  // Required controls remain enabled; all are populated before they are hidden.
  syncHero();modalOpen($('#application-dialog'));track('form_start');
  if(!selection.citizenship)$('#application-citizenship').focus();else $('#client-name').focus();
}
$('#solution-form').addEventListener('submit',e=>{
  e.preventDefault();const citizenship=findCountry(citizenships,$('#citizenship').value),destination=destinationByInput($('#destination').value);
  $('#citizenship').setCustomValidity(citizenship?'':'Выберите гражданство из списка.');
  $('#destination').setCustomValidity(destination?'':'Выберите направление из списка или «Ещё выбираю».');
  if(!$('#solution-form').reportValidity())return;
  selection={citizenship:citizenship.id,destination:destination.id,purpose:$('[name=purpose]:checked').value};
  openApplication();
});
all('[data-apply]').forEach(btn=>btn.addEventListener('click',()=>{
  selection.destination=destinationByInput($('#destination').value)?.id||'undecided';
  selection.purpose=btn.dataset.purpose||$('[name=purpose]:checked').value;
  const destination=countries.find(c=>c.id===selection.destination);
  if(destination&&!destination.services.includes(selection.purpose))selection.destination='undecided';
  openApplication();
}));
$('#edit-selection').addEventListener('click',()=>{$('#selection-editor').hidden=!$('#selection-editor').hidden;if(!$('#selection-editor').hidden)$('#application-citizenship').focus();});
$('#application-destination').addEventListener('input',()=>{$('#application-destination').setCustomValidity('');refreshPurposeSelect();});
$('#application-citizenship').addEventListener('input',()=>{$('#application-citizenship').setCustomValidity('');toggleOtherCitizenship();});
function refreshChannel(){
  const channel=$('#channel').value,input=$('#contact');input.setCustomValidity('');
  const settings={telegram:['Контакт в Telegram','@username или номер телефона','text','off'],whatsapp:['Номер WhatsApp','+7 000 000 00 00','tel','tel'],email:['Электронная почта','name@example.com','email','email']}[channel];
  $('#contact-label').textContent=settings[0];input.placeholder=settings[1];input.type=settings[2];input.autocomplete=settings[3];
}
$('#channel').addEventListener('change',refreshChannel);
$('#contact').addEventListener('input',()=>$('#contact').setCustomValidity(''));
$('#client-name').addEventListener('input',()=>$('#client-name').setCustomValidity(''));
$('#application-form').addEventListener('invalid',event=>{
  if(event.target.closest('#selection-editor'))$('#selection-editor').hidden=false;
},true);
function showResult(data,response){
  $('#application-panel').hidden=true;$('#application-result').hidden=false;
  $('#application-dialog').setAttribute('aria-labelledby','result-title');
  $('#result-title').textContent=response?'Заявка отправлена!':'Предпросмотр заявки';
  $('#result-copy').textContent=response?'Мы свяжемся с вами, чтобы обсудить вашу ситуацию и возможные варианты решения.':'Так будет выглядеть ваш запрос. Приём заявок пока не подключён: данные не отправлены и не сохранены.';
  $('#result-details').replaceChildren();
  const receiptRoute=[data.citizenship==='other'?data.citizenshipOther:citizenships.find(c=>c.id===data.citizenship)?.name,countries.find(c=>c.id===data.destination)?.name||'Ещё выбираю',purposes[data.purpose]?.name].join(' → ');
  const pairs=[['Имя',data.name],['Направление',receiptRoute],['Связь',{telegram:'Telegram',whatsapp:'WhatsApp',email:'Email'}[data.channel]+' · '+data.contact]];
  if(response)pairs.push(['Номер заявки',response.id]);
  for(const [name,value]of pairs)$('#result-details').append(create('dt',name),create('dd',value));
  $('#result-actions').replaceChildren();
  if(response){
    const url=contactHref(data.channel,catalog.contacts[data.channel]);
    if(url){const link=create('a','Открыть '+{telegram:'Telegram',whatsapp:'WhatsApp',email:'почту'}[data.channel]+' ↗','button blue');link.href=url;link.target='_blank';link.rel='noopener noreferrer';$('#result-actions').append(link);}
    $('#edit-application').textContent='Новая заявка';
  } else $('#edit-application').textContent='Вернуться к заявке';
  $('#application-result').focus();
}
$('#application-form').addEventListener('submit',async e=>{
  e.preventDefault();if(submitPending)return;
  const citizen=findCountry(citizenships,$('#application-citizenship').value),destination=destinationByInput($('#application-destination').value);
  if(!citizen||!destination){$('#selection-editor').hidden=false;$('#application-citizenship').setCustomValidity(citizen?'':'Выберите гражданство из списка.');$('#application-destination').setCustomValidity(destination?'':'Выберите направление из списка.');$('#application-form').reportValidity();return;}
  $('#contact').setCustomValidity(contactError($('#channel').value,$('#contact').value));
  $('#client-name').setCustomValidity($('#client-name').value.trim()?'':'Укажите ваше имя.');
  if(!$('#application-form').reportValidity())return;
  selection={citizenship:citizen.id,destination:destination.id,purpose:$('#application-purpose').value};syncHero();
  const data={requestId:requestId||crypto.randomUUID(),name:$('#client-name').value.trim(),contact:$('#contact').value.trim(),channel:$('#channel').value,...selection,residence:$('#residence').value.trim(),comment:$('#comment').value.trim(),consent:$('#consent').checked,website:$('#website').value};
  if(citizen.id==='other')data.citizenshipOther=otherCitizenInput.value.trim();
  if(!collectionEnabled){showResult(data,null);return;}
  const fingerprint=JSON.stringify({...data,requestId:undefined});if(submittedFingerprint===fingerprint)return;
  if(lastAttemptFingerprint!==fingerprint)requestId=crypto.randomUUID();
  data.requestId=requestId;lastAttemptFingerprint=fingerprint;
  submitPending=true;$('#application-form').inert=true;$('#submit-application').disabled=true;$('#submit-application').textContent='Отправляем…';$('#application-error').hidden=true;
  try {
    const response=await fetch(apiBase+'/api/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),credentials:'omit',signal:AbortSignal.timeout(15000)});
    const result=await response.json().catch(()=>({}));
    if(!response.ok||result.ok!==true||!result.id)throw new Error(response.status===429?'Слишком много попыток. Подождите немного и отправьте заявку ещё раз.':response.status===503?'Приём заявок временно недоступен. Ваши данные не отправлены.':typeof result.error==='string'?result.error:'Не удалось отправить заявку. Проверьте связь и повторите попытку.');
    submittedFingerprint=fingerprint;track('form_submit');showResult(data,result);
  } catch(error){$('#application-error').textContent=error.name==='TimeoutError'?'Не удалось получить подтверждение. Повторная попытка безопасна и не создаст дубликат.':error.message;$('#application-error').hidden=false;}
  finally{submitPending=false;$('#application-form').inert=false;$('#submit-application').disabled=false;$('#submit-application').textContent='Отправить заявку ↗';}
});
$('#edit-application').addEventListener('click',()=>{
  if(submittedFingerprint){$('#application-form').reset();submittedFingerprint=null;requestId=null;lastAttemptFingerprint=null;refreshChannel();openApplication();return;}
  $('#application-result').hidden=true;$('#application-panel').hidden=false;$('#application-dialog').setAttribute('aria-labelledby','application-title');$('#client-name').focus();
});
function renderContacts(){
  for(const [id,label]of Object.entries({telegram:'Telegram',whatsapp:'WhatsApp',email:'Электронная почта'})){
    const href=contactHref(id,catalog.contacts?.[id]);
    const el=create(href?'a':'span',label,href?'':'pending');
    if(href){el.href=href;if(id!=='email'){el.target='_blank';el.rel='noopener noreferrer';}}else el.title='Контакт будет опубликован после подключения команды';
    $('#contact-links').append(el);
  }
  const company=catalog.company;
  if(company?.legalName)$('#company-details').textContent=[company.legalName,company.registrationId,company.address].filter(Boolean).join(' · ');
}
renderContacts();
if(collectionEnabled){
  $('#preview-notice').hidden=true;$('#catalog-note').textContent='Возможность оформления зависит от гражданства, страны проживания и индивидуальных обстоятельств.';
  $('#submit-application').textContent='Отправить заявку ↗';
  $('#submission-note').textContent='Заявка поступит нашей команде. Мы свяжемся с вами выбранным способом.';
  $('#consent-text').replaceChildren(document.createTextNode('Согласен на обработку данных для ответа на заявку в соответствии с '));
  const link=create('a','политикой конфиденциальности');link.href='privacy.html';link.target='_blank';link.rel='noopener';$('#consent-text').append(link);
}
track('page_view');
const video=$('#journey-video'),reduced=matchMedia('(prefers-reduced-motion: reduce)');let manuallyPaused=false;
synchronizeTrainWindows(video,all('.side-video'));
function reflectPlayback(){const paused=video.paused;$('#play-symbol').textContent=paused?'▶':'Ⅱ';$('#play-label').textContent=paused?'Продолжить путешествие':'За окном — жизнь';$('#video-toggle').setAttribute('aria-label',paused?'Воспроизвести видео':'Приостановить видео');}
video.addEventListener('play',reflectPlayback);video.addEventListener('pause',reflectPlayback);
$('#video-toggle').addEventListener('click',()=>{if(video.paused){manuallyPaused=false;video.play().catch(reflectPlayback);}else{manuallyPaused=true;video.pause();}});
if(reduced.matches||navigator.connection?.saveData){manuallyPaused=true;video.pause();}else video.play().catch(reflectPlayback);
document.addEventListener('visibilitychange',()=>{if(document.hidden)video.pause();else if(!manuallyPaused&&!reduced.matches)video.play().catch(()=>{});});
reduced.addEventListener('change',e=>{if(e.matches){manuallyPaused=true;video.pause();}});reflectPlayback();
