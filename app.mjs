import {parseContest,scoreboard,buildTimeline,revealedCells,submissionIsVisible,shortName,teamInfo,cellKey} from './engine.mjs';
import {readTimusZip,decodeText} from './zip.mjs';
import {mountAwards} from './awards-ui.mjs';
import {captureRowPositions,animateRows,clearRowMotion} from './row-motion.mjs';
import {parseRosterCSV,rosterContest,bindRoster,memberLines,rosterCSV} from './roster.mjs';
import {SITE_CONFIG} from './site-config.mjs';

const $=id=>document.getElementById(id);
const format=new Intl.NumberFormat('ru-RU');
const state={contest:null,timeline:null,config:{duration:300,hidden:60,from:68,to:1},step:0,playing:false,view:'board',query:'',rows:[],timer:null,selectedTeam:null,importing:false,finished:false,currentRoster:null};
let toastTimer,dragDepth=0,importVersion=0,awardFrameTimer;

function icon(name){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  const use=document.createElementNS(svg.namespaceURI,'use');use.setAttribute('href',`#i-${name}`);svg.append(use);svg.setAttribute('aria-hidden','true');return svg;
}
function node(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
function text(id,value){$(id).textContent=value;}
function toast(message,error=false){clearTimeout(toastTimer);text('toast',message);$('toast').classList.toggle('error',error);$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,error?8000:3800);}
const configFreeze=config=>config.hidden===0?Infinity:config.duration-config.hidden;
const freezeMinute=()=>configFreeze(state.config);
const currentEvent=()=>state.step>0?state.timeline.events[state.step-1]:null;
const normalized=value=>String(value).toLocaleLowerCase('ru');
const matches=team=>!state.query||normalized(team.name).includes(state.query)||team.id.includes(state.query);

function visibility(){return {freeze:freezeMinute(),revealed:revealedCells(state.timeline.events,state.step),completeIds:state.finished?state.timeline.selectedIds:[]};}
function stop(){clearTimeout(state.timer);clearTimeout(awardFrameTimer);state.timer=null;state.playing=false;renderPlayback();}
function schedule(){clearTimeout(state.timer);if(state.playing)state.timer=setTimeout(()=>{moveTo(state.step+1,true);if(state.playing)schedule();},Number($('speed').value));}
function play(){
  if(!state.contest||state.importing)return;
  if(state.playing){stop();return;}
  if(!state.timeline.events.length){toast('В выбранном диапазоне нет задач со скрытыми посылками.');return;}
  if(state.step>=state.timeline.events.length)moveTo(0);
  state.playing=true;renderPlayback();moveTo(state.step+1,true);schedule();
}
function moveTo(value,automatic=false){
  if(!state.timeline)return;
  if(!automatic)stop();
  const previous=state.step;
  state.step=Math.max(0,Math.min(state.timeline.events.length,Number(value)||0));
  state.finished=state.step===state.timeline.events.length&&state.step>0;
  if(state.finished){clearTimeout(state.timer);state.timer=null;state.playing=false;}
  const motionTeamId=state.timeline.events[(state.step>previous?state.step:previous)-1]?.teamId;
  render({follow:state.step>previous,advance:state.step>previous,motionTeamId});
}

function validatedConfig(){
  const read=id=>{const value=$(id).value;if(!value.trim())return NaN;return Number(value);};
  const duration=read('duration'),hidden=read('hidden-minutes'),from=read('rank-from'),to=read('rank-to');
  if(!Number.isInteger(duration)||duration<1||duration>100000)throw new Error('Длительность: целое число от 1 до 100 000 минут.');
  if(duration<state.contest.maxMinute)throw new Error(`В логе есть посылка на ${state.contest.maxMinute}-й минуте. Увеличьте длительность олимпиады.`);
  if(!Number.isInteger(hidden)||hidden<0||hidden>duration)throw new Error(`Период скрытия: от 0 до ${duration} минут.`);
  if(![from,to].every(n=>Number.isInteger(n)&&n>=1&&n<=state.contest.teams.length))throw new Error(`Места: целые числа от 1 до ${state.contest.teams.length}.`);
  return {duration,hidden,from,to};
}

function reflectInputs(){
  const {config,contest}=state;
  $('duration').value=config.duration;$('hidden-minutes').value=config.hidden;$('hidden-minutes').max=config.duration;
  $('rank-from').value=config.from;$('rank-to').value=config.to;
  for(const id of ['rank-from','rank-to'])$(id).max=contest.teams.length;
  $('settings-error').hidden=true;previewHint();
}
function previewHint(){
  const duration=Number($('duration').value),hidden=Number($('hidden-minutes').value);
  document.querySelectorAll('[data-minutes]').forEach(button=>button.classList.toggle('selected',Number(button.dataset.minutes)===hidden));
  if(Number.isFinite(duration)&&Number.isFinite(hidden)&&duration>0&&hidden>=0&&hidden<=duration)text('freeze-hint',hidden===0?'Все результаты будут видны сразу.':`Результаты с ${duration-hidden}-й минуты будут скрыты.`);
  else text('freeze-hint','Укажите период от 0 до длительности олимпиады.');
}

function applyConfig(event){
  event?.preventDefault();if(!state.contest||state.importing)return;
  try{
    const config=validatedConfig();
    const timeline=buildTimeline(state.contest,{freeze:configFreeze(config),from:config.from,to:config.to});
    stop();state.config=config;state.timeline=timeline;state.step=0;state.finished=false;
    $('settings-error').hidden=true;render();toast('Настройки применены. Раскрытие начнётся с первого шага.');
  }catch(error){text('settings-error',error.message);$('settings-error').hidden=false;}
}

function commitContest(contest,label,config,timeline,datasetKey=null){
  if(!contest.rosterOnly&&state.currentRoster)contest=bindRoster(contest,state.currentRoster).contest;
  stop();state.contest=contest;state.config=config;state.timeline=timeline;state.step=0;state.query='';state.selectedTeam=null;state.finished=false;
  state.view=contest.rosterOnly?'roster':'board';document.body.classList.toggle('roster-only',!!contest.rosterOnly);document.title='Monitor — '+label;
  document.querySelectorAll('[data-view]').forEach(button=>{const active=button.dataset.view===state.view;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));button.disabled=!!contest.rosterOnly&&button.dataset.view!=='roster';});
  awards.loadContest(contest);
  if(contest.rosterOnly&&state.currentRoster)syncRegistryDetails();
  $('roster-edit-dialog').close();
  $('search').value='';text('dataset-name',label);text('dataset-status',`${format.format(contest.teams.length)} команд · ${format.format(contest.submissions.length)} посылок`);
  $('team-dialog').close();reflectInputs();$('loading-state').hidden=true;render();
  if(datasetKey){$('dataset-select').querySelector('[value="custom"]')?.remove();$('dataset-select').value=datasetKey;}
  else{
    $('dataset-select').querySelector('[value="custom"]')?.remove();
    const option=node('option','',label);option.value='custom';$('dataset-select').append(option);$('dataset-select').value='custom';
  }
}

async function loadDemo(initial=false){
  const version=++importVersion;
  state.importing=true;stop();renderPlayback();
  try{
    const demos=SITE_CONFIG.datasets;
    const key=demos[$('dataset-select').value]?$('dataset-select').value:SITE_CONFIG.defaultDataset,demo=demos[key];
    if(demo.roster){const response=await fetch(demo.file);if(!response.ok)throw new Error('Не удалось загрузить пример составов.');const registry=parseRosterCSV(await response.text());if(version!==importVersion)return;activateRoster(registry,demo.label,key);return;}
    const responses=await Promise.all([fetch(`./data/${demo.prefix}full.log`),fetch(`./data/${demo.prefix}teams.txt`)]);
    if(responses.some(response=>!response.ok))throw new Error('Не удалось загрузить пример. Загрузите архив логов вручную.');
    const [log,teams]=await Promise.all(responses.map(response=>response.text()));
    const contest=parseContest(log,teams),config={duration:300,hidden:60,from:contest.teams.length,to:1};
    const timeline=buildTimeline(contest,{freeze:240,from:config.from,to:1});
    if(demo.rosterFile){const response=await fetch(demo.rosterFile);if(response.ok)state.currentRoster=parseRosterCSV(await response.text());}
    if(version!==importVersion)return;
    commitContest(contest,demo.label,config,timeline,key);
    if(!initial)toast(`${demo.label}: логи загружены.`);
  }catch(error){if(version===importVersion){toast(error.message,true);if(!state.contest){text('loading-state',error.message);text('dataset-status','Загрузите ваши логи');}}}
  finally{if(version===importVersion){state.importing=false;renderPlayback();}}
}

function activateRoster(registry,label,datasetKey=null){
  state.currentRoster=registry;const contest=rosterContest(registry,label),config={duration:300,hidden:60,from:contest.teams.length,to:1};
  const timeline=buildTimeline(contest,{freeze:240,from:config.from,to:1});commitContest(contest,label,config,timeline,datasetKey);
}

async function importRoster(file){
  if(!file)return;const version=++importVersion;state.importing=true;stop();
  try{if(file.size>2_000_000)throw new Error('Максимальный размер CSV — 2 МБ.');const registry=parseRosterCSV(decodeText(new Uint8Array(await file.arrayBuffer())));if(version!==importVersion)return;activateRoster(registry,file.name.replace(/\.(csv|tsv)$/i,''));toast('Составы загружены: '+registry.teams.length+' команд.');}
  catch(error){toast(error.message,true);}finally{if(version===importVersion){state.importing=false;renderPlayback();}$('roster-file').value='';}
}

async function importFiles(fileList){
  const files=[...fileList];if(!files.length)return;
  const version=++importVersion;
  state.importing=true;stop();renderPlayback();text('dataset-status','Читаем файлы…');
  try{
    if(files.some(file=>file.size>32_000_000))throw new Error('Файл больше 32 МБ. Выберите архив только с логами.');
    const archives=files.filter(file=>file.name.toLowerCase().endsWith('.zip'));
    let log='',teams='',label='';
    if(archives.length){
      if(archives.length!==1||files.length!==1)throw new Error('Выберите один ZIP или пару full.log + teams.txt.');
      const archive=archives[0];({log,teams}=await readTimusZip(await archive.arrayBuffer()));
      const id=archive.name.match(/log[-_](\d+)/i)?.[1];label=id?`Турнир №${id}`:archive.name.replace(/\.zip$/i,'');
    }else{
      const logFile=files.find(file=>file.name.toLowerCase()==='full.log')??files.find(file=>file.name.toLowerCase().endsWith('.log'));
      const teamsFile=files.find(file=>file.name.toLowerCase()==='teams.txt');
      if(!logFile)throw new Error('Выберите full.log и, при наличии, teams.txt вместе.');
      if(files.some(file=>file!==logFile&&file!==teamsFile))throw new Error('Нужны только full.log и teams.txt. Уберите остальные файлы.');
      [log,teams]=await Promise.all([logFile.arrayBuffer().then(bytes=>decodeText(new Uint8Array(bytes))),teamsFile?teamsFile.arrayBuffer().then(bytes=>decodeText(new Uint8Array(bytes))):Promise.resolve('')]);
      label=logFile.name==='full.log'?'Ваш турнир':logFile.name.replace(/\.log$/i,'');
    }
    const contest=parseContest(log,teams);
    const duration=Math.max(60,Math.ceil((contest.maxMinute+1)/60)*60);
    const config={duration,hidden:Math.min(60,duration),from:contest.teams.length,to:1};
    const timeline=buildTimeline(contest,{freeze:configFreeze(config),from:config.from,to:1});
    if(version!==importVersion)return;
    commitContest(contest,label,config,timeline);
    toast(teams?'Логи загружены. Настройте последние N минут и начните раскрытие.':'Лог загружен. Без teams.txt команды подписаны по ID.');
  }catch(error){
    if(version===importVersion){toast(error.message,true);if(state.contest)text('dataset-status',`${state.contest.teams.length} команд · ${format.format(state.contest.submissions.length)} посылок`);else text('dataset-status','Не удалось прочитать файлы');}
  }finally{if(version===importVersion){state.importing=false;renderPlayback();}$('file-input').value='';}
}

function render({follow=false,advance=false,motionTeamId}={}){
  if(!state.contest)return;
  clearTimeout(awardFrameTimer);
  state.rows=state.contest.rosterOnly?state.contest.teams.map(team=>({team,rank:null,solved:null,penalty:null,cells:{}})):scoreboard(state.contest,{freeze:freezeMinute(),events:state.timeline.events,step:state.step});
  renderSummary();
  if(state.view==='roster')renderRoster();else if(state.view==='board')renderBoard({follow,motionTeamId});else renderSubmissions();
  renderPlayback();if($('team-dialog').open&&state.selectedTeam)renderTeam();
  awards.observe();
  if(advance){const at=state.step;awardFrameTimer=setTimeout(()=>{if(state.step===at)awards.observe({advance:true});},Math.min(600,Number($('speed').value)*.65)+50);}
}

function syncRegistryDetails(){
  if(!state.currentRoster||!state.contest?.rosterOnly)return;
  for(const item of state.currentRoster.teams){const team=state.contest.teams.find(team=>team.id===item.id);if(!team)continue;const details=awards.detailsFor(item.id);item.members=memberLines(details,team);item.coach=details.coach||'';item.issue=details.rosterReviewed?null:team.rosterIssue;}
}

function renderRoster(){
  $('score-table').hidden=true;$('submissions-table').hidden=true;$('roster-table').hidden=false;
  const fragment=document.createDocumentFragment(),teams=state.contest.teams.filter(matches);
  let unresolved=0;
  for(const team of state.contest.teams)if(team.rosterIssue&&!awards.detailsFor(team.id).rosterReviewed)unresolved++;
  $('roster-note').hidden=unresolved===0;
  $('roster-note').textContent=unresolved?'Состав требует проверки у '+unresolved+' команд: в CSV различаются три столбца участников и отдельные строки. Нажмите «Проверить состав».':'';
  for(const team of teams){
    const details=awards.detailsFor(team.id),names=memberLines(details,team),tr=node('tr');tr.dataset.rosterId=team.id;
    const nameCell=node('td');nameCell.dataset.label='Команда';const name=node('button','roster-name-button',team.displayName??shortName(team.name));name.dataset.rosterCard=team.id;nameCell.append(name);
    if(team.rosterIssue&&!details.rosterReviewed){const review=node('button','roster-review-button','Проверить состав');review.dataset.rosterEdit=team.id;nameCell.append(review);}
    tr.append(nameCell);
    for(let i=0;i<3;i++){const td=node('td',names[i]?'':'missing',names[i]||'Не указан');td.dataset.label=['Первый участник','Второй участник','Третий участник'][i];tr.append(td);}
    const coach=node('td',details.coach?'':'missing',details.coach||'Не указан');coach.dataset.label='Тренер';tr.append(coach);
    const actions=node('td','roster-actions'),card=node('button','','Карточка'),edit=node('button','','Править');card.dataset.rosterCard=team.id;edit.dataset.rosterEdit=team.id;card.setAttribute('aria-label','Карточка команды '+(team.displayName??team.name));edit.setAttribute('aria-label','Редактировать состав '+(team.displayName??team.name));actions.append(card,edit);tr.append(actions);fragment.append(tr);
  }
  $('roster-body').replaceChildren(fragment);$('empty-state').hidden=teams.length!==0;text('row-count',teams.length+' из '+state.contest.teams.length+' команд');
}

let editingRosterId=null;
function openRosterEditor(id){
  const team=state.contest.teams.find(team=>team.id===id);if(!team)return;stop();editingRosterId=id;
  const details=awards.detailsFor(id),names=memberLines(details,team);
  text('roster-edit-title',team.displayName??shortName(team.name));
  for(let i=0;i<3;i++)$('roster-member-'+(i+1)).value=names[i];
  $('roster-coach').value=details.coach??'';$('roster-conflict').hidden=!team.rosterIssue;$('roster-reviewed-label').hidden=!team.rosterIssue;
  $('roster-reviewed').checked=details.rosterReviewed===true;
  if(team.rosterIssue){text('roster-summary-variant',team.rosterIssue.summaryMembers.join('\n'));text('roster-individual-variant',team.rosterIssue.individualMembers.join('\n'));}
  $('roster-edit-dialog').showModal();
}
function chooseRosterVariant(which){
  const team=state.contest.teams.find(team=>team.id===editingRosterId),names=team?.rosterIssue?.[which];if(!names)return;
  names.forEach((name,i)=>$('roster-member-'+(i+1)).value=name);$('roster-reviewed').checked=true;
}
$('roster-body').addEventListener('click',event=>{const card=event.target.closest('[data-roster-card]'),edit=event.target.closest('[data-roster-edit]');if(card)awards.showRosterCard(card.dataset.rosterCard);if(edit)openRosterEditor(edit.dataset.rosterEdit);});
$('roster-edit-form').addEventListener('submit',event=>{event.preventDefault();const members=[1,2,3].map(i=>$('roster-member-'+i).value.trim());if(members.some(name=>!name))return;awards.setTeamDetails(editingRosterId,{members:members.join('\n'),coach:$('roster-coach').value.trim(),rosterReviewed:$('roster-reviewed').checked});$('roster-edit-dialog').close();});
$('roster-use-summary').addEventListener('click',()=>chooseRosterVariant('summaryMembers'));
$('roster-use-individual').addEventListener('click',()=>chooseRosterVariant('individualMembers'));
$('roster-upload').addEventListener('click',()=>$('roster-file').click());
$('roster-file').addEventListener('change',event=>importRoster(event.target.files[0]));
$('roster-export').addEventListener('click',()=>{if(!state.contest)return;const csv=rosterCSV(state.contest.teams,id=>awards.detailsFor(id)),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),link=node('a');link.href=url;link.download='УРКОП 2026 — команды и тренеры.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
function renderSummary(){
  $('roster-note').hidden=state.view!=='roster';
  $('roster-export').hidden=state.view!=='roster';$('range-label').hidden=!!state.contest.rosterOnly;
  $('ceremony-open').textContent=state.contest.rosterOnly?'Карточки команд':'Награждение';
  if(state.contest.rosterOnly){$('status-badge').textContent='Составы · результатов пока нет';text('stat-hidden','0');text('nav-count','');const coached=state.contest.teams.filter(team=>awards.detailsFor(team.id).coach?.trim()).length;text('dataset-status',state.contest.teams.length+' команд · '+state.contest.teams.length*3+' участников · '+coached+' команд с тренером');return;}
  const hidden=state.rows.reduce((total,row)=>total+Object.values(row.cells).reduce((sum,cell)=>sum+cell.pending,0),0);
  text('stat-hidden',format.format(hidden));text('nav-count',format.format(state.contest.submissions.length));
  const badge=$('status-badge');badge.className='status-badge';
  if(state.finished){badge.classList.add('finished');badge.replaceChildren(icon('check'),document.createTextNode(hidden?'Диапазон раскрыт':'Финал'));}
  else if(state.step>0){badge.classList.add('running');badge.replaceChildren(icon('play'),document.createTextNode(state.playing?'Раскрываем':'На паузе'));}
  else badge.replaceChildren(icon(state.config.hidden?'snow':'check'),document.createTextNode(state.config.hidden?'Заморожена':'Без заморозки'));
  text('range-label','Места '+state.timeline.high+' → '+state.timeline.low);
}

function updateTableMetrics(){
  if(!state.contest)return;
  const units=state.contest.problems.length+10,scale=Number($('table-scale').value);
  const minimum=Math.max(560,units*24),width=Math.max($('table-scroll').clientWidth,minimum*scale);
  const height=Math.round(Math.max(20,Math.min(48,width/units/2))*scale);
  const table=$('score-table');table.style.setProperty('--units',units);table.style.setProperty('--row-height',height+'px');
  table.style.setProperty('--cell-font',Math.round(height*.72)+'px');table.style.width=Math.round(width)+'px';table.style.minWidth=Math.round(minimum*scale)+'px';
}

function renderBoard({follow=false,motionTeamId}={}){
  $('roster-table').hidden=true;
  $('score-table').hidden=false;$('submissions-table').hidden=true;updateTableMetrics();
  const oldPositions=captureRowPositions($('table-scroll'),$('score-body'));
  if(!$('score-head').children.length||$('score-head').dataset.problems!==state.contest.problems.join(',')){
    const header=node('tr');
    for(const [label,cls] of [['Rank','rank-column'],['Team','team-column'],...state.contest.problems.map(p=>[p,'task-column']),['=','solved-column'],['T','penalty-column']]){
      const th=node('th',cls,label);th.scope='col';header.append(th);
    }
    $('score-head').replaceChildren(header);$('score-head').dataset.problems=state.contest.problems.join(',');
  }
  const selected=new Set(state.timeline.selectedIds),event=currentEvent(),fragment=document.createDocumentFragment(),revealed=revealedCells(state.timeline.events,state.step);
  const bands=new Map();let band=0,previousSolved=null;
  for(const row of state.rows){if(previousSolved!==null&&previousSolved!==row.solved)band=1-band;bands.set(row.team.id,band);previousSolved=row.solved;}
  const rows=state.rows.filter(row=>matches(row.team));
  const decorations=awards.decorations();
  for(const row of rows){
    const tr=node('tr','score-band-'+bands.get(row.team.id));tr.dataset.teamId=row.team.id;
    if(!selected.has(row.team.id))tr.classList.add('out-of-range');
    if(event?.teamId===row.team.id)tr.classList.add('active-row');
    tr.append(node('td','rank-cell',row.rank));
    const teamCell=node('td','team-cell'),name=node('button','team-name',row.team.name);name.type='button';name.title=row.team.name;name.dataset.team=row.team.id;teamCell.append(name);
    const honor=decorations.get(row.team.id);
    if(honor?.degree){teamCell.classList.add('award-'+honor.degree);const mark=node('span','honor-mark',['','I','II','III'][honor.degree]);mark.title='Диплом '+['','I','II','III'][honor.degree]+' степени';mark.setAttribute('role','img');mark.setAttribute('aria-label',mark.title);teamCell.append(mark);}
    if(honor?.qualified||honor?.wildCard){teamCell.classList.add('is-qualified');const mark=node('span','qualified-mark',honor.qualified?'→':'W');mark.title=honor.qualified?'Проходит дальше':'Wild card';mark.setAttribute('role','img');mark.setAttribute('aria-label',mark.title);teamCell.append(mark);}
    tr.append(teamCell);
    for(const problem of state.contest.problems){
      const cell=row.cells[problem],td=node('td'),el=node('div','problem-cell');
      if(cell.solved){el.classList.add('solved');el.textContent=cell.wrong?'+'+cell.wrong:'+';td.title=problem+': решено на '+cell.time+'-й минуте; неверных попыток: '+cell.wrong+'; штраф: '+cell.penalty;}
      else if(cell.pending){el.classList.add('pending');el.textContent=cell.wrong+cell.pending;td.title=problem+': скрытых посылок — '+cell.pending+'. До заморозки неверных попыток — '+cell.wrong+'.';}
      else if(cell.wrong){el.classList.add('wrong');el.textContent='–'+cell.wrong;td.title=problem+': неверных попыток — '+cell.wrong;}
      else{el.classList.add('empty');el.textContent='\u00a0';td.title=problem+': посылок нет';}
      if(revealed.has(cellKey(row.team.id,problem)))el.classList.add('revealed');
      td.append(el);tr.append(td);
    }
    const solved=node('td','solved-value',row.solved);
    if($('show-frozen-solved').checked)solved.append(node('span','frozen-count',' ('+state.timeline.frozenSolved[row.team.id]+')'));
    tr.append(solved,node('td','penalty-value',row.penalty));fragment.append(tr);
  }
  $('score-body').replaceChildren(fragment);$('empty-state').hidden=rows.length!==0;text('row-count',rows.length+' из '+state.contest.teams.length+' команд');
  animateRows({table:$('score-table'),scroller:$('table-scroll'),from:oldPositions,activeId:motionTeamId,follow:follow&&$('follow-team').checked,duration:Math.min(600,Number($('speed').value)*.65)});
}

function verdictNode(submission,visible){
  return node('span',`verdict ${visible?(submission.accepted?'accepted':'rejected'):'hidden'}`,visible?submission.verdict:'? Результат скрыт');
}
function renderSubmissions(){
  $('roster-table').hidden=true;
  $('score-table').hidden=true;$('submissions-table').hidden=false;
  const view=visibility(),teams=new Map(state.contest.teams.map(team=>[team.id,team]));
  const submissions=state.contest.submissions.filter(s=>matches(teams.get(s.teamId))).slice().reverse();
  const fragment=document.createDocumentFragment();
  for(const submission of submissions){
    const tr=node('tr'),visible=submissionIsVisible(submission,view),name=node('button','team-name',shortName(teams.get(submission.teamId).name));name.dataset.team=submission.teamId;
    const teamTd=node('td');teamTd.append(name);const verdictTd=node('td');verdictTd.append(verdictNode(submission,visible));
    tr.append(node('td','',`${submission.minute}:00`),teamTd,node('td','',submission.problem),verdictTd,node('td','',visible?submission.test:'—'));fragment.append(tr);
  }
  $('submissions-body').replaceChildren(fragment);$('empty-state').hidden=submissions.length!==0;
  text('row-count',`Показано ${format.format(submissions.length)} из ${format.format(state.contest.submissions.length)} посылок`);
}

function renderPlayback(){
  const ready=!!state.contest&&!state.importing&&!state.contest.rosterOnly,total=state.timeline?.events.length??0,event=currentEvent();
  $('play').disabled=!ready||!total;$('next').disabled=!ready||state.step>=total;$('previous').disabled=!ready||state.step===0;
  $('finish').disabled=!ready||state.finished;$('reset').disabled=!ready;$('scrubber').disabled=!ready||!total;
  $('scrubber').max=total;$('scrubber').value=state.step;text('step-counter',`${state.step} / ${total}`);
  $('play').replaceChildren(icon(state.playing?'pause':'play'),node('span','',state.playing?'Пауза':state.finished?'Ещё раз':'Старт'));
  $('play').classList.toggle('playing',state.playing);$('play').setAttribute('aria-label',state.playing?'Приостановить разморозку':state.finished?'Повторить разморозку':'Начать разморозку');
  if(state.importing)text('playback-caption','Загружаем данные…');
  else if(state.contest?.rosterOnly)text('playback-caption','Текущий тур: составы готовы. Результаты подключаются отдельным логом.');
  else if(state.finished)text('playback-caption','Выбранный диапазон раскрыт');
  else if(event){const team=state.contest.teams.find(t=>t.id===event.teamId);text('playback-caption',`${shortName(team.name)} · ${event.problem} · ${event.accepted?'принято':'не принято'}`);}
  else text('playback-caption',total?'Всё готово к раскрытию':'Нет скрытых задач в этом диапазоне');
  const percent=total?state.step/total*100:0;$('scrubber').style.background=`linear-gradient(to right,#6983b7 ${percent}%,#ccc ${percent}%)`;
  $('apply-settings').disabled=!ready;$('upload-open').disabled=state.importing;$('load-demo').disabled=state.importing;$('dataset-select').disabled=state.importing;
  if(state.contest)renderSummary();
  text('announcement',event?`${shortName(state.contest.teams.find(t=>t.id===event.teamId).name)}, задача ${event.problem}: ${event.accepted?'принято':'не принято'}, место ${event.afterRank}`:'');
}

function openTeam(id){
  state.selectedTeam=id;stop();renderTeam();$('team-dialog').showModal();
}
function renderTeam(){
  const row=state.rows.find(row=>row.team.id===state.selectedTeam);if(!row)return;
  text('team-dialog-id',`КОМАНДА / ${row.team.id}`);text('team-dialog-name',shortName(row.team.name));text('team-dialog-info',teamInfo(row.team.name));
  text('team-dialog-coach','Тренер: '+(awards.detailsFor(row.team.id).coach||'не указан'));
  const info=[['Место',row.rank],['Решено',row.solved],['Штраф',row.penalty]];
  $('team-summary').replaceChildren(...info.map(([label,value])=>{const el=node('span');el.append(node('strong','',value),document.createTextNode(label));return el;}));
  const view=visibility(),fragment=document.createDocumentFragment();
  for(const submission of state.contest.submissions.filter(s=>s.teamId===row.team.id).slice().reverse()){
    const tr=node('tr'),td=node('td');td.append(verdictNode(submission,submissionIsVisible(submission,view)));tr.append(node('td','mono',`${submission.minute}:00`),node('td','mono',submission.problem),td);fragment.append(tr);
  }
  $('team-log-body').replaceChildren(fragment);
}

function setView(view){
  if(state.contest?.rosterOnly&&view!=='roster')return;
  state.view=view;document.querySelectorAll('[data-view]').forEach(button=>{const active=button.dataset.view===view;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  render();$('table-scroll').scrollTop=0;
}

function exportCSV(){
  if(!state.contest)return;
  const escape=value=>{let str=String(value);if(/^[=+\-@\t\r]/.test(str))str="'"+str;return `"${str.replaceAll('"','""')}"`;};
  const header=['Место','ID','Команда','Решено','Штраф',...state.contest.problems];
  const rows=state.rows.filter(row=>matches(row.team)).map(row=>[row.rank,row.team.id,row.team.name,row.solved,row.penalty,...state.contest.problems.map(p=>{const c=row.cells[p];return c.solved?`${c.wrong?'+'+c.wrong:'+'} (${c.time})`:c.pending?`?${c.pending}`:c.wrong?`−${c.wrong}`:'';})]);
  const blob=new Blob(['\uFEFF'+[header,...rows].map(row=>row.map(escape).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),anchor=node('a');anchor.href=url;anchor.download=`timus-step-${state.step}.csv`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Текущая таблица сохранена в CSV. Скрытые результаты не раскрыты.');
}

$('settings-form').addEventListener('submit',applyConfig);
for(const id of ['duration','hidden-minutes'])$(id).addEventListener('input',previewHint);
document.querySelectorAll('[data-minutes]').forEach(button=>button.addEventListener('click',()=>{$('hidden-minutes').value=button.dataset.minutes;previewHint();}));
$('upload-open').addEventListener('click',()=>$('file-input').click());
$('file-input').addEventListener('change',event=>importFiles(event.target.files));
$('load-demo').addEventListener('click',()=>{$('dataset-select').value=SITE_CONFIG.defaultDataset;loadDemo();});
$('dataset-select').addEventListener('change',()=>{if($('dataset-select').value!=='custom')loadDemo();});
$('table-scale').addEventListener('change',()=>{stop();render();});
$('show-frozen-solved').addEventListener('change',()=>{stop();render();});
window.addEventListener('resize',()=>{clearRowMotion($('score-body'));updateTableMetrics();});
$('play').addEventListener('click',play);
$('previous').addEventListener('click',()=>moveTo(state.step-1));
$('next').addEventListener('click',()=>moveTo(state.step+1));
$('reset').addEventListener('click',()=>{moveTo(0);state.finished=false;render();$('table-scroll').scrollTop=0;});
$('finish').addEventListener('click',()=>{const total=state.timeline.events.length;moveTo(total);if(!total){state.finished=true;render({advance:true});}toast('Выбранные места раскрыты. Остальные команды сохраняют заморозку.');});
$('scrubber').addEventListener('input',event=>moveTo(event.target.value));
$('speed').addEventListener('change',schedule);
$('search').addEventListener('input',event=>{state.query=normalized(event.target.value.trim());render();$('table-scroll').scrollTop=0;});
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.view)));
for(const id of ['score-body','submissions-body'])$(id).addEventListener('click',event=>{const button=event.target.closest('[data-team]');if(button)openTeam(button.dataset.team);});
$('help-open').addEventListener('click',()=>{stop();$('help-dialog').showModal();});
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}}));
$('back-top').addEventListener('click',()=>$('table-scroll').scrollTo({top:0,behavior:'smooth'}));
function togglePresentation(force){const active=force===undefined?!document.body.classList.contains('presentation'):force;const target=state.contest?.rosterOnly?'roster':'board';if(active&&state.view!==target)setView(target);document.body.classList.toggle('presentation',active);$('presentation').setAttribute('aria-pressed',String(active));$('presentation').querySelector('span').textContent=active?'Вернуть управление':'Только таблица';updateTableMetrics();requestAnimationFrame(updateTableMetrics);if(active)$('table-scroll').focus();else $('presentation').focus();}
$('presentation').addEventListener('click',()=>togglePresentation());
$('presentation-exit').addEventListener('click',()=>togglePresentation(false));
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('Полный экран недоступен. Используйте «Режим показа».',true);}});
$('export-csv').addEventListener('click',exportCSV);
document.addEventListener('keydown',event=>{
  if(event.metaKey||event.ctrlKey||event.altKey||document.querySelector('dialog[open]'))return;
  if(event.key==='Escape'){togglePresentation(false);return;}
  if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))return;
  if(event.code==='Space'&&document.activeElement.tagName==='BUTTON')return;
  if(!state.contest||state.importing||state.contest.rosterOnly)return;
  if(event.code==='Space'){event.preventDefault();play();}
  else if(event.key==='ArrowRight'){event.preventDefault();moveTo(state.step+1);}
  else if(event.key==='ArrowLeft'){event.preventDefault();moveTo(state.step-1);}
  else if(event.key.toLowerCase()==='r'||event.key.toLowerCase()==='к'){event.preventDefault();moveTo(0);}
  else if(event.key==='/'){event.preventDefault();$('search').focus();}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.playing)stop();});
window.addEventListener('dragenter',event=>{if([...event.dataTransfer?.types??[]].includes('Files')){event.preventDefault();dragDepth++;$('drop-overlay').hidden=false;}});
window.addEventListener('dragover',event=>{if([...event.dataTransfer?.types??[]].includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='copy';}});
window.addEventListener('dragleave',event=>{if([...event.dataTransfer?.types??[]].includes('Files')){dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)$('drop-overlay').hidden=true;}});
window.addEventListener('drop',event=>{event.preventDefault();dragDepth=0;$('drop-overlay').hidden=true;if(event.dataTransfer?.files.length)importFiles(event.dataTransfer.files);});

const awards=mountAwards({getContest:()=>state.contest,getRows:()=>state.contest?.rosterOnly?[]:state.rows,pause:()=>{const playing=state.playing;stop();return playing;},resume:()=>{if(!state.playing)play();},onChange:()=>{if(state.contest?.rosterOnly)syncRegistryDetails();render();},notify:toast});
$('team-edit-details').addEventListener('click',()=>{$('team-dialog').close();awards.openSettings(state.selectedTeam);});
$('dataset-select').replaceChildren(...Object.entries(SITE_CONFIG.datasets).map(([key,dataset])=>{const option=node('option','',dataset.label);option.value=key;return option;}));
$('dataset-select').value=SITE_CONFIG.defaultDataset;
if(SITE_CONFIG.notice){text('publication-notice',SITE_CONFIG.notice);$('publication-notice').hidden=false;}
loadDemo(true);
