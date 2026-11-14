import {parseCSV} from './awards.mjs';
import {shortName} from './engine.mjs';

export const normalizeTeamName=name=>String(name??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru').replaceAll('ё','е');
const person=value=>String(value??'').replace(/&#(x[0-9a-f]+|\d+);/gi,(whole,code)=>{const n=code[0].toLowerCase()==='x'?parseInt(code.slice(1),16):Number(code);return n>0&&n<=0x10ffff?String.fromCodePoint(n):whole;}).trim().replace(/,?\s*\d{1,2}\s*класс\s*$/i,'').trim();
const sameNames=(a,b)=>a.length===b.length&&a.every((name,i)=>normalizeTeamName(name)===normalizeTeamName(b[i]));
const display=team=>team.displayName??shortName(team.name);

export function parseRosterCSV(text){
 if(typeof text!=='string'||text.length>2_000_000)throw new Error('Список команд: максимальный размер CSV — 2 МБ.');
 const rows=parseCSV(text),header=rows.shift()?.map(normalizeTeamName)??[];
 const col=(...names)=>header.findIndex(name=>names.includes(name));
 const nameIndex=col('название команды','команда','team_name','team'),coachIndex=col('тренер','тренеры','coach');
 const reviewIndex=col('проверить состав'),alternativeIndex=col('альтернативный состав'),summaryIndex=col('исходная тройка');
 const memberIndexes=[col('первый участник','участник 1','member1','participant_1'),col('второй участник','участник 2','member2','participant_2'),col('третий участник','участник 3','member3','participant_3')];
 if(nameIndex<0||memberIndexes.some(index=>index<0))throw new Error('Нужны столбцы «Название команды», «Первый участник», «Второй участник», «Третий участник».');
 const native=nameIndex===1&&memberIndexes[0]===5,groups=new Map();
 for(const [index,row] of rows.entries()){
  const name=(row[nameIndex]??'').trim();if(!name)continue;
  const key=normalizeTeamName(name);if(!groups.has(key))groups.set(key,{name,triples:[],individuals:[],coaches:[],lines:[]});
  const group=groups.get(key);group.lines.push(index+2);
  const members=memberIndexes.map(i=>person(row[i]));if(members.every(Boolean))group.triples.push(members);
  if(native){const individual=person([row[2],row[3]].filter(Boolean).join(' '));if(individual&&!group.individuals.some(name=>normalizeTeamName(name)===normalizeTeamName(individual)))group.individuals.push(individual);}
  const coach=(row[coachIndex]??'').trim();if(coach&&!group.coaches.includes(coach))group.coaches.push(coach);
  if(['да','yes','true','1'].includes(normalizeTeamName(row[reviewIndex]))){const alternative=String(row[alternativeIndex]??'').split(/\r?\n|;/).map(person).filter(Boolean),summary=String(row[summaryIndex]??'').split(/\r?\n|;/).map(person).filter(Boolean);if(alternative.length!==3)throw new Error('Команда «'+name+'»: состав отмечен для проверки, но альтернативная тройка отсутствует. Загрузите исходный CSV.');group.preservedIssue={individualMembers:alternative,summaryMembers:summary.length===3?summary:members};}
 }
 if(!groups.size)throw new Error('В CSV не найдены команды.');
 const teams=[],issues=[];
 for(const group of groups.values()){
  const members=group.triples[0]??group.individuals.slice(0,3);
  if(members.length!==3||members.some(name=>!name))throw new Error('Команда «'+group.name+'»: не найдены имена трёх участников.');
  const alternative=group.individuals.length===3&&!sameNames(members,group.individuals)?group.individuals:null;
  const conflicting=group.triples.some(triple=>!sameNames(members,triple));
  const issue=group.preservedIssue?{teamName:group.name,...group.preservedIssue,lines:group.lines}:alternative||conflicting?{teamName:group.name,summaryMembers:[...members],individualMembers:alternative?[...alternative]:group.triples.find(triple=>!sameNames(members,triple)),lines:group.lines}:null;
  const id='roster-'+String(teams.length+1).padStart(3,'0');
  teams.push({id,name:group.name,members:[...members],coach:group.coaches.join('; '),alternativeMembers:issue?.individualMembers??null,sourceLines:group.lines,issue});
  if(issue)issues.push(issue);
 }
 return {teams,issues,sourceRowCount:rows.length};
}

export function rosterContest(registry,label){
 return {rosterOnly:true,label,teams:registry.teams.map(team=>({id:team.id,name:team.name,displayName:team.name,rosterIssue:team.issue,rosterDetails:{members:team.members.join('\n'),coach:team.coach,organization:''}})),submissions:[],problems:[],maxMinute:0};
}

const withoutMarker=name=>normalizeTeamName(name).replace(/^\*+\s*/,'');
function timusTeamLabel(name){
 const at=name.lastIndexOf(':'),label=name.slice(0,at).trim();
 if(at<0||!label)return null;
 const suffix=name.slice(at+1).match(/^\s*([^,()\r\n]+),([^,()\r\n]+),([^,()\r\n]+)\s+\(([^()\r\n]+)\)\s*$/);
 return suffix&&suffix.slice(1).every(value=>value.trim())?label:null;
}

export function bindRoster(contest,registry){
 const byName=new Map(),byUnmarkedName=new Map();
 for(const team of registry.teams)for(const [index,key] of [[byName,normalizeTeamName(team.name)],[byUnmarkedName,withoutMarker(team.name)]]){if(!index.has(key))index.set(key,[]);index.get(key).push(team);}
 const candidates=contest.teams.map(team=>{
  const label=timusTeamLabel(team.name),names=[team.name,team.displayName,shortName(team.name),label].filter(name=>typeof name==='string');
  const exact=names.map(normalizeTeamName).find(key=>byName.has(key));
  const fallback=exact===undefined?names.map(withoutMarker).find(key=>byUnmarkedName.has(key)):undefined;
  return {team,label,matches:exact!==undefined?byName.get(exact):byUnmarkedName.get(fallback)??[]};
 });
 const counts=new Map();for(const entry of candidates)if(entry.matches.length===1){const source=entry.matches[0];counts.set(source,(counts.get(source)??0)+1);}
 let matched=0;
 const teams=candidates.map(({team,label,matches})=>{if(matches.length!==1||counts.get(matches[0])!==1)return team;matched++;const source=matches[0],displayName=label??(team.name.trimStart().startsWith('*')?'*'+source.name.replace(/^\*+\s*/,''):source.name);return {...team,displayName,rosterIssue:source.issue,rosterDetails:{members:source.members.join('\n'),coach:source.coach,organization:''}};});
 return {contest:{...contest,teams},matched};
}

export function memberLines(details,team){
 const text=details?.members??team.rosterDetails?.members??'';
 const names=text.split(/\r?\n|;/).map(person).filter(Boolean);
 return [names[0]??'',names[1]??'',names[2]??''];
}

export function rosterCSV(teams,detailsFor){
 const quote=value=>{let text=String(value??'');if(/^[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
 const rows=[['Название команды','Первый участник','Второй участник','Третий участник','Тренер','Проверить состав','Альтернативный состав','Исходная тройка'],...teams.map(team=>{const details=detailsFor(team.id),unresolved=team.rosterIssue&&!details.rosterReviewed;return [display(team),...memberLines(details,team),details.coach||'',unresolved?'Да':'',unresolved?team.rosterIssue.individualMembers.join('\n'):'',unresolved?team.rosterIssue.summaryMembers.join('\n'):''];})];
 return '\uFEFF'+rows.map(row=>row.map(quote).join(';')).join('\r\n');
}

export function validateRosterMembers(value,teamName){
 const names=String(value??'').split(/\r?\n|;/).map(person).filter(Boolean);
 if(names.length!==3)throw new Error('Команда «'+teamName+'»: укажите три имени участников, каждое с новой строки.');
 return names;
}
