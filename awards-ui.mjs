import {normalizeRules,emptyRules,honorsForRows,pruneCeremonyHistory,ceremonyEntries,nextCeremonyEntry,parseTeamDetailsCSV,contestKey} from './awards.mjs';
import {shortName,teamInfo} from './engine.mjs';
import {decodeText} from './zip.mjs';
import {validateRosterMembers} from './roster.mjs';

const $=id=>document.getElementById(id),roman=['','I','II','III'];
const displayName=team=>team.displayName??shortName(team.name);
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function download(name,text){const url=URL.createObjectURL(new Blob(['\uFEFF'+text],{type:'text/csv;charset=utf-8'}));const link=el('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const csv=value=>{let text=String(value??'');if(/^[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};

export function mountAwards({getContest,getRows,getStep=()=>0,getAwardTeamId=()=>null,pause,resume,onChange,onClose=()=>{},notify}){
 let rules=emptyRules(),details={},draft={},auto=true,key='',seen=new Map(),entries=[],index=0,preview=false,autoShow=false,resumable=false,rosterMode=false;
 const safeDetails=(data,teams)=>Object.fromEntries(teams.filter(team=>data?.[team.id]).map(team=>[team.id,{...Object.fromEntries(['coach','members','organization'].map(field=>[field,typeof data[team.id][field]==='string'?data[team.id][field].slice(0,4000):''])),rosterReviewed:data[team.id].rosterReviewed===true}]));
 function persist(){try{localStorage.setItem(key,JSON.stringify({rules,details,auto}));}catch{notify('Настройки работают, но браузер не разрешил сохранить их после закрытия вкладки.',true);}}
 function loadContest(contest){
  rules=emptyRules();details=Object.fromEntries(contest.teams.filter(team=>team.rosterDetails).map(team=>[team.id,{...team.rosterDetails}]));auto=true;rosterMode=false;seen=new Map();key=contestKey(contest);
  try{const saved=JSON.parse(localStorage.getItem(key));if(saved){rules=normalizeRules(saved.rules,contest.teams.length);const overrides=safeDetails(saved.details,contest.teams);for(const [id,meta] of Object.entries(overrides))details[id]={...details[id],...meta};auto=saved.auto!==false;}}catch{}
  $('awards-dialog').close();$('ceremony-dialog').close();
 }
 function renderDetails(){
  const contest=getContest();if(!contest)return;
  const query=$('metadata-search').value.trim().toLocaleLowerCase('ru'),fragment=document.createDocumentFragment();
  for(const team of contest.teams){
   if(query&&!team.name.toLocaleLowerCase('ru').includes(query)&&!team.id.includes(query))continue;
   const tr=el('tr');tr.dataset.id=team.id;
   const label=el('td');label.append(el('strong','',displayName(team)),el('small','',team.id));tr.append(label);
   for(const field of ['coach','members','organization']){const td=el('td'),input=el(field==='members'?'textarea':'input');if(field!=='members')input.type='text';else input.rows=3;input.maxLength=4000;input.value=draft[team.id]?.[field]??'';input.dataset.team=team.id;input.dataset.field=field;input.setAttribute('aria-label',({coach:'Тренер ',members:'Участники ',organization:'Организация '}[field])+displayName(team));if(field==='members')input.placeholder=teamInfo(team.name);td.append(input);tr.append(td);}
   fragment.append(tr);
  }
  $('metadata-body').replaceChildren(fragment);$('metadata-count').textContent=Object.values(draft).filter(d=>d.coach?.trim()).length+' команд с тренером';
 }
 function openSettings(teamId){
  const contest=getContest();if(!contest)return;pause();draft=structuredClone(details);
  for(let degree=1;degree<=3;degree++){const range=rules.degrees.find(d=>d.degree===degree);$('degree-'+degree+'-from').value=range?.from??'';$('degree-'+degree+'-to').value=range?.to??'';for(const side of ['from','to'])$('degree-'+degree+'-'+side).max=contest.teams.length;}
  $('qualify-until').value=rules.qualifyUntil||'';$('qualify-until').max=contest.teams.length;$('qualifying-places').value=rules.qualifyingPlaces.join(', ');$('wild-card-places').value=rules.wildCardPlaces.join(', ');$('auto-ceremony').checked=auto;
  $('metadata-search').value=teamId??'';$('awards-error').hidden=true;renderDetails();if(!$('awards-dialog').open)$('awards-dialog').showModal();
  if(teamId)$('metadata-body').querySelector('[data-field=coach]')?.focus();
 }
 function saveSettings(event){
  event.preventDefault();
  try{
   if(getContest().rosterOnly)for(const team of getContest().teams)validateRosterMembers(draft[team.id]?.members,displayName(team));
   const next=normalizeRules({degrees:[1,2,3].map(degree=>({degree,from:$('degree-'+degree+'-from').value,to:$('degree-'+degree+'-to').value})),qualifyUntil:$('qualify-until').value,qualifyingPlaces:$('qualifying-places').value,wildCardPlaces:$('wild-card-places').value},getContest().teams.length);
   rules=next;details=structuredClone(draft);auto=$('auto-ceremony').checked;seen.clear();persist();$('awards-dialog').close();onChange();notify('Степени, проход и данные тренеров сохранены.');
  }catch(error){$('awards-error').textContent=error.message;$('awards-error').hidden=false;}
 }
 function refreshEntries(){entries=ceremonyEntries(getRows(),rules,{preview});index=Math.min(index,Math.max(0,entries.length-1));renderCard();}
 function photoMode(enabled){$('ceremony-dialog').classList.toggle('photo-mode',enabled);$('ceremony-photo').setAttribute('aria-pressed',String(enabled));if(enabled&&$('ceremony-dialog').open)$('ceremony-dialog').focus();}
 function renderCard(){
  const row=entries[index];$('ceremony-card').hidden=!row;$('ceremony-empty').hidden=!!row;
  if(row&&!preview&&!rosterMode&&!seen.has(row.team.id))seen.set(row.team.id,getStep());
  $('ceremony-select').replaceChildren(...entries.map((entry,i)=>{const option=el('option','',(entry.rank==null?'':entry.rank+'. ')+displayName(entry.team));option.value=i;return option;}));$('ceremony-select').value=index;$('ceremony-select').disabled=!row;
  $('ceremony-mode').textContent=rosterMode?(getContest().label||'Текущий тур')+' · составы команд':preview?'Предварительный показ · текущие места':autoShow?'Итоговое место определено':'Награждение · итоговые места';
  $('ceremony-counter').textContent=row?(index+1)+' / '+entries.length:'';$('ceremony-previous').disabled=index===0||!row;$('ceremony-next').disabled=!row;$('ceremony-next').textContent=index===entries.length-1?'К таблице →':'Следующая команда →';$('ceremony-resume').hidden=!resumable;
  if(!row){const configured=rules.degrees.length||rules.qualifyUntil||rules.qualifyingPlaces.length||rules.wildCardPlaces.length;$('ceremony-empty-text').textContent=configured?'У награждаемых команд ещё могут измениться места. Продолжите разморозку или откройте явно предварительный показ.':'Сначала задайте диапазоны степеней и места прошедших команд в настройках.';$('ceremony-preview').hidden=!configured||preview;return;}
  const meta=details[row.team.id]??{},honors=row.honors;$('ceremony-card').className='ceremony-card'+(honors.degree?' diploma-'+honors.degree:'')+(honors.qualified||honors.wildCard?' qualified-card':'');
  $('ceremony-ribbon').textContent=honors.qualified?'Проходит в следующий этап':honors.wildCard?'Приглашение в следующий этап · Wild card':'Диплом олимпиады';
  const badges=[];if(honors.degree)badges.push(el('span','degree-medallion',roman[honors.degree]));if(honors.qualified)badges.push(el('span','qualification-badge','Прошли дальше · '+honors.qualifyingRank+'-е в отборе'));if(honors.wildCard)badges.push(el('span','qualification-badge','Wild card · '+honors.qualifyingRank+'-е в отборе'));$('ceremony-badges').replaceChildren(...badges);
  $('ceremony-team-name').textContent=displayName(row.team);$('ceremony-organization').textContent=meta.organization||'';
  $('ceremony-score').hidden=rosterMode;
  if(rosterMode)$('ceremony-ribbon').textContent='Команда текущего тура';
  $('ceremony-roster-note').hidden=!row.team.rosterIssue||meta.rosterReviewed===true;
  $('ceremony-roster-note').textContent='Состав требует проверки: в исходной таблице есть расхождение.';
  document.querySelector('.ceremony-card-footer').textContent=rosterMode?'Команда · три участника · тренер':'Монитор олимпиады · поздравляем команду!';
  $('ceremony-score').replaceChildren(...[['место',row.rank],['решено',row.solved],['штраф',row.penalty]].map(([label,value])=>{const n=el('div');n.append(el('strong','',value),el('span','',label));return n;}));
  if(honors.degree)$('ceremony-ribbon').append(document.createTextNode(' · '+roman[honors.degree]+' степень'));
  if(meta.members&&meta.members.includes('\n'))$('ceremony-members').replaceChildren(...meta.members.split(/\r?\n/).filter(Boolean).map(name=>el('span','person-line',name)));
  else $('ceremony-members').textContent=meta.members||teamInfo(row.team.name)||'Состав не указан';
  $('ceremony-coach').textContent=meta.coach||'Тренер не указан';
  $('ceremony-card').getAnimations().forEach(a=>a.cancel());if(!matchMedia('(prefers-reduced-motion: reduce)').matches)$('ceremony-card').animate([{opacity:0,transform:'translateY(12px)'},{opacity:1,transform:'translateY(0)'}],{duration:260,easing:'ease-out'});
 }
 function openCeremony(){if(!getContest())return;if(getContest().rosterOnly){showRosterCard();return;}pause();photoMode(false);rosterMode=false;autoShow=false;resumable=false;preview=false;index=0;refreshEntries();$('ceremony-dialog').showModal();}
 function showRosterCard(teamId){if(!getContest())return;pause();photoMode(false);rosterMode=true;autoShow=false;resumable=false;preview=false;entries=getContest().teams.map(team=>({team,rank:null,honors:{degree:null,qualified:false,wildCard:false}}));index=Math.max(0,entries.findIndex(row=>row.team.id===teamId));renderCard();if(!$('ceremony-dialog').open)$('ceremony-dialog').showModal();}
 function closeCeremony(){$('ceremony-dialog').close();}
 function nextCard(){if(index>=entries.length-1)closeCeremony();else{index++;renderCard();}}
 function pendingEntry(){return !auto||getContest()?.rosterOnly?null:nextCeremonyEntry(getRows(),rules,seen);}
 function showPending(teamId){
  if($('awards-dialog').open||$('ceremony-dialog').open)return false;
  const row=pendingEntry();if(!row||(teamId!==undefined&&row.team.id!==teamId))return false;
  resumable=!!pause();rosterMode=false;entries=[row];index=0;preview=false;autoShow=true;photoMode(true);renderCard();$('ceremony-dialog').showModal();return true;
 }
 function observe(){
  if(getContest()?.rosterOnly)return;
  seen=pruneCeremonyHistory(getRows(),seen,getStep());
 }
 function decorations(){if(getContest()?.rosterOnly)return new Map();const announcedIds=new Set(seen.keys());const selected=getAwardTeamId();if(selected!==null)announcedIds.add(selected);return honorsForRows(getRows(),rules,{announcedIds});}
 function resetProgress(){seen.clear();}
 function setTeamDetails(id,meta){if(!getContest().teams.some(team=>team.id===id))return;details[id]={...details[id],...meta};persist();onChange();}

 $('awards-open').addEventListener('click',()=>openSettings());$('ceremony-open').addEventListener('click',openCeremony);$('awards-form').addEventListener('submit',saveSettings);$('metadata-search').addEventListener('input',renderDetails);
 $('metadata-body').addEventListener('input',event=>{const {team,field}=event.target.dataset;if(!team||!field)return;draft[team]??={};draft[team][field]=event.target.value;$('metadata-count').textContent=Object.values(draft).filter(d=>d.coach?.trim()).length+' команд с тренером';});
 $('metadata-import').addEventListener('click',()=>$('metadata-file').click());$('metadata-file').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  try{if(file.size>2_000_000)throw new Error('CSV: максимальный размер — 2 МБ.');const parsed=parseTeamDetailsCSV(decodeText(new Uint8Array(await file.arrayBuffer())),getContest().teams);const next=structuredClone(draft);for(const [id,meta] of Object.entries(parsed)){if(getContest().rosterOnly&&meta.members!==undefined)validateRosterMembers(meta.members,displayName(getContest().teams.find(team=>team.id===id)));next[id]={...next[id],...meta};}draft=next;$('awards-error').hidden=true;renderDetails();notify('CSV прочитан. Нажмите «Сохранить», чтобы применить данные.');}catch(error){$('awards-error').textContent=error.message;$('awards-error').hidden=false;}finally{event.target.value='';}
 });
 $('metadata-template').addEventListener('click',()=>{const rows=[['team_id','team_name','coach','members','organization'],...getContest().teams.map(team=>[team.id,displayName(team),draft[team.id]?.coach??'',draft[team.id]?.members??'',draft[team.id]?.organization??''])];download('monitor-coaches.csv',rows.map(row=>row.map(csv).join(';')).join('\r\n'));});
 $('ceremony-close').addEventListener('click',closeCeremony);$('ceremony-previous').addEventListener('click',()=>{index=Math.max(0,index-1);renderCard();});$('ceremony-next').addEventListener('click',nextCard);$('ceremony-select').addEventListener('change',event=>{index=Number(event.target.value);renderCard();});
 $('ceremony-dialog').addEventListener('cancel',event=>{event.preventDefault();closeCeremony();});
 $('ceremony-dialog').addEventListener('close',onClose);
 $('ceremony-photo').addEventListener('click',()=>photoMode(true));
 $('ceremony-preview').addEventListener('click',()=>{preview=true;autoShow=false;index=0;refreshEntries();});$('ceremony-settings').addEventListener('click',()=>{$('ceremony-dialog').close();openSettings();});$('ceremony-resume').addEventListener('click',()=>{closeCeremony();resume();});
 $('ceremony-dialog').addEventListener('keydown',event=>{if(event.target.tagName==='SELECT')return;if(event.key==='ArrowRight'||event.code==='Space'){event.preventDefault();event.stopPropagation();if(!event.repeat)nextCard();}else if(event.key==='ArrowLeft'){event.preventDefault();event.stopPropagation();if(!event.repeat){index=Math.max(0,index-1);renderCard();}}});
 return {loadContest,observe,decorations,resetProgress,openSettings,showRosterCard,showPending,pendingEntry,hasPending:()=>!!pendingEntry(),setTeamDetails,detailsFor:id=>details[id]??{},rules:()=>rules};
}
