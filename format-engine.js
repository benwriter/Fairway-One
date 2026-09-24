export const FORMAT_LIBRARY = {
  custom: {
    name: 'Build Your Round', short: 'Custom', category: 'Custom', entry: 'dynamic', team: true,
    description: 'Assign different Fairway One formats to whichever holes you choose.',
    how: 'Create segments, choose a format for each segment, and assign any of the 18 holes. Fairway One switches scoring logic automatically as the round moves between segments.',
    minPlayers: 1, maxPlayers: 8, custom: true
  },
  stroke: {
    name: 'Stroke Play', short: 'Stroke', category: 'Individual', entry: 'individual', team: false,
    description: 'Every stroke counts. Lowest gross or net total wins.',
    how: 'Each player completes every hole and records their strokes. Handicap strokes are applied to produce a net score. The lowest total wins.',
    minPlayers: 1, maxPlayers: 8
  },
  stableford: {
    name: 'Stableford', short: 'Stableford', category: 'Individual', entry: 'individual', team: false,
    description: 'Earn points hole by hole from the net score.',
    how: 'Net par earns 2 points, net birdie 3, net bogey 1, and net double bogey or worse 0. Highest points wins.',
    minPlayers: 1, maxPlayers: 8
  },
  match: {
    name: 'Match Play', short: 'Match', category: 'Head-to-head', entry: 'individual', team: false,
    description: 'Win holes rather than counting the whole-round total.',
    how: 'Players are paired. The lower net score wins the hole, equal scores halve it, and the match ends once a lead is greater than the holes remaining.',
    minPlayers: 2, maxPlayers: 8
  },
  par_bogey: {
    name: 'Par / Bogey', short: 'Par', category: 'Individual', entry: 'individual', team: false,
    description: 'Each hole is won, halved or lost against par.',
    how: 'Compare the player’s net score with par on every hole. Better than par is +1, par is 0, and worse than par is -1. Highest total wins.',
    minPlayers: 1, maxPlayers: 8
  },
  modified_stableford: {
    name: 'Modified Stableford', short: 'Modified', category: 'Individual', entry: 'individual', team: false,
    description: 'A more aggressive points system that rewards birdies and eagles.',
    how: 'Fairway One uses a default net scoring table of +8 albatross, +5 eagle, +2 birdie, 0 par, -1 bogey and -3 double bogey or worse. Highest total wins.',
    minPlayers: 1, maxPlayers: 8
  },
  skins: {
    name: 'Skins', short: 'Skins', category: 'Side game', entry: 'individual', team: false,
    description: 'Win a skin by posting the unique low net score on a hole.',
    how: 'A player wins the hole’s skin only if they have the unique best net score. Tied holes carry the skin forward in Fairway One.',
    minPlayers: 2, maxPlayers: 8
  },
  fourball_stableford: {
    name: 'Four-Ball Stableford', short: '4BBB', category: 'Teams', entry: 'individual', team: true,
    description: 'Two-person teams, best Stableford score counts on each hole.',
    how: 'Both partners play their own ball. The better Stableford score on each hole becomes the team score. Highest team points total wins.',
    minPlayers: 4, maxPlayers: 4
  },
  fourball_match: {
    name: 'Four-Ball Match Play', short: '4BBB Match', category: 'Teams', entry: 'individual', team: true,
    description: 'Two-person teams compete hole by hole using the better net score.',
    how: 'All four players play their own ball. Each team uses its lower net score on the hole, and the lower team score wins that hole.',
    minPlayers: 4, maxPlayers: 4
  },
  best_ball: {
    name: 'Best Ball', short: 'Best Ball', category: 'Teams', entry: 'individual', team: true,
    description: 'The best net score from each team counts on every hole.',
    how: 'Every player completes the hole. Fairway One takes the lowest net score from each team as that team’s hole score.',
    minPlayers: 4, maxPlayers: 8
  },
  aggregate: {
    name: 'Team Aggregate', short: 'Aggregate', category: 'Teams', entry: 'individual', team: true,
    description: 'Every team member’s net score counts.',
    how: 'Players complete their own ball. The team hole score is the sum of every team member’s net score. Lowest aggregate wins.',
    minPlayers: 4, maxPlayers: 8
  },
  best_two: {
    name: 'Best 2 of 4', short: 'Best 2', category: 'Teams', entry: 'individual', team: true,
    description: 'Count the two best net scores from each team on every hole.',
    how: 'All players complete the hole. Fairway One sorts each team’s net scores and adds the best two. Lowest team total wins.',
    minPlayers: 6, maxPlayers: 8
  },
  ambrose: {
    name: 'Ambrose / Scramble', short: 'Ambrose', category: 'Shared ball', entry: 'team', team: true,
    description: 'All players hit, select the best ball, then repeat until holed.',
    how: 'Each team records one team score per hole. Fairway One also tracks whose drive was selected so minimum-drive rules can be monitored.',
    minPlayers: 2, maxPlayers: 8, tracksDrive: true
  },
  foursomes: {
    name: 'Foursomes', short: 'Foursomes', category: 'Shared ball', entry: 'team', team: true,
    description: 'Partners play one ball, alternating shots.',
    how: 'Each pair plays a single ball and alternates strokes until the ball is holed. The team records one score for the hole.',
    minPlayers: 4, maxPlayers: 4
  },
  greensomes: {
    name: 'Greensomes', short: 'Greensomes', category: 'Shared ball', entry: 'team', team: true,
    description: 'Both partners drive, choose one ball, then alternate shots.',
    how: 'Both partners tee off. The team selects one drive, then alternates shots from that ball until holed. Fairway One can track the selected drive.',
    minPlayers: 4, maxPlayers: 4, tracksDrive: true
  },
  chapman: {
    name: 'Chapman / Pinehurst', short: 'Chapman', category: 'Shared ball', entry: 'team', team: true,
    description: 'Both drive, swap for second shots, choose one ball, then alternate.',
    how: 'Both partners drive, each plays the other partner’s ball for the second shot, then one ball is selected and the pair alternates until holed.',
    minPlayers: 4, maxPlayers: 4, tracksDrive: true
  },
  shamble: {
    name: 'Shamble', short: 'Shamble', category: 'Teams', entry: 'individual', team: true,
    description: 'Select the best drive, then everyone plays their own ball in.',
    how: 'Each team selects a drive. From that position all team members play their own ball to the hole. Fairway One counts the best net score for the team and tracks the selected drive.',
    minPlayers: 4, maxPlayers: 8, tracksDrive: true
  }
};

// Zero is the persisted pickup marker, never a holed-out gross score.
export function isPickup(score) { return score === 0; }
export function supportsPickup(format) { return ['stableford','fourball_stableford','modified_stableford'].includes(format); }

export function formatInfo(key) { return FORMAT_LIBRARY[key] || FORMAT_LIBRARY.stroke; }

export function handicapStrokes(hcp, si) {
  const safe = Math.max(0, Number(hcp) || 0);
  const base = Math.floor(safe / 18);
  const remainder = safe % 18;
  return base + (si <= remainder ? 1 : 0);
}

export function scoreFor(event, playerId, holeNo) {
  return event.scores?.[playerId]?.[holeNo] ?? null;
}

export function teamScoreFor(event, teamId, holeNo) {
  return event.teamScores?.[teamId]?.[holeNo] ?? null;
}

export function holeNet(event, player, holeNo) {
  const hole = event.course.holes[holeNo - 1];
  const gross = scoreFor(event, player.id, holeNo);
  if (gross == null || isPickup(gross) || !hole) return null;
  return gross - handicapStrokes(player.hcp, hole.si);
}

export function holeStableford(event, player, holeNo) {
  if (isPickup(scoreFor(event, player.id, holeNo))) return 0;
  const net = holeNet(event, player, holeNo);
  if (net == null) return null;
  const par = event.course.holes[holeNo - 1].par;
  return Math.max(0, 2 + (par - net));
}

export function holeParBogey(event, player, holeNo) {
  const net = holeNet(event, player, holeNo);
  if (net == null) return null;
  const par = event.course.holes[holeNo - 1].par;
  return net < par ? 1 : net === par ? 0 : -1;
}

export function holeModifiedStableford(event, player, holeNo) {
  if (isPickup(scoreFor(event, player.id, holeNo))) return 0;
  const net = holeNet(event, player, holeNo);
  if (net == null) return null;
  const par = event.course.holes[holeNo - 1].par;
  const rel = net - par;
  if (rel <= -3) return 8;
  if (rel === -2) return 5;
  if (rel === -1) return 2;
  if (rel === 0) return 0;
  if (rel === 1) return -1;
  return -3;
}

export function scoredHolesForPlayer(event, playerId) {
  return Object.keys(event.scores?.[playerId] || {}).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
}

export function commonScoredHoles(event) {
  const info = formatInfo(event.format);
  if (info.custom) return [...new Set(event.confirmedHoles || [])].sort((a,b)=>a-b);
  if (info.entry === 'team') {
    const activeTeams=(event.teams||[]).filter(t => playersForTeam(event,t.id).length);
    if (!activeTeams.length) return [];
    return event.course.holes.map(h => h.number).filter(h => activeTeams.every(t => teamScoreFor(event,t.id,h) != null));
  }
  if (!event.players?.length) return [];
  return event.course.holes.map(h => h.number).filter(h => event.players.every(p => scoreFor(event,p.id,h) != null));
}

export function strokeStats(event, player) {
  const allHoles = scoredHolesForPlayer(event, player.id);
  const holes = allHoles.filter(h => !isPickup(scoreFor(event, player.id, h)));
  let gross = 0, net = 0, par = 0;
  holes.forEach(h => {
    const hole = event.course.holes[h - 1];
    const score = scoreFor(event, player.id, h);
    gross += score;
    net += score - handicapStrokes(player.hcp, hole.si);
    par += hole.par;
  });
  return { holes: allHoles.length, pickups: allHoles.length-holes.length, gross, net, toPar: net - par };
}

export function stablefordStats(event, player) {
  const holes = scoredHolesForPlayer(event, player.id);
  return { holes: holes.length, points: holes.reduce((s,h)=>s+(holeStableford(event,player,h) || 0),0) };
}

export function parBogeyStats(event, player) {
  const holes = scoredHolesForPlayer(event, player.id);
  return { holes: holes.length, points: holes.reduce((s,h)=>s+(holeParBogey(event,player,h) || 0),0) };
}

export function modifiedStablefordStats(event, player) {
  const holes = scoredHolesForPlayer(event, player.id);
  return { holes: holes.length, points: holes.reduce((s,h)=>s+(holeModifiedStableford(event,player,h) || 0),0) };
}

export function matchPairs(event) {
  const pairs=[];
  for (let i=0;i+1<event.players.length;i+=2) pairs.push([event.players[i],event.players[i+1]]);
  return pairs;
}

export function matchStatus(event,p1,p2) {
  let p1Wins=0,p2Wins=0,holes=0;
  event.course.holes.forEach(h=>{
    const a=holeNet(event,p1,h.number), b=holeNet(event,p2,h.number);
    if(a==null||b==null)return;
    holes++; if(a<b)p1Wins++; else if(b<a)p2Wins++;
  });
  const diff=p1Wins-p2Wins, remaining=18-holes;
  let label='ALL SQUARE';
  if(diff>0) label=`${p1.name.split(' ')[0]} ${diff} UP`;
  if(diff<0) label=`${p2.name.split(' ')[0]} ${Math.abs(diff)} UP`;
  if(holes>0 && Math.abs(diff)>remaining) label=`${diff>0?p1.name.split(' ')[0]:p2.name.split(' ')[0]} WINS ${Math.abs(diff)}&${remaining}`;
  return {holes,diff,label};
}

export function skinsStats(event) {
  const result = Object.fromEntries(event.players.map(p=>[p.id,0]));
  let carry=0;
  event.course.holes.forEach(h=>{
    const entries=event.players.map(p=>({p,net:holeNet(event,p,h.number)})).filter(x=>x.net!=null);
    if(entries.length!==event.players.length) return;
    const best=Math.min(...entries.map(x=>x.net));
    const winners=entries.filter(x=>x.net===best);
    if(winners.length===1){ result[winners[0].p.id]+=1+carry; carry=0; } else carry+=1;
  });
  return {skins:result, carry};
}

export function playersForTeam(event,teamId){
  return event.players.filter(p=>p.teamId===teamId);
}

export function ensureTeams(event){
  if(!event.teams?.length){
    event.teams=[{id:'team_a',name:'Team A',teamHcp:0},{id:'team_b',name:'Team B',teamHcp:0}];
  }
  event.players.forEach((p,i)=>{ if(!p.teamId) p.teamId=i < Math.ceil(event.players.length/2) ? event.teams[0].id : event.teams[1].id; });
  event.teamScores ||= {};
  event.driveSelections ||= {};
  event.teams.forEach(t=>{ event.teamScores[t.id] ||= {}; event.driveSelections[t.id] ||= {}; });
  return event;
}

function teamNetValues(event,team,holeNo){
  return playersForTeam(event,team.id).map(p=>holeNet(event,p,holeNo)).filter(v=>v!=null);
}
function teamStablefordValues(event,team,holeNo){
  return playersForTeam(event,team.id).map(p=>holeStableford(event,p,holeNo)).filter(v=>v!=null);
}

export function teamHoleValue(event,team,holeNo){
  const fmt=event.format;
  const nets=teamNetValues(event,team,holeNo);
  if(fmt==='fourball_stableford'){
    const pts=teamStablefordValues(event,team,holeNo); return pts.length ? Math.max(...pts) : null;
  }
  if(fmt==='fourball_match'||fmt==='best_ball'||fmt==='shamble') return nets.length ? Math.min(...nets) : null;
  if(fmt==='aggregate') return nets.length===playersForTeam(event,team.id).length ? nets.reduce((a,b)=>a+b,0) : null;
  if(fmt==='best_two') return nets.length>=2 ? nets.sort((a,b)=>a-b).slice(0,2).reduce((a,b)=>a+b,0) : null;
  if(formatInfo(fmt).entry==='team') return teamScoreFor(event,team.id,holeNo);
  return null;
}

export function teamRoundStats(event,team){
  const fmt=event.format;
  let holes=0,total=0,parTotal=0;
  event.course.holes.forEach(h=>{
    const v=teamHoleValue(event,team,h.number);
    if(v==null)return;
    holes++; total+=v; parTotal+=h.par;
  });
  if(fmt==='fourball_stableford') return {holes,points:total,total};
  if(formatInfo(fmt).entry==='team'){
    const allowance=Number(team.teamHcp)||0;
    const liveAllowance=allowance*(holes/18);
    return {holes,gross:total,net:total-liveAllowance,toPar:(total-liveAllowance)-parTotal,teamHcp:allowance};
  }
  return {holes,total,toPar:total-parTotal};
}

export function fourballMatchStatus(event){
  const [a,b]=event.teams||[]; if(!a||!b)return {holes:0,diff:0,label:'Need two teams'};
  let aw=0,bw=0,holes=0;
  event.course.holes.forEach(h=>{ const av=teamHoleValue(event,a,h.number),bv=teamHoleValue(event,b,h.number); if(av==null||bv==null)return; holes++; if(av<bv)aw++; else if(bv<av)bw++; });
  const diff=aw-bw,rem=18-holes; let label='ALL SQUARE';
  if(diff>0)label=`${a.name} ${diff} UP`; if(diff<0)label=`${b.name} ${Math.abs(diff)} UP`;
  if(holes>0&&Math.abs(diff)>rem)label=`${diff>0?a.name:b.name} WINS ${Math.abs(diff)}&${rem}`;
  return {holes,diff,label};
}

export function driveCounts(event,team){
  const counts=Object.fromEntries(playersForTeam(event,team.id).map(p=>[p.id,0]));
  Object.values(event.driveSelections?.[team.id]||{}).forEach(pid=>{ if(pid&&counts[pid]!=null)counts[pid]++; });
  return counts;
}

export function primaryLeaderboard(event){
  const fmt=event.format;
  if(fmt==='custom') return [];
  if(['stroke'].includes(fmt)) return event.players.map(player=>({type:'player',player,stats:strokeStats(event,player),sort:strokeStats(event,player).toPar})).sort((a,b)=>a.sort-b.sort);
  if(fmt==='stableford') return event.players.map(player=>({type:'player',player,stats:stablefordStats(event,player),sort:-stablefordStats(event,player).points})).sort((a,b)=>a.sort-b.sort);
  if(fmt==='par_bogey') return event.players.map(player=>({type:'player',player,stats:parBogeyStats(event,player),sort:-parBogeyStats(event,player).points})).sort((a,b)=>a.sort-b.sort);
  if(fmt==='modified_stableford') return event.players.map(player=>({type:'player',player,stats:modifiedStablefordStats(event,player),sort:-modifiedStablefordStats(event,player).points})).sort((a,b)=>a.sort-b.sort);
  if(fmt==='skins'){
    const s=skinsStats(event); return event.players.map(player=>({type:'player',player,stats:{holes:commonScoredHoles(event).length,skins:s.skins[player.id]},sort:-s.skins[player.id]})).sort((a,b)=>a.sort-b.sort);
  }
  if(fmt==='match') return matchPairs(event).map(([a,b])=>({type:'match',a,b,status:matchStatus(event,a,b)}));
  if(fmt==='fourball_match') return [{type:'team_match',status:fourballMatchStatus(event)}];
  return (event.teams||[]).map(team=>({type:'team',team,stats:teamRoundStats(event,team)})).sort((a,b)=>{
    if(fmt==='fourball_stableford') return (b.stats.points||0)-(a.stats.points||0);
    return (a.stats.total ?? a.stats.net ?? 0)-(b.stats.total ?? b.stats.net ?? 0);
  });
}
