const VERDICTS = /^(Accepted|Wrong answer|Presentation error|Time limit exceeded|Memory limit exceeded|Output limit exceeded|Idleness limit exceeded|Runtime error(?: \([^\r\n]+\))?|Compilation error(?: \([^\r\n]+\))?|Security violation|Restricted function)$/i;
const compareIds = new Intl.Collator('en',{numeric:true}).compare;
const emptyCell = () => ({solved:false,wrong:0,time:null,penalty:0,pending:0,attempts:0,firstPending:null});

function rankRows(rows){
  rows.sort((a,b)=>b.solved-a.solved||a.penalty-b.penalty||compareIds(a.team.id,b.team.id));
  rows.forEach((row,index)=>{const previous=rows[index-1];row.rank=previous&&row.solved===previous.solved&&row.penalty===previous.penalty?previous.rank:index+1;});
  return rows;
}

export function parseContest(logText, teamsText = '') {
  if (typeof logText !== 'string' || !logText.trim()) throw new Error('Лог пуст. Выберите файл full.log.');
  if (logText.length > 16_000_000 || teamsText.length > 4_000_000) throw new Error('Слишком большой файл. Лимит лога — 16 МБ, списка команд — 4 МБ.');
  const teams = new Map();
  for (const [index, raw] of teamsText.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^(\d+)\s+(.+)$/);
    if (!match) throw new Error(`teams.txt, строка ${index + 1}: ожидается «ID название команды».`);
    if (teams.has(match[1])) throw new Error(`teams.txt, строка ${index + 1}: повтор ID ${match[1]}.`);
    teams.set(match[1], { id: match[1], name: match[2].trim() });
  }
  const submissions = [];
  const problems = new Set();
  for (const [index, raw] of logText.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^(\d+)\s+([A-Za-z][A-Za-z0-9]*)\s+(\d+)\s+(\d+)\s+(.+)$/);
    if (!match || !Number.isSafeInteger(Number(match[3])) || Number(match[3]) > 100_000) {
      throw new Error(`full.log, строка ${index + 1}: ожидается «ID задача минута тест вердикт».`);
    }
    const [, teamId, task, minute, test, verdict] = match;
    if (!VERDICTS.test(verdict)) throw new Error(`full.log, строка ${index + 1}: неизвестный вердикт «${verdict}».`);
    const problem = task.toUpperCase();
    if (!teams.has(teamId)) teams.set(teamId, { id: teamId, name: `Команда ${teamId}` });
    submissions.push({ id: submissions.length, teamId, problem, minute: Number(minute), test: Number(test), verdict, accepted: /^Accepted$/i.test(verdict), ignored: /^Compilation error/i.test(verdict) });
    problems.add(problem);
  }
  if (!submissions.length) throw new Error('Лог пуст. Выберите файл full.log.');
  if (teams.size > 2000 || submissions.length > 100_000 || problems.size > 60) throw new Error('Лимит: 2000 команд, 100 000 посылок и 60 задач.');
  submissions.sort((a, b) => a.minute - b.minute || a.id - b.id);
  return { teams: [...teams.values()], problems: [...problems].sort((a,b)=>a.localeCompare(b, 'en', {numeric:true})), submissions, maxMinute: Math.max(...submissions.map(s => s.minute)) };
}

export const cellKey = (teamId, problem) => `${teamId}:${problem}`;

export function revealedCells(events = [], step = events.length) {
  return new Set(events.slice(0, Math.max(0, step)).map(e => cellKey(e.teamId, e.problem)));
}

function scoreWithRevealed(contest, freeze, revealed) {
  const rowMap = new Map(contest.teams.map(team => [team.id, {
    team, solved: 0, penalty: 0, rank: 0,
    cells: Object.fromEntries(contest.problems.map(p => [p, emptyCell()]))
  }]));
  for (const submission of contest.submissions) {
    const row = rowMap.get(submission.teamId);
    const cell = row.cells[submission.problem];
    if (cell.solved) continue;
    if (submission.minute >= freeze && !revealed.has(cellKey(submission.teamId, submission.problem))) {
      cell.pending++;
      cell.firstPending ??= submission.minute;
      continue;
    }
    if (submission.ignored) continue;
    cell.attempts++;
    if (submission.accepted) {
      cell.solved = true;
      cell.time = submission.minute;
      cell.penalty = submission.minute + cell.wrong * 20;
      row.solved++;
      row.penalty += cell.penalty;
    } else cell.wrong++;
  }
  return rankRows([...rowMap.values()]);
}

export function scoreboard(contest, { freeze = 240, events = [], step = events.length, final = false } = {}) {
  return scoreWithRevealed(contest, final ? Infinity : freeze, revealedCells(events,step));
}

export function buildTimeline(contest, { freeze = 240, from = contest.teams.length, to = 1 } = {}) {
  if ((freeze !== Infinity && !Number.isFinite(freeze)) || freeze < 0) throw new Error('Укажите корректную минуту заморозки.');
  if (![from,to].every(n=>Number.isInteger(n)&&n>=1&&n<=contest.teams.length)) throw new Error(`Места должны быть от 1 до ${contest.teams.length}.`);
  const low = Math.min(from,to), high = Math.max(from,to);
  let rows = scoreWithRevealed(contest,freeze,new Set());
  const selectedIds = new Set(rows.filter(row=>row.rank>=low&&row.rank<=high).map(row=>row.team.id));
  const frozenRanks = new Map(rows.map(row=>[row.team.id,row.rank]));
  const frozenSolved = Object.fromEntries(rows.map(row=>[row.team.id,row.solved]));
  const events = [];
  const groups = new Map();
  for(const submission of contest.submissions){const key=cellKey(submission.teamId,submission.problem);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(submission);}
  while (true) {
    const row = rows.findLast(row => selectedIds.has(row.team.id) && Object.values(row.cells).some(c=>c.pending>0));
    if (!row) break;
    const [problem, cell] = Object.entries(row.cells).filter(([,c])=>c.pending>0).sort((a,b)=>a[1].firstPending-b[1].firstPending||a[0].localeCompare(b[0]))[0];
    const beforeRank = row.rank;
    const result=emptyCell();
    for(const submission of groups.get(cellKey(row.team.id,problem))){
      if(submission.ignored)continue;
      result.attempts++;
      if(submission.accepted){result.solved=true;result.time=submission.minute;result.penalty=submission.minute+20*result.wrong;break;}
      result.wrong++;
    }
    row.cells[problem]=result;
    if(result.solved){row.solved++;row.penalty+=result.penalty;rankRows(rows);}
    events.push({teamId:row.team.id,problem,beforeRank,afterRank:row.rank,accepted:result.solved,minute:result.time??cell.firstPending,attempts:cell.pending,solved:row.solved,penalty:row.penalty});
  }
  return { events, selectedIds:[...selectedIds], frozenRanks:Object.fromEntries(frozenRanks), frozenSolved, low, high };
}

export function submissionIsVisible(submission, {freeze, revealed, completeIds = []}) {
  return submission.minute < freeze || revealed.has(cellKey(submission.teamId,submission.problem)) || completeIds.includes(submission.teamId);
}

export function shortName(name) {
  const at=name.lastIndexOf(' (');
  return at<0 ? name : name.slice(0,at);
}

export function teamInfo(name) {
  const at=name.lastIndexOf(' (');
  return at<0 ? '' : name.slice(at+2).replace(/\)$/, '');
}
