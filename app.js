import geography from './assets/europe-map.js';
import { synchronizeTrainWindows } from './train-windows.js';

const countries = [
  {id:'PT',name:'Португалия',city:'Лиссабон',description:'Океан за окном. Солнечные улицы. Время для нового ритма жизни.',tags:['Атлантика','Тёплый ритм','Новые горизонты'],image:'assets/lisbon.jpg',alt:'Панорама Лиссабона с красными крышами и рекой Тежу'},
  {id:'ES',name:'Испания',city:'Барселона',description:'Город, который живёт на улице. Море, архитектура и место для ваших планов.',tags:['Средиземноморье','Жизнь в городе','Солнечные дни'],image:'assets/countries/es.jpg',alt:'Городской пейзаж Барселоны'},
  {id:'FR',name:'Франция',city:'Париж',description:'Утро с кофе. Долгая прогулка. Своя история среди знакомых с детства пейзажей.',tags:['Культура','Большие города','Новые знакомства'],image:'assets/countries/fr.jpg',alt:'Париж, вид на Марсово поле'},
  {id:'DE',name:'Германия',city:'Берлин',description:'Ритм большого города и простор для идей. Найдите место для своей следующей главы.',tags:['Городская жизнь','Идеи и культура','В центре Европы'],image:'assets/countries/de.jpg',alt:'Архитектурный вид Германии'},
  {id:'IT',name:'Италия',city:'Рим',description:'Красота в повседневном. Разговоры на площади. Жизнь, которой хочется наслаждаться.',tags:['История','Южный характер','Искусство жить'],image:'assets/countries/it.jpg',alt:'Исторический городской пейзаж Италии'},
  {id:'PL',name:'Польша',city:'Краков',description:'Исторические улицы, современные кварталы и новый взгляд на привычные вещи.',tags:['Города и природа','Новый ритм','Центральная Европа'],image:'assets/countries/pl.jpg',alt:'Вавельский замок в Кракове'},
  {id:'CZ',name:'Чехия',city:'Прага',description:'Мосты над Влтавой. Уютные кварталы. Возможно, именно здесь вы почувствуете себя дома.',tags:['Прага','Архитектура','В сердце Европы'],image:'assets/countries/cz.jpg',alt:'Прага и мосты через Влтаву'},
  {id:'HU',name:'Венгрия',city:'Будапешт',description:'Два берега одного города. Дунай, красивые вечера и ваша новая точка отсчёта.',tags:['Дунай','Городская культура','Новые впечатления'],image:'assets/countries/hu.jpg',alt:'Будапешт на берегу Дуная'},
  {id:'GR',name:'Греция',city:'Афины',description:'Море, свет и простор. Больше простых радостей в каждом новом дне.',tags:['Средиземноморье','Древняя история','Южный ритм'],image:'assets/countries/gr.jpg',alt:'Архитектурный пейзаж Греции'}
];
const $ = s => document.querySelector(s);
const purposeNames = {move:'Переезд',work:'Работа',study:'Учёба'};
let selected='PT', purpose='move', filter='all', savedPlan=null, zoom=1;
try {savedPlan=JSON.parse(localStorage.getItem('visa2go-route'));if(savedPlan&&countries.some(c=>c.id===savedPlan.country)){selected=savedPlan.country;purpose=Object.hasOwn(purposeNames,savedPlan.purpose)?savedPlan.purpose:'move';}} catch {}
const ns='http://www.w3.org/2000/svg';
function svgNode(tag,attrs){const n=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;}
const mapGroup=$('#map-geography'), labelGroup=$('#map-labels');
geography.features.forEach(f=>{
  const active=countries.some(c=>c.id===f.id);
  const p=svgNode('path',{d:f.path,class:'country-path'+(active?' selectable':''),'data-country':f.id});
  const t=svgNode('title',{});t.textContent=f.name;p.append(t);
  if(active){p.setAttribute('role','button');p.setAttribute('tabindex','0');p.setAttribute('aria-label',`Выбрать страну: ${f.name}`);p.addEventListener('click',()=>selectCountry(f.id));p.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectCountry(f.id);}});p.addEventListener('mouseenter',()=>{$('#map-tooltip').textContent=f.name;$('#map-tooltip').classList.add('visible');});p.addEventListener('mouseleave',()=>$('#map-tooltip').classList.remove('visible'));p.addEventListener('focus',()=>{$('#map-tooltip').textContent=f.name;$('#map-tooltip').classList.add('visible');});p.addEventListener('blur',()=>$('#map-tooltip').classList.remove('visible'));
    const label=svgNode('text',{x:f.cx,y:f.cy,class:'map-label','data-label':f.id});label.textContent=f.id==='PT'?'PT':f.name;labelGroup.append(label);
  }
  mapGroup.append(p);
});
for(const c of countries){
  for(const select of [$('#country-select'),$('#plan-country')]){const opt=document.createElement('option');opt.value=c.id;opt.textContent=c.name;select.append(opt);}
  const button=document.createElement('button');button.dataset.country=c.id;button.innerHTML=`<span>${c.id}</span> ${c.name}`;button.addEventListener('click',()=>selectCountry(c.id));$('#country-list').append(button);
}
function selectCountry(id){
  const c=countries.find(c=>c.id===id);if(!c)return;selected=id;
  $('#country-select').value=id;$('#plan-country').value=id;
  document.querySelectorAll('.country-path.selectable').forEach(p=>{const on=p.dataset.country===id;p.classList.toggle('selected',on);p.setAttribute('aria-pressed',on);});
  document.querySelectorAll('.map-label').forEach(p=>p.classList.toggle('selected',p.dataset.label===id));
  document.querySelectorAll('#country-list button').forEach(p=>p.setAttribute('aria-pressed',p.dataset.country===id));
  $('#country-name').textContent=c.name;$('#country-code').textContent=c.id;
  $('#country-number').textContent=`${String(countries.indexOf(c)+1).padStart(2,'0')} / 09`;
  $('#country-description').textContent=filter==='all'?c.description:({move:'Выбрали страну для новой жизни? Сохраним направление и соберём вопросы для подготовки к переезду.',work:'Новая профессиональная глава начинается с плана. Сохраним страну и список вопросов о работе и документах.',study:'Новый город, новые знания. Сохраним направление и подготовим вопросы об учёбе и документах.'})[filter];
  $('#city-name').textContent=`${c.city}, ${c.name}`.toUpperCase();
  const img=$('#destination-image');img.src=c.image;img.alt=c.alt;
  if(zoom>1)focusedZoom(zoom);
  $('#country-tags').replaceChildren(...(filter==='all'?c.tags:[purposeNames[filter],...c.tags.slice(0,2)]).map(t=>{const span=document.createElement('span');span.textContent=t;return span;}));
}
$('#country-select').addEventListener('change',e=>selectCountry(e.target.value));
document.querySelectorAll('[data-filter]').forEach(btn=>btn.addEventListener('click',()=>{filter=btn.dataset.filter;if(filter!=='all')purpose=filter;document.querySelectorAll('[data-filter]').forEach(b=>{b.classList.toggle('active',b===btn);b.setAttribute('aria-pressed',b===btn);});selectCountry(selected);}));
// Zoom toward the selected country so coastal destinations stay visible.
function focusedZoom(z){zoom=Math.max(1,Math.min(2.5,z));const f=geography.features.find(f=>f.id===selected);const w=820/zoom,h=620/zoom;const x=Math.max(0,Math.min(820-w,(f?.cx??410)-w/2));const y=Math.max(0,Math.min(620-h,(f?.cy??310)-h/2));$('#europe-map').setAttribute('viewBox',`${x} ${y} ${w} ${h}`);$('#zoom-in').disabled=zoom>=2.5;$('#zoom-out').disabled=zoom<=1;}
$('#zoom-in').addEventListener('click',()=>focusedZoom(zoom+.3));$('#zoom-out').addEventListener('click',()=>focusedZoom(zoom-.3));$('#zoom-reset').addEventListener('click',()=>focusedZoom(1));
const video=$('#journey-video');let manuallyPaused=false;const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
synchronizeTrainWindows(video, document.querySelectorAll('.side-video'));
function reflectPlayback(){const paused=video.paused;$('#play-symbol').textContent=paused?'▶':'Ⅱ';$('#play-label').textContent=paused?'Продолжить путешествие':'За окном — жизнь';$('#video-toggle').setAttribute('aria-label',paused?'Воспроизвести видео':'Приостановить видео');document.querySelector('.train').classList.toggle('motion-paused',paused);}
video.addEventListener('play',reflectPlayback);video.addEventListener('pause',reflectPlayback);
$('#video-toggle').addEventListener('click',()=>{if(video.paused){manuallyPaused=false;video.play().catch(()=>showToast('Нажмите ещё раз, чтобы запустить видео'));}else{manuallyPaused=true;video.pause();}});
if(reduceMotion.matches){manuallyPaused=true;video.pause();}else{video.play().catch(reflectPlayback);}reflectPlayback();
document.addEventListener('visibilitychange',()=>{if(document.hidden)video.pause();else if(!manuallyPaused&&!reduceMotion.matches)video.play().catch(()=>{});});
reduceMotion.addEventListener('change',e=>{if(e.matches){manuallyPaused=true;video.pause();}});
const dialog=$('#plan-dialog');let lastFocused=null;
function showForm(){ dialog.setAttribute('aria-labelledby','plan-title');$('#plan-form-panel').hidden=false;$('#plan-result').hidden=true;$('#plan-country').value=selected;$('#plan-purpose').value=purpose;if(savedPlan?.time)$('#plan-time').value=savedPlan.time; }
function openPlan(){lastFocused=document.activeElement;showForm();dialog.showModal();document.body.style.overflow='hidden';}
document.querySelectorAll('[data-plan]').forEach(b=>b.addEventListener('click',openPlan));
$('#close-dialog').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
dialog.addEventListener('close',()=>{document.body.style.overflow='';lastFocused?.focus();});
$('#plan-form').addEventListener('submit',e=>{e.preventDefault();purpose=$('#plan-purpose').value;selectCountry($('#plan-country').value);savedPlan={country:selected,purpose,time:$('#plan-time').value};let persisted=true;try{localStorage.setItem('visa2go-route',JSON.stringify(savedPlan));}catch{persisted=false;}$('#plan-form-panel').hidden=true;$('#plan-result').hidden=false;dialog.setAttribute('aria-labelledby','result-title');$('#result-route').textContent=`${countries.find(c=>c.id===selected).name} → ${purposeNames[purpose]} · ${savedPlan.time}`;$('#plan-result .local-note').textContent=persisted?'План сохранён на этом устройстве. Это список для подготовки, а не перечень визовых требований.':'Скачайте маршрут, чтобы сохранить его. Хранилище браузера сейчас недоступно.';$('#download-plan').focus();});
$('#edit-plan').addEventListener('click',()=>{showForm();$('#plan-country').focus();});
$('#download-plan').addEventListener('click',()=>{if(!savedPlan)return;const c=countries.find(c=>c.id===savedPlan.country);const content=`visa2go — Мой маршрут\n\nСтрана: ${c.name}\nЦель: ${purposeNames[savedPlan.purpose]}\nКогда: ${savedPlan.time}\n\nПЕРВЫЕ ШАГИ\n1. Проверить условия въезда для вашего гражданства на официальном сайте консульства.\n2. Уточнить основание и нужные документы для выбранной цели.\n3. Спланировать бюджет, жильё и сроки поездки.\n4. Составить вопросы для консультации со специалистом.\n\nЭто список для подготовки, а не перечень визовых требований.\n`;const blob=new Blob(['\ufeff',content],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`visa2go-${c.id.toLowerCase()}-route.txt`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);showToast('Маршрут готов к сохранению');});
let toastTimer;function showToast(text){$('#toast').textContent=text;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3500);}
selectCountry(selected);focusedZoom(1);
