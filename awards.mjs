export const emptyRules = () => ({degrees:[],qualifyUntil:0,qualifyingPlaces:[],wildCardPlaces:[]});

function place(value,total,label){
 const n=Number(value);
 if(!Number.isInteger(n)||n<1||n>total)throw new Error(label+': укажите целое место от 1 до '+total+'.');
 return n;
}

export function parseRankList(value,total){
 const text=Array.isArray(value)?value.join(','):String(value??'');
 if(!text.trim())return [];
 const normalized=text.replace(/(\d+)\s*[–—-]\s*(\d+)/g,'$1-$2');
 const result=new Set();
 for(const part of normalized.trim().split(/[\s,;]+/)){
  const match=part.match(/^(\d+)(?:-(\d+))?$/);
  if(!match)throw new Error('Список мест: используйте числа и диапазоны, например 1, 6, 8–10.');
  const first=place(match[1],total,'Список мест'),last=place(match[2]??match[1],total,'Список мест');
  if(last<first)throw new Error('Список мест: начало диапазона должно быть не больше конца.');
  for(let n=first;n<=last;n++)result.add(n);
 }
 return [...result].sort((a,b)=>a-b);
}

export function normalizeRules(raw={},total){
 const degrees=[],seen=new Set();
 for(const item of raw.degrees??[]){
  const hasFrom=String(item.from??'').trim()!=='',hasTo=String(item.to??'').trim()!=='';
  if(!hasFrom&&!hasTo)continue;
  if(!hasFrom||!hasTo)throw new Error('Для степени '+item.degree+' заполните обе границы диапазона мест.');
  if(![1,2,3].includes(Number(item.degree))||seen.has(Number(item.degree)))throw new Error('Степень должна быть I, II или III и встречаться один раз.');
  const from=place(item.from,total,'Начало диапазона'),to=place(item.to,total,'Конец диапазона');
  if(from>to)throw new Error('Диапазон мест: начало должно быть не больше конца.');
  if(degrees.some(d=>from<=d.to&&to>=d.from))throw new Error('Диапазоны степеней пересекаются. Одному месту можно назначить одну степень.');
  degrees.push({degree:Number(item.degree),from,to});seen.add(Number(item.degree));
 }
 const qualifyUntil=raw.qualifyUntil===undefined||raw.qualifyUntil===null||String(raw.qualifyUntil).trim()===''||raw.qualifyUntil===0?0:place(raw.qualifyUntil,total,'Проход по место');
 return {degrees:degrees.sort((a,b)=>a.degree-b.degree),qualifyUntil,qualifyingPlaces:parseRankList(raw.qualifyingPlaces,total),wildCardPlaces:parseRankList(raw.wildCardPlaces,total)};
}

export function honorsForRank(rank,rules){
 return {degree:rules.degrees.find(d=>rank>=d.from&&rank<=d.to)?.degree??null,qualified:(rules.qualifyUntil>0&&rank<=rules.qualifyUntil)||rules.qualifyingPlaces.includes(rank),wildCard:rules.wildCardPlaces.includes(rank)};
}

export function honorsForRows(rows,rules,{announcedIds}={}){
 const eligible=rows.filter(row=>!row.team.name.trimStart().startsWith('*')),ranks=new Map();
 eligible.forEach((row,index)=>{const previous=eligible[index-1];ranks.set(row.team.id,previous?.rank===row.rank?ranks.get(previous.team.id):index+1);});
 const final=announcedIds?finalizedTeamIds(rows):null;
 return new Map(rows.filter(row=>!announcedIds||(announcedIds.has(row.team.id)&&final.has(row.team.id))).map(row=>{
  const diploma=honorsForRank(row.rank,rules),qualifyingRank=ranks.get(row.team.id)??null;
  const selection=qualifyingRank===null?{qualified:false,wildCard:false}:honorsForRank(qualifyingRank,rules);
  return [row.team.id,{degree:diploma.degree,qualified:selection.qualified,wildCard:selection.wildCard,qualifyingRank}];
 }));
}

export function finalizedTeamIds(rows){
 const last=rows.findLastIndex(row=>Object.values(row.cells).some(cell=>cell.pending>0));
 if(last<0)return new Set(rows.map(row=>row.team.id));
 return new Set(rows.slice(last+1).filter(row=>row.rank>rows[last].rank).map(row=>row.team.id));
}

export function pruneCeremonyHistory(rows,history,step){
 const final=finalizedTeamIds(rows);
 return new Map([...history].filter(([id,shownAt])=>shownAt<=step&&final.has(id)));
}

export function ceremonyEntries(rows,rules,{preview=false}={}){
 const final=finalizedTeamIds(rows),honors=honorsForRows(rows,rules);
 return rows.filter(row=>preview||final.has(row.team.id)).map(row=>({...row,honors:honors.get(row.team.id)})).filter(row=>row.honors.degree||row.honors.qualified||row.honors.wildCard).sort((a,b)=>b.rank-a.rank||a.team.id.localeCompare(b.team.id,'en',{numeric:true}));
}

export function nextCeremonyEntry(rows,rules,seen){
 return ceremonyEntries(rows,rules).find(row=>!seen.has(row.team.id))??null;
}

export function parseCSV(text){
 text=text.replace(/^\uFEFF/,'');
 const first=text.split(/\r?\n/,1)[0],delimiter=first.includes('\t')?'\t':first.includes(';')?';':',';
 const rows=[];let row=[],value='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quoted){if(ch==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=ch;continue;}
  if(ch==='"'){if(value.trim()||closed)throw new Error('CSV: неверные кавычки.');quoted=true;value='';continue;}
  if(ch===delimiter){row.push(value);value='';closed=false;continue;}
  if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(value);if(row.some(s=>s.trim()))rows.push(row);row=[];value='';closed=false;continue;}
  if(closed&&!/\s/.test(ch))throw new Error('CSV: после закрывающей кавычки ожидается разделитель.');
  if(!closed)value+=ch;
 }
 if(quoted)throw new Error('CSV: не закрыты кавычки.');
 row.push(value);if(row.some(s=>s.trim()))rows.push(row);
 return rows;
}

export function parseTeamDetailsCSV(text,teams){
 if(typeof text!=='string'||text.length>2_000_000)throw new Error('CSV: максимальный размер — 2 МБ.');
 const rows=parseCSV(text),header=rows.shift()?.map(s=>s.trim().toLowerCase())??[];
 const column=(...aliases)=>header.findIndex(h=>aliases.includes(h));
 const idIndex=column('team_id','id','ид','id команды'),coachIndex=column('coach','тренер','тренеры'),membersIndex=column('members','участники','состав'),orgIndex=column('organization','организация','школа');
 if(idIndex<0)throw new Error('CSV: нужен столбец team_id (или ID).');
 if(coachIndex<0&&membersIndex<0&&orgIndex<0)throw new Error('CSV: добавьте столбец coach, members или organization.');
 const ids=new Set(teams.map(team=>team.id)),result={};
 for(const [index,row] of rows.entries()){
  const id=(row[idIndex]??'').trim();
  if(!ids.has(id))throw new Error('CSV, строка '+(index+2)+': неизвестная команда '+id+'.');
  if(Object.hasOwn(result,id))throw new Error('CSV, строка '+(index+2)+': повтор ID '+id+'.');
  const details={};
  for(const [name,col] of [['coach',coachIndex],['members',membersIndex],['organization',orgIndex]])if(col>=0){const value=(row[col]??'').trim();if(value.length>4000)throw new Error('CSV: значение длиннее 4000 символов.');details[name]=value;}
  result[id]=details;
 }
 return result;
}

export function contestKey(contest){
 const payload=[contest.teams.map(t=>[t.id,t.name]),contest.submissions.map(s=>[s.teamId,s.problem,s.minute,s.verdict])];
 if(contest.rosterOnly||contest.teams.some(team=>team.rosterDetails))payload.push({label:contest.label??'',rosterOnly:!!contest.rosterOnly,sourcePeople:contest.teams.map(team=>[team.id,team.rosterDetails??null,team.rosterIssue??null])});
 const text=JSON.stringify(payload);
 let hash=2166136261;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}
 return 'monitor-awards-v1-'+(hash>>>0).toString(16);
}
