import {
  FORMAT_LIBRARY, formatInfo, handicapStrokes, scoreFor, teamScoreFor, holeNet, holeStableford,
  strokeStats, stablefordStats, parBogeyStats, modifiedStablefordStats, matchPairs, matchStatus,
  skinsStats, ensureTeams, playersForTeam, teamHoleValue, teamRoundStats, fourballMatchStatus,
  driveCounts, primaryLeaderboard, commonScoredHoles
} from './format-engine.js';
import { initCloud, onCloudAuthChange, signUp, signIn, signOut, loadProfile, syncProfile, uploadProfilePhoto, profilePhotoUrl, joinEventByCode, claimEventPlayer, syncEvent, deleteCloudEvent, loadCloudEvents, loadCourseLibrary, subscribeToRound, unsubscribe } from './cloud.js';

const STORAGE_KEY='fairwayOneV9';
const LEGACY_STORAGE_KEYS=['fairwayOneV8','fairwayOneV7','fairwayOneV6','fairwayOnePrototypeV5','fairwayOnePrototypeV4'];
const STANDALONE_FORMAT_COUNT=Object.keys(FORMAT_LIBRARY).filter(k=>k!=='custom').length;
const MAX_TOURNAMENT_PLAYERS=72;
const app=document.getElementById('app');
const modalRoot=document.getElementById('modalRoot');
const toastRoot=document.getElementById('toastRoot');
const navButtons=[...document.querySelectorAll('.nav-item')];
const today=new Date();
let ui={tab:'home',leaderboard:'primary',modal:null};
let state=loadState();
let cloud={session:null,status:'checking',syncing:false,subscription:null,refreshTimer:null,lastError:null};

function uid(prefix='id'){return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`}
function isoDate(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))}
function signed(v){if(Math.abs(v)<0.0001)return 'E'; return v>0?`+${Number(v).toFixed(Number.isInteger(v)?0:1)}`:Number(v).toFixed(Number.isInteger(v)?0:1)}
function initials(name=''){return name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'P'}
function formatDate(value){if(!value)return'';return new Date(`${value}T12:00:00`).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})}

function defaultHoles(){
  const pars=[4,4,3,5,4,3,5,4,4,4,3,5,4,4,3,5,4,4];
  const sis=[9,3,15,1,7,17,5,11,13,10,16,2,8,4,18,6,12,14];
  const distances=[345,382,154,486,361,171,512,334,401,356,162,501,373,395,149,520,341,389];
  return Array.from({length:18},(_,i)=>({number:i+1,par:pars[i],si:sis[i],distance:distances[i]}));
}
function createTeams(){return [{id:'team_a',name:'Team A',teamHcp:0},{id:'team_b',name:'Team B',teamHcp:0}]}
function activeTeams(event){return (event?.teams||[]).filter(t=>playersForTeam(event,t.id).length)}
function ensureTournamentGroups(event){
  event.eventMode ||= 'round';
  event.ambroseMode ||= 'versus';
  if(event.eventMode!=='tournament')return event;
  event.groupSize=Math.max(2,Math.min(4,Number(event.groupSize||4)));
  event.groups=Array.isArray(event.groups)?event.groups:[];
  event.groupConfirmedHoles ||= {};
  event.groupCurrentHoles ||= {};
  event.groupStartHoles ||= {};
  const allIds=new Set((event.players||[]).map(p=>p.id));
  event.groups=event.groups.map((g,i)=>{
    const index=i+1;
    const startingHole=Math.max(1,Math.min(18,Number(event.groupStartHoles[index]||g.startingHole||((i%18)+1))));
    event.groupStartHoles[index]=startingHole;
    return {id:g.id||uid('grp'),name:g.name||`Group ${index}`,playerIds:(g.playerIds||[]).filter(id=>allIds.has(id)),startingHole,teeTime:g.teeTime||event.teeTime||'07:00'};
  }).filter(g=>g.playerIds.length);
  if(!event.groups.length&&event.players?.length)buildTournamentGroups(event);
  event.groups.forEach((g,i)=>{
    event.groupConfirmedHoles[g.id] ||= [];
    const defaultHole=event.startType==='shotgun'?g.startingHole:1;
    event.groupCurrentHoles[g.id]=Math.max(1,Math.min(18,Number(event.groupCurrentHoles[g.id]||defaultHole)));
    g.name ||= `Group ${i+1}`;
  });
  if(!event.groups.some(g=>g.id===event.activeGroupId))event.activeGroupId=event.groups[0]?.id||null;
  return event;
}
function addMinutes(time,minutes){const [h,m]=(time||'07:00').split(':').map(Number);const total=((h||0)*60+(m||0)+minutes)%(24*60);return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`}
function buildTournamentGroups(event){
  const size=Math.max(2,Math.min(4,Number(event.groupSize||4))), start=event.teeTime||'07:00';
  const previousStartHoles={...(event.groupStartHoles||{})};
  event.groups=[];
  for(let i=0;i<(event.players||[]).length;i+=size){
    const index=event.groups.length;
    const groupNo=index+1;
    const startingHole=event.startType==='shotgun'?Math.max(1,Math.min(18,Number(previousStartHoles[groupNo]||((index%18)+1)))):1;
    event.groups.push({id:uid('grp'),name:`Group ${groupNo}`,playerIds:event.players.slice(i,i+size).map(p=>p.id),startingHole,teeTime:event.startType==='shotgun'?start:addMinutes(start,index*10)});
  }
  event.groupStartHoles={};
  event.groups.forEach((g,i)=>event.groupStartHoles[i+1]=g.startingHole);
  event.activeGroupId=event.groups[0]?.id||null;
  event.groupConfirmedHoles={};event.groupCurrentHoles={};
  event.groups.forEach(g=>{event.groupConfirmedHoles[g.id]=[];event.groupCurrentHoles[g.id]=event.startType==='shotgun'?g.startingHole:1});
  return event;
}
function currentGroup(event){ensureTournamentGroups(event);return event?.eventMode==='tournament'?(event.groups.find(g=>g.id===event.activeGroupId)||event.groups[0]||null):null}
function currentScoringPlayers(event){const g=currentGroup(event);return g?(event.players||[]).filter(p=>g.playerIds.includes(p.id)):(event.players||[])}
function selfPlayer(event){return (event?.players||[]).find(p=>p.isSelf)||null}
function playerGroup(event,playerId){if(event?.eventMode!=='tournament')return null;ensureTournamentGroups(event);return (event.groups||[]).find(g=>(g.playerIds||[]).includes(playerId))||null}
function holeOrder(start=1){return Array.from({length:18},(_,i)=>rotateHole(start,i))}
function nextUnconfirmedHole(start,confirmed=[]){const set=new Set((confirmed||[]).map(Number)),order=holeOrder(start);return order.find(h=>!set.has(h))||order[order.length-1]}
function cloudSelfMode(event,holeNo){if(!cloud.session||!event?.cloud?.synced||!selfPlayer(event))return false;const info=formatInfo(formatKeyForHole(event,Number(holeNo||event.currentHole||1)));return info.entry!=='team'}
function cloudTeamMode(event,holeNo){if(!cloud.session||!event?.cloud?.synced||!selfPlayer(event))return false;const info=formatInfo(formatKeyForHole(event,Number(holeNo||event.currentHole||1)));return info.entry==='team'}
function editableScoringPlayers(event,holeNo){if(cloudSelfMode(event,holeNo)){const me=selfPlayer(event);return me?[me]:[]}return currentScoringPlayers(event)}
function editableTeams(event,holeNo){const teams=activeTeams(event);const me=selfPlayer(event);if(cloud.session&&event?.cloud?.synced&&me?.teamId)return teams.filter(t=>t.id===me.teamId);return teams}
function playerStartHole(event,playerId){const g=playerGroup(event,playerId);return event?.eventMode==='tournament'&&event.startType==='shotgun'?(g?.startingHole||1):1}
function selfHoleConfirmed(event,player,holeNo){const h=Number(holeNo),info=formatInfo(formatKeyForHole(event,h));if(info.entry==='team'&&player?.teamId)return (event.teamConfirmedHoles?.[player.teamId]||[]).includes(h);return (event.playerConfirmedHoles?.[player?.id]||[]).includes(h)}
function selfConfirmedHoles(event,player){return Array.from({length:18},(_,i)=>i+1).filter(h=>selfHoleConfirmed(event,player,h))}
function selfCardComplete(event,player){return !!player&&selfConfirmedHoles(event,player).length>=18}
function personalCurrentHole(event,player){event.playerCurrentHoles ||= {};const start=playerStartHole(event,player.id),confirmed=selfConfirmedHoles(event,player),saved=Number(event.playerCurrentHoles[player.id]||0);if(saved>=1&&saved<=18&&!selfHoleConfirmed(event,player,saved))return saved;const next=nextUnconfirmedHole(start,confirmed);event.playerCurrentHoles[player.id]=next;return next}
function teamStartHole(event,team){const member=playersForTeam(event,team.id)[0];return member?playerStartHole(event,member.id):1}
function personalTeamCurrentHole(event,team){event.teamCurrentHoles ||= {};const start=teamStartHole(event,team),confirmed=event.teamConfirmedHoles?.[team.id]||[];const saved=Number(event.teamCurrentHoles[team.id]||0);if(saved>=1&&saved<=18&&!confirmed.includes(saved))return saved;const next=nextUnconfirmedHole(start,confirmed);event.teamCurrentHoles[team.id]=next;return next}
function currentHoleNo(event){const base=event?.eventMode==='tournament'?(currentGroup(event)?Math.max(1,Math.min(18,Number(event.groupCurrentHoles?.[currentGroup(event).id]||1))):1):Math.max(1,Math.min(18,Number(event?.currentHole||1)));if(cloud.session&&event?.cloud?.synced){const me=selfPlayer(event);if(me)return personalCurrentHole(event,me)}return base}
function isCurrentHoleConfirmed(event,hole){const h=Number(hole);if(cloud.session&&event?.cloud?.synced){const me=selfPlayer(event);if(me)return selfHoleConfirmed(event,me,h)}if(event?.eventMode==='tournament'){const g=currentGroup(event);return !!g&&(event.groupConfirmedHoles?.[g.id]||[]).includes(h)}return (event?.confirmedHoles||[]).includes(h)}
function groupProgress(event,group=currentGroup(event)){if(!group)return 0;return (event.groupConfirmedHoles?.[group.id]||[]).length}
function rotateHole(hole,delta=1){return ((Number(hole||1)-1+delta)%18+18)%18+1}
function tournamentComplete(event){return event?.eventMode==='tournament'&&event.groups?.length&&event.groups.every(g=>(event.groupConfirmedHoles?.[g.id]||[]).length>=18)}

function initialState(){return{profile:{name:'Golfer',homeClub:'',hcp:0,countryCode:'AU'},activeEventId:null,events:[],courseLibrary:[]}}
function isLegacySeedEvent(event){return event?.name==='Fairway One Test Round'||event?.course?.name==='Prototype Golf Club'}
function normaliseState(parsed){
  const base=parsed&&typeof parsed==='object'?parsed:initialState();
  base.profile ||= {name:'Golfer',homeClub:'',hcp:0,countryCode:'AU'};
  base.profile.name ||= 'Golfer';
  base.profile.homeClub ||= '';
  base.profile.hcp=Number(base.profile.hcp||0);
  base.profile.countryCode ||= 'AU';
  base.profile.avatarPath ||= '';
  base.courseLibrary=Array.isArray(base.courseLibrary)?base.courseLibrary:[];
  base.events=Array.isArray(base.events)?base.events.filter(e=>!isLegacySeedEvent(e)):[];
  base.events.forEach(e=>{e.format ||= 'stableford';e.eventMode ||= 'round';e.ambroseMode ||= (e.format==='ambrose'&&activeTeams(e).length<=1?'single':'versus');e.trackStats=!!e.trackStats;e.playerStats ||= {};e.playerConfirmedHoles ||= {};e.playerCurrentHoles ||= {};e.teamStats ||= {};e.teamConfirmedHoles ||= {};e.teamCurrentHoles ||= {};e.groupStartHoles ||= {};ensureTeams(e);ensureCustomSegments(e);ensureTournamentGroups(e)});
  if(!base.events.some(e=>e.id===base.activeEventId&&e.status==='live'))base.activeEventId=base.events.find(e=>e.status==='live')?.id||null;
  return base;
}
function loadState(){try{let raw=localStorage.getItem(STORAGE_KEY);if(!raw){for(const key of LEGACY_STORAGE_KEYS){raw=localStorage.getItem(key);if(raw)break}}if(!raw)return initialState();const state=normaliseState(JSON.parse(raw));localStorage.setItem(STORAGE_KEY,JSON.stringify(state));return state}catch{return initialState()}}
function saveState(show=false){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));if(show)toast(cloud.session?'Saved locally · cloud sync queued':'Saved on this device')}
function cloudLabel(){if(cloud.status==='checking')return 'Checking cloud';if(cloud.syncing)return 'Syncing…';if(cloud.session)return 'Cloud live';return 'Saved locally'}
function mergeCloudEvents(remoteEvents){
  const localOnly=state.events.filter(e=>!e.cloud?.eventId);
  remoteEvents.forEach(remote=>{const local=state.events.find(e=>e.cloud?.eventId&&e.cloud.eventId===remote.cloud?.eventId);if(local?.eventMode==='tournament'&&local.activeGroupId&&remote.cloud?.role==='admin')remote.activeGroupId=remote.groups?.some(g=>g.id===local.activeGroupId)?local.activeGroupId:remote.activeGroupId;if(local?.playerCurrentHoles)remote.playerCurrentHoles={...local.playerCurrentHoles};if(local?.teamCurrentHoles)remote.teamCurrentHoles={...local.teamCurrentHoles}});
  state.events=[...remoteEvents,...localOnly];
  if(!state.events.some(e=>e.id===state.activeEventId))state.activeEventId=state.events[0]?.id||null;
  state.events.forEach(e=>{ensureTeams(e);ensureTournamentGroups(e)});
  saveState();
}
async function refreshCloud({silent=false}={}){
  if(!cloud.session)return;
  try{
    cloud.status='connected';
    const [profile,events]=await Promise.all([loadProfile(),loadCloudEvents()]);
    if(profile){
      state.profile.name=profile.display_name||state.profile.name;
      state.profile.homeClub=profile.home_club||state.profile.homeClub;
      state.profile.hcp=Number(profile.handicap_index??state.profile.hcp);
      state.profile.countryCode=profile.country_code||state.profile.countryCode||'AU';
      state.profile.avatarPath=profile.avatar_path||state.profile.avatarPath||'';
    }
    mergeCloudEvents(events);
    await subscribeActiveRound();
    render();
    if(!silent)toast('Cloud data refreshed.');
  }catch(err){cloud.lastError=err;cloud.status='error';if(!silent)toast(`Cloud refresh failed: ${escapeHtml(err.message||'Unknown error')}`)}
}
async function subscribeActiveRound(){
  if(cloud.subscription){await unsubscribe(cloud.subscription);cloud.subscription=null}
  const evt=activeEvent();
  if(!cloud.session||!evt?.cloud?.roundId)return;
  cloud.subscription=subscribeToRound(evt.cloud.roundId,()=>{
    clearTimeout(cloud.refreshTimer);
    cloud.refreshTimer=setTimeout(()=>refreshCloud({silent:true}),350);
  });
}
let cloudSyncTimer=null;
function queueCloudSync(event,{structure=false,immediate=false}={}){
  if(!cloud.session||!event)return;
  clearTimeout(cloudSyncTimer);
  const run=async()=>{
    if(cloud.syncing)return;
    cloud.syncing=true;cloud.status='connected';render();
    try{
      await syncEvent(event,state.profile,{structure});
      saveState();
      cloud.lastError=null;
      await subscribeActiveRound();
    }catch(err){cloud.lastError=err;cloud.status='error';toast(`Cloud sync failed: ${escapeHtml(err.message||'Unknown error')}`)}
    finally{cloud.syncing=false;render()}
  };
  if(immediate)run();else cloudSyncTimer=setTimeout(run,650);
}
async function refreshCourseLibrary({silent=true}={}){
  try{
    state.courseLibrary=await loadCourseLibrary();
    saveState();
  }catch(err){
    if(!silent)toast(`Course library refresh failed: ${escapeHtml(err.message||'Unknown error')}`);
  }
}
async function bootCloud(){
  try{
    cloud.session=await initCloud();
    cloud.status=cloud.session?'connected':'local';
    await refreshCourseLibrary({silent:true});
    if(cloud.session)await refreshCloud({silent:true});
  }catch(err){cloud.lastError=err;cloud.status='error'}
  render();
  onCloudAuthChange(async session=>{
    const changed=cloud.session?.user?.id!==session?.user?.id;
    cloud.session=session;cloud.status=session?'connected':'local';
    if(session&&changed)await refreshCloud({silent:true});
    await refreshCourseLibrary({silent:true});
    if(!session&&cloud.subscription){await unsubscribe(cloud.subscription);cloud.subscription=null}
    render();
  });
}
function activeEvent(){return state.events.find(e=>e.id===state.activeEventId)||null}
function eventCompleteForCurrentUser(event){if(event?.status==='complete')return true;const me=selfPlayer(event);return !!(event?.cloud?.synced&&me&&selfCardComplete(event,me))}
function activeLiveEvent(){const active=activeEvent();if(active?.status==='live'&&!eventCompleteForCurrentUser(active))return active;return state.events.find(e=>e.status==='live'&&!eventCompleteForCurrentUser(e))||null}
function completedEvents(){return state.events.filter(eventCompleteForCurrentUser).sort((a,b)=>new Date(b.completedAt||`${b.date||'1970-01-01'}T23:59:59`)-new Date(a.completedAt||`${a.date||'1970-01-01'}T23:59:59`))}
function ordinal(n){const v=n%100;return `${n}${['th','st','nd','rd'][(v-20)%10]||['th','st','nd','rd'][v]||'th'}`}
function countryHandicapProvider(code='AU'){
  const providers={
    AU:{name:'Golf Australia',label:'Check Daily Handicap',url:'https://daily-handicap-table.golf.com.au/'},
    US:{name:'GHIN',label:'Check Handicap',url:'https://www.ghin.com/'},
    CA:{name:'Golf Canada',label:'Check Handicap',url:'https://www.golfcanada.ca/handicap/'},
    NZ:{name:'Golf New Zealand',label:'Check Handicap',url:'https://www.golf.co.nz/'},
    GB:{name:'Your national golf union',label:'Check Handicap',url:'https://www.randa.org/whs'}
  };
  return providers[code]||providers.AU;
}
function eventResultSummary(event){
  if(!event)return 'Result unavailable';
  if(event.format==='custom'){
    const points=customEventPoints(event);if(!points.length)return 'Custom round complete';
    const best=points[0].points,winners=points.filter(x=>Math.abs(x.points-best)<.000001);
    return winners.length>1?`Tied · ${eventPointsLabel(best)} pts`:`${winners[0].name} · ${eventPointsLabel(best)} pts`;
  }
  const board=primaryLeaderboard(event);if(!board.length)return 'Round complete';
  const me=(event.players||[]).find(p=>p.name.trim().toLowerCase()===(state.profile.name||'').trim().toLowerCase())||(((event.players||[]).length===1)?event.players[0]:null);
  if(me){
    const idx=board.findIndex(x=>x.type==='player'&&x.player?.id===me.id);
    if(idx>=0){const e=board[idx];let score='';if(event.format==='stableford')score=`${e.stats.points} pts`;else if(event.format==='stroke')score=signed(e.stats.toPar);else if(event.format==='par_bogey'||event.format==='modified_stableford')score=signed(e.stats.points);else if(event.format==='skins')score=`${e.stats.skins} skins`;return `${ordinal(idx+1)}${score?` · ${score}`:''}`}
    const team=(event.teams||[]).find(t=>playersForTeam(event,t.id).some(p=>p.id===me.id));
    const tidx=team?board.findIndex(x=>x.type==='team'&&x.team?.id===team.id):-1;
    if(tidx>=0)return `${ordinal(tidx+1)} · ${team.name}`;
  }
  const first=board[0];
  if(first.type==='player'){let score='';if(event.format==='stableford')score=`${first.stats.points} pts`;else if(event.format==='stroke')score=signed(first.stats.toPar);else if(event.format==='par_bogey'||event.format==='modified_stableford')score=signed(first.stats.points);else if(event.format==='skins')score=`${first.stats.skins} skins`;return `${first.player.name}${score?` · ${score}`:''}`}
  if(first.type==='team')return `${first.team.name}${first.stats?.points!=null?` · ${first.stats.points} pts`:''}`;
  if(first.type==='match'||first.type==='team_match')return first.status?.label||'Match complete';
  return 'Round complete';
}
function renderRecentRounds(){
  const rounds=completedEvents().slice(0,5);
  if(!rounds.length)return '<div class="empty-card recent-empty"><h3>No completed rounds yet.</h3><p>Your last five completed rounds and results will appear here.</p></div>';
  return `<div class="recent-rounds">${rounds.map(e=>`<button class="recent-round-card" data-action="view-result" data-event-id="${e.id}"><div><span class="recent-date">${formatDate(e.date)}</span><strong>${escapeHtml(e.course?.name||e.name)}</strong><small>${escapeHtml(formatInfo(e.format).name)} · ${escapeHtml(e.course?.tee||'')}</small></div><div class="recent-result"><b>${escapeHtml(eventResultSummary(e))}</b><span>View →</span></div></button>`).join('')}</div>`;
}
function eventProgress(event){const me=selfPlayer(event);if(event?.cloud?.synced&&me)return selfConfirmedHoles(event,me).length;if(event?.eventMode==='tournament'){const total=(event.groups||[]).length*18,done=(event.groups||[]).reduce((n,g)=>n+(event.groupConfirmedHoles?.[g.id]||[]).length,0);return total?Math.round((done/total)*18):0}return event?.format==='custom'?[...new Set(event.confirmedHoles||[])].length:commonScoredHoles(event).length}
function standaloneFormats(){return Object.entries(FORMAT_LIBRARY).filter(([k])=>k!=='custom')}
function defaultCustomSegments(){return [{id:uid('seg'),name:'Segment 1',format:'stableford',holes:Array.from({length:18},(_,i)=>i+1),points:1}]}
function ensureCustomSegments(event){if(!event)return event;if(event.format!=='custom'){event.customSegments ||= [];return event}if(!Array.isArray(event.customSegments)||!event.customSegments.length)event.customSegments=defaultCustomSegments();event.customSegments.forEach((seg,i)=>{seg.id ||= uid('seg');seg.name ||= `Segment ${i+1}`;if(!FORMAT_LIBRARY[seg.format]||seg.format==='custom')seg.format='stableford';seg.holes=[...new Set((seg.holes||[]).map(Number).filter(h=>h>=1&&h<=18))].sort((a,b)=>a-b);seg.points=Number(seg.points??1)});return event}
function segmentForHole(event,holeNo){if(event?.format!=='custom')return null;ensureCustomSegments(event);return event.customSegments.find(seg=>seg.holes.includes(Number(holeNo)))||null}
function formatKeyForHole(event,holeNo){return event?.format==='custom'?(segmentForHole(event,holeNo)?.format||'stableford'):(event?.format||'stableford')}
function formatInfoForHole(event,holeNo){return formatInfo(formatKeyForHole(event,holeNo))}
function eventUsesTeams(event){if(!event)return false;if(event.format!=='custom')return !!formatInfo(event.format).team;ensureCustomSegments(event);return event.customSegments.some(seg=>formatInfo(seg.format).team)}
function customAssignedHoles(event){return [...new Set((event.customSegments||[]).flatMap(seg=>seg.holes||[]))].sort((a,b)=>a-b)}
function holesLabel(holes=[]){const nums=[...new Set(holes)].sort((a,b)=>a-b);if(!nums.length)return 'No holes';const groups=[];let start=nums[0],prev=nums[0];for(let i=1;i<=nums.length;i++){const n=nums[i];if(n===prev+1){prev=n;continue}groups.push(start===prev?String(start):`${start}–${prev}`);start=n;prev=n}return `Holes ${groups.join(', ')}`}
function segmentTone(index){return `seg-tone-${(index%6)+1}`}
function scopedEventForSegment(event,seg){const allowed=new Set(seg.holes||[]);const scores={};(event.players||[]).forEach(p=>{scores[p.id]={};Object.entries(event.scores?.[p.id]||{}).forEach(([h,v])=>{if(allowed.has(Number(h)))scores[p.id][h]=v})});const teamScores={};(event.teams||[]).forEach(t=>{teamScores[t.id]={};Object.entries(event.teamScores?.[t.id]||{}).forEach(([h,v])=>{if(allowed.has(Number(h)))teamScores[t.id][h]=v})});const driveSelections={};(event.teams||[]).forEach(t=>{driveSelections[t.id]={};Object.entries(event.driveSelections?.[t.id]||{}).forEach(([h,v])=>{if(allowed.has(Number(h)))driveSelections[t.id][h]=v})});return {...event,format:seg.format,scores,teamScores,driveSelections,confirmedHoles:(event.confirmedHoles||[]).filter(h=>allowed.has(Number(h)))}}
function segmentMatchStatus(event,seg,p1,p2){let a=0,b=0,holes=0;(seg.holes||[]).forEach(h=>{const av=holeNet(event,p1,h),bv=holeNet(event,p2,h);if(av==null||bv==null)return;holes++;if(av<bv)a++;else if(bv<av)b++});const diff=a-b,remaining=Math.max(0,(seg.holes||[]).length-holes);let label='ALL SQUARE';if(diff>0)label=`${p1.name.split(' ')[0]} ${diff} UP`;if(diff<0)label=`${p2.name.split(' ')[0]} ${Math.abs(diff)} UP`;if(holes>0&&Math.abs(diff)>remaining)label=`${diff>0?p1.name.split(' ')[0]:p2.name.split(' ')[0]} WINS ${Math.abs(diff)}&${remaining}`;return{holes,diff,label}}
function segmentFourballStatus(event,seg){const [a,b]=(event.teams||[]).filter(t=>playersForTeam(event,t.id).length);if(!a||!b)return{holes:0,diff:0,remaining:(seg.holes||[]).length,label:'Need two teams'};const scoped=scopedEventForSegment(event,seg);let aw=0,bw=0,holes=0;(seg.holes||[]).forEach(h=>{const av=teamHoleValue(scoped,a,h),bv=teamHoleValue(scoped,b,h);if(av==null||bv==null)return;holes++;if(av<bv)aw++;else if(bv<av)bw++});const diff=aw-bw,remaining=Math.max(0,(seg.holes||[]).length-holes);let label='ALL SQUARE';if(diff>0)label=`${a.name} ${diff} UP`;if(diff<0)label=`${b.name} ${Math.abs(diff)} UP`;if(holes>0&&Math.abs(diff)>remaining)label=`${diff>0?a.name:b.name} WINS ${Math.abs(diff)}&${remaining}`;return{holes,diff,remaining,label,teams:[a,b]}}
function segmentLeader(event,seg){const scoped=scopedEventForSegment(event,seg),fmt=seg.format;if(fmt==='match'){const pair=matchPairs(event)[0];if(!pair)return{label:'Need players',detail:''};const st=segmentMatchStatus(scoped,seg,pair[0],pair[1]);return{label:st.label,detail:`${st.holes}/${seg.holes.length} holes`}}if(fmt==='fourball_match'){const st=segmentFourballStatus(event,seg);return{label:st.label,detail:`${st.holes}/${seg.holes.length} holes`}}const board=primaryLeaderboard(scoped);const first=board[0];if(!first)return{label:'No scores yet',detail:''};if(first.type==='player'){let value='';if(fmt==='stroke')value=signed(first.stats.toPar);if(fmt==='stableford')value=`${first.stats.points} pts`;if(fmt==='par_bogey'||fmt==='modified_stableford')value=signed(first.stats.points);if(fmt==='skins')value=`${first.stats.skins} skins`;return{label:first.player.name,detail:value}}if(first.type==='team'){let value=fmt==='fourball_stableford'?`${first.stats.points||0} pts`:formatInfo(fmt).entry==='team'?`${first.stats.gross||0} gross · ${signed(first.stats.toPar||0)}`:signed(first.stats.toPar||0);return{label:first.team.name,detail:value}}return{label:first.status?.label||'Live',detail:''}}
function segmentBoardMetric(fmt,entry){if(entry.type==='player'){if(fmt==='stroke')return entry.stats.toPar;if(fmt==='stableford'||fmt==='par_bogey'||fmt==='modified_stableford')return -Number(entry.stats.points||0);if(fmt==='skins')return -Number(entry.stats.skins||0)}if(entry.type==='team'){if(fmt==='fourball_stableford')return -Number(entry.stats.points||0);const info=formatInfo(fmt);if(info.entry==='team')return Number(entry.stats.net??entry.stats.toPar??entry.stats.gross??0);return Number(entry.stats.total??entry.stats.toPar??0)}return 0}
function segmentResult(event,seg){const scoped=scopedEventForSegment(event,seg),fmt=seg.format,info=formatInfo(fmt),points=Math.max(0,Number(seg.points||0));if(fmt==='match'){const pair=matchPairs(scoped)[0];if(!pair)return{status:'pending',complete:false,winners:[],awards:[],label:'Need two players',detail:'Match Play needs a pairing'};const st=segmentMatchStatus(scoped,seg,pair[0],pair[1]),confirmed=(seg.holes||[]).filter(h=>event.confirmedHoles.includes(h)).length,decided=st.holes===seg.holes.length||Math.abs(st.diff)>Math.max(0,seg.holes.length-st.holes),complete=decided&&confirmed>=st.holes;if(!complete)return{status:'live',complete:false,winners:[],awards:[],label:st.label,detail:`${st.holes}/${seg.holes.length} holes scored`};const winners=st.diff===0?[pair[0],pair[1]]:[st.diff>0?pair[0]:pair[1]];const awards=winners.map(p=>({type:'player',id:p.id,name:p.name,points:points/winners.length}));return{status:'complete',complete:true,winners:awards,awards,label:st.diff===0?'Match halved':`${winners[0].name} wins`,detail:st.diff===0?'All square':st.label}}
if(fmt==='fourball_match'){const st=segmentFourballStatus(event,seg);if(!st.teams?.length)return{status:'pending',complete:false,winners:[],awards:[],label:'Need two teams',detail:''};const confirmed=(seg.holes||[]).filter(h=>event.confirmedHoles.includes(h)).length,decided=st.holes===seg.holes.length||Math.abs(st.diff)>st.remaining,complete=decided&&confirmed>=st.holes;if(!complete)return{status:'live',complete:false,winners:[],awards:[],label:st.label,detail:`${st.holes}/${seg.holes.length} holes scored`};const winners=st.diff===0?st.teams:[st.diff>0?st.teams[0]:st.teams[1]];const awards=winners.map(t=>({type:'team',id:t.id,name:t.name,points:points/winners.length}));return{status:'complete',complete:true,winners:awards,awards,label:st.diff===0?'Match halved':`${winners[0].name} wins`,detail:st.diff===0?'All square':st.label}}
const complete=commonScoredHoles(scoped).length===seg.holes.length&&(seg.holes||[]).every(h=>event.confirmedHoles.includes(h)),board=primaryLeaderboard(scoped);if(!board.length)return{status:'pending',complete:false,winners:[],awards:[],label:'Awaiting scores',detail:''};const first=board[0],leader=segmentLeader(event,seg);if(!complete)return{status:'live',complete:false,winners:[],awards:[],label:leader.label,detail:leader.detail||`${commonScoredHoles(scoped).length}/${seg.holes.length} holes scored`};const best=segmentBoardMetric(fmt,first),tied=board.filter(x=>Math.abs(segmentBoardMetric(fmt,x)-best)<0.000001);const winners=tied.map(x=>x.type==='player'?{type:'player',id:x.player.id,name:x.player.name}:{type:'team',id:x.team.id,name:x.team.name});const awards=winners.map(w=>({...w,points:points/winners.length}));let detail=leader.detail||'';return{status:'complete',complete:true,winners,awards,label:winners.length>1?'Segment tied':`${winners[0].name} wins`,detail}}
function customEventPoints(event){if(event?.format!=='custom')return[];ensureCustomSegments(event);const totals=new Map();event.customSegments.forEach(seg=>{const r=segmentResult(event,seg);if(!r.complete)return;r.awards.forEach(a=>{const key=`${a.type}:${a.id}`,current=totals.get(key)||{...a,points:0,segments:0};current.points+=Number(a.points||0);current.segments+=1;totals.set(key,current)})});return [...totals.values()].sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name))}
function eventPointsLabel(points){return Number.isInteger(points)?String(points):Number(points).toFixed(2).replace(/0$/,'')}
function homeBrand(){return `<div class="home-brand-lockup"><img src="/fairway-one-mark.svg" alt="" class="home-brand-mark"><div class="home-brand-copy"><strong>Fairway One</strong><span>PLAY&nbsp;&nbsp;•&nbsp;&nbsp;SCORE&nbsp;&nbsp;•&nbsp;&nbsp;COMPETE</span></div></div>`}

function icon(name){const icons={bell:'<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>',flag:'<svg viewBox="0 0 24 24"><path d="M5 21V4m0 0h11l-2 4 2 4H5"/></svg>',target:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v4m0 12v4m-9-9h3m12 0h3"/></svg>',medal:'<svg viewBox="0 0 24 24"><circle cx="12" cy="14" r="6"/><path d="m8 2 4 6 4-6M9.5 13l1.5 1.5 3-3"/></svg>',users:'<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8m7 8a3 3 0 1 0 0-6m2 10a4 4 0 0 1 4 4v2"/></svg>',shield:'<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>',spark:'<svg viewBox="0 0 24 24"><path d="m12 3 1.4 4.2L18 9l-4.6 1.8L12 15l-1.4-4.2L6 9l4.6-1.8L12 3Zm6 11 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14Z"/></svg>'};return `<span class="line-icon">${icons[name]||''}</span>`}
function topbar(title='',eyebrow=''){return `<header class="topbar"><div class="topbar-premium-brand"><img src="/fairway-one-mark.svg" alt=""><strong>Fairway One</strong></div>${title?`<div class="topbar-title"><span>${escapeHtml(eyebrow)}</span><strong>${escapeHtml(title)}</strong></div>`:'<div></div>'}<button class="icon-button" data-action="about" aria-label="Fairway One information">${icon('bell')}</button></header>`}
function avatar(p,small=false){const path=p?.avatarPath||'';const photo=path?profilePhotoUrl(path):'';return `<span class="avatar tone${p.tone||1} ${small?'small':''}">${photo?`<img src="${escapeHtml(photo)}" alt="${escapeHtml(p.name||'Golfer')}">`:escapeHtml(initials(p.name))}</span>`}

function scoredPrimaryLeaderboard(event){const board=primaryLeaderboard(event).filter(x=>x.type!=='team'||playersForTeam(event,x.team?.id).length);if(event?.eventMode!=='tournament')return board;return board.filter(x=>x.type!=='player'||(x.stats?.holes||0)>0)}
function formatHeroScore(event){if(event?.format==='custom'){ensureCustomSegments(event);const points=customEventPoints(event);if(points.length)return `${points[0].name} ${eventPointsLabel(points[0].points)} pts`;return `${event.customSegments.length} segment${event.customSegments.length===1?'':'s'}`}const board=scoredPrimaryLeaderboard(event);if(!board.length)return '—';const first=board[0];if(first.type==='player'){if(event.format==='stableford')return `${first.stats.points} pts`;if(event.format==='par_bogey'||event.format==='modified_stableford')return signed(first.stats.points);if(event.format==='skins')return `${first.stats.skins} skins`;if(event.format==='stroke')return signed(first.stats.toPar);return 'Live'}if(first.type==='team'){if(event.format==='fourball_stableford')return `${first.stats.points||0} pts`;return `${first.team.name}`}if(first.type==='match'||first.type==='team_match')return first.status.label;return 'Live'}
function homeScreen(){
  const event=activeLiveEvent();
  const day=today.toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'long'}).toUpperCase();
  const firstName=(state.profile.name||'Golfer').split(' ')[0];
  const provider=countryHandicapProvider(state.profile.countryCode);
  let hero='';
  if(event){
    ensureCustomSegments(event);ensureTournamentGroups(event);const heroHole=currentHoleNo(event),h=event.course.holes[heroHole-1]||event.course.holes[0];const info=event.format==='custom'?formatInfo('custom'):formatInfo(event.format);
    hero=`<section class="hero-card premium-hero"><div class="hero-top"><span class="live-pill"><i></i>Live round</span><span class="hero-round-id">${event.eventMode==='tournament'?`${event.groups?.filter(g=>(event.groupConfirmedHoles?.[g.id]||[]).length>=18).length||0} / ${event.groups?.length||0} GROUPS COMPLETE`:`${eventProgress(event)} / 18 COMPLETE`}</span></div><div class="hero-main"><p class="eyebrow">${escapeHtml(info.name)}</p><h2>${escapeHtml(event.name||'Round in progress')}</h2><p>${escapeHtml(event.course.name)} · ${formatDate(event.date)} · ${escapeHtml(event.teeTime)}</p><div class="hero-meta"><span>${icon('users')}${event.players.length} PLAYERS</span>${event.eventMode==='tournament'?`<span>${icon('flag')}${event.groups?.length||0} GROUPS</span>`:''}${eventUsesTeams(event)?`<span>${icon('users')}${(event.teams||[]).filter(t=>playersForTeam(event,t.id).length).length} TEAMS</span>`:''}<span>${icon('target')}${event.format==='custom'?'CUSTOM':escapeHtml(info.category.toUpperCase())}</span></div></div><div class="hero-bottom"><div class="hero-stat"><span>${icon('medal')} LEADER PREVIEW</span><strong>${escapeHtml(formatHeroScore(event))}</strong></div><div class="hero-stat current-hole-stat"><span>${icon('flag')} CURRENT HOLE</span><div><strong>${heroHole}</strong><small>Par ${h?.par||'—'}<br>${h?.distance||'—'} m · SI ${h?.si||'—'}</small></div></div><div class="hero-actions"><button class="primary-btn gold hero-resume" data-action="resume"><span>▶</span> Resume round</button><button class="ghost-btn hero-edit" data-action="event-edit" data-event-id="${event.id}">${icon('spark')} Edit</button></div></div></section>`;
  }else{
    hero=`<section class="hero-card premium-hero ready-hero"><div class="hero-top"><span class="ready-pill">${icon('flag')} READY TO PLAY</span><span class="hero-round-id">NO ROUND IN PROGRESS</span></div><div class="hero-main"><p class="eyebrow">YOUR NEXT ROUND</p><h2>Ready when you are.</h2><p>Choose a course, add your players and pick how you want to play.</p><div class="hero-meta"><span>${icon('target')} 16 FORMATS</span><span>${icon('spark')} BUILD YOUR ROUND</span></div></div><div class="ready-actions"><button class="primary-btn gold" data-action="create-event"><span>▶</span> Start a round</button><button class="ghost-btn" data-action="create-custom-event">Build your round</button></div></section>`;
  }
  return `<main class="screen home-screen"><section class="home-masthead">${homeBrand()}<button class="home-profile" data-action="edit-profile"><span>${escapeHtml(initials(state.profile.name))}</span><small>${escapeHtml(firstName)}</small></button></section><section class="welcome premium-welcome"><p class="eyebrow">${day}</p><h1>Good ${today.getHours()<12?'morning':today.getHours()<18?'afternoon':'evening'}, ${escapeHtml(firstName)}.</h1><p class="subtle">Choose the game. Enter the score. Let Fairway One do the maths.</p></section>${hero}<section class="handicap-home-card"><div><p class="eyebrow">HANDICAP</p><h3>Playing today?</h3><p>HCP ${Number(state.profile.hcp||0).toFixed(1)} · ${escapeHtml(provider.name)}</p></div><a class="secondary-btn handicap-link" href="${provider.url}" target="_blank" rel="noopener">${escapeHtml(provider.label)} ↗</a></section><section class="section"><div class="section-head"><div><p class="eyebrow">ROUND HISTORY</p><h3>Recent rounds</h3></div><button class="text-btn" data-action="create-event">+ New round</button></div>${renderRecentRounds()}</section><section class="section format-engine-home"><div class="section-head"><div><p class="eyebrow">FORMAT ENGINE</p><h3>${STANDALONE_FORMAT_COUNT} ways to play</h3></div><button class="text-btn with-arrow" data-action="open-game-guide">View all ${STANDALONE_FORMAT_COUNT} <span>→</span></button></div><div class="premium-format-grid"><button class="premium-format-card" data-action="open-game-guide"><span class="premium-format-icon">${icon('target')}</span><div><strong>INDIVIDUAL</strong><small>Stroke, Stableford,<br>Par + more</small></div><b>›</b></button><button class="premium-format-card" data-action="open-game-guide"><span class="premium-format-icon">${icon('users')}</span><div><strong>TEAM</strong><small>Four-Ball, Best Ball,<br>Ambrose + more</small></div><b>›</b></button><button class="premium-format-card" data-action="open-game-guide"><span class="premium-format-icon">${icon('medal')}</span><div><strong>MATCH PLAY</strong><small>Head-to-head<br>or teams</small></div><b>›</b></button><button class="premium-format-card custom" data-action="create-custom-event"><span class="premium-format-icon crossed">${icon('spark')}</span><div><strong>CUSTOM</strong><small>Build your own<br>18-hole format</small></div><b>›</b></button></div></section><section class="section"><div class="section-head"><div><p class="eyebrow">LEARN</p><h3>Know the game</h3></div></div><div class="learn-grid"><button class="learn-card" data-action="open-game-guide"><span class="learn-icon">${icon('target')}</span><strong>How to play</strong><small>Guide to every scoring format in Fairway One.</small><b>Open guide →</b></button><button class="learn-card" data-action="open-rules"><span class="learn-icon">${icon('shield')}</span><strong>Rules of Golf</strong><small>Quick reference plus official rules resources.</small><b>Open rules →</b></button></div></section></main>`;
}
function renderEventList(events){
  if(!events.length)return '<div class="empty-card"><p>No events yet.</p></div>';
  return `<div class="event-list">${events.map(e=>{
    ensureCustomSegments(e);
    const canManage=!e.cloud?.synced||e.cloud?.role==='admin';
    const needsClaim=!!(cloud.session&&e.cloud?.synced&&e.cloud?.role==='player'&&!selfPlayer(e));
    const joinCode=canManage&&e.cloud?.joinCode?`<div class="event-join-code"><span>PLAYER JOIN CODE</span><strong>${escapeHtml(e.cloud.joinCode)}</strong><small>Share this with golfers so they can join and score themselves.</small></div>`:'';
    return `<article class="event-card ${e.status==='live'?'live':''}"><div class="card-row"><span class="status-pill"><i></i>${e.status==='complete'?'Complete':'Live'}</span><span class="eyebrow">${formatDate(e.date)}</span></div><h4>${escapeHtml(e.name)}</h4><p>${escapeHtml(e.course.name)} · ${escapeHtml(e.teeTime)}</p><div class="event-tags"><span>${escapeHtml(formatInfo(e.format).name)}</span><span>${e.players.length} players</span>${e.eventMode==='tournament'?`<span>${e.groups?.length||0} groups</span><span>Tournament</span>`:(eventUsesTeams(e)?'<span>Teams</span>':'')}${e.format==='custom'?`<span>${e.customSegments.length} segments</span>`:''}</div>${joinCode}<div class="event-actions"><button class="${e.status==='live'?'primary-btn gold':'secondary-btn'} small-btn" data-action="activate-event" data-event-id="${e.id}">${needsClaim?'Claim my player':e.status==='live'?'Play':'Open'}</button>${canManage?`<button class="ghost-btn small-btn" data-action="event-edit" data-event-id="${e.id}">Edit</button>`:''}</div></article>`
  }).join('')}</div>`
}


function holeStatObject(event,type,id,holeNo){
  const root=type==='team'?(event.teamStats ||= {}):(event.playerStats ||= {});
  root[id] ||= {};
  root[id][holeNo] ||= {putts:null,sandShots:null,penaltyStrokes:null};
  return root[id][holeNo];
}
function statValue(v){return v==null?'—':String(v)}
function renderStatControls(event,type,id,holeNo){
  if(!event.trackStats)return '';
  const stat=holeStatObject(event,type,id,holeNo);
  const attr=type==='team'?'data-team-stat':'data-player-stat';
  return `<div class="hole-stat-controls">
    <div class="hole-stat-item"><span>Putts</span><div><button ${attr}="${id}" data-stat-field="putts" data-stat-dir="-1">−</button><b>${statValue(stat.putts)}</b><button ${attr}="${id}" data-stat-field="putts" data-stat-dir="1">+</button></div></div>
    <div class="hole-stat-item"><span>Sand shots</span><div><button ${attr}="${id}" data-stat-field="sandShots" data-stat-dir="-1">−</button><b>${statValue(stat.sandShots)}</b><button ${attr}="${id}" data-stat-field="sandShots" data-stat-dir="1">+</button></div></div>
    <div class="hole-stat-item"><span>Penalties</span><div><button ${attr}="${id}" data-stat-field="penaltyStrokes" data-stat-dir="-1">−</button><b>${statValue(stat.penaltyStrokes)}</b><button ${attr}="${id}" data-stat-field="penaltyStrokes" data-stat-dir="1">+</button></div></div>
    <small class="hole-stat-note">Penalty strokes are tracked here for stats and should already be included in the gross score.</small>
  </div>`;
}
function statTotalsFor(root,id){
  const holes=Object.values(root?.[id]||{});
  const values=(field)=>holes.map(x=>x?.[field]).filter(v=>v!=null&&Number.isFinite(Number(v))).map(Number);
  return {
    holesTracked:holes.filter(x=>['putts','sandShots','penaltyStrokes'].some(k=>x?.[k]!=null)).length,
    putts:values('putts').reduce((a,b)=>a+b,0),
    sandShots:values('sandShots').reduce((a,b)=>a+b,0),
    penaltyStrokes:values('penaltyStrokes').reduce((a,b)=>a+b,0)
  };
}
function renderStatsBoard(event){
  const info=formatInfo(event.format);
  if(info.entry==='team'){
    const teams=cloud.session&&event.cloud?.synced?editableTeams(event,currentHoleNo(event)):activeTeams(event);
    return `<section class="stats-board"><div class="stats-head"><span>Team</span><span>Putts</span><span>Sand</span><span>Pen.</span></div>${teams.map(t=>{const s=statTotalsFor(event.teamStats,t.id);return `<div class="stats-row"><strong>${escapeHtml(t.name)}</strong><span>${s.putts}</span><span>${s.sandShots}</span><span>${s.penaltyStrokes}</span></div>`}).join('')}</section>`;
  }
  let players=(cloud.session&&event.cloud?.synced&&selfPlayer(event))?[selfPlayer(event)]:event.players;
  if(event.eventMode==='tournament')players=players.filter(p=>strokeStats(event,p).holes>0||statTotalsFor(event.playerStats,p.id).holesTracked>0);
  return `<section class="stats-board"><div class="stats-head"><span>Player</span><span>Putts</span><span>Sand</span><span>Pen.</span></div>${players.map(p=>{const s=statTotalsFor(event.playerStats,p.id);return `<div class="stats-row"><div><strong>${escapeHtml(p.name)}</strong><small>${s.holesTracked} hole${s.holesTracked===1?'':'s'} tracked</small></div><span>${s.putts}</span><span>${s.sandShots}</span><span>${s.penaltyStrokes}</span></div>`}).join('')}</section>`;
}

function individualScoreRows(event,holeNo,formatKey=formatKeyForHole(event,holeNo)){
  const hole=event.course.holes[holeNo-1],activeInfo=formatInfo(formatKey);
  return editableScoringPlayers(event,holeNo).map(p=>{
    const score=scoreFor(event,p.id,holeNo),net=holeNet(event,p,holeNo),pts=holeStableford(event,p,holeNo);
    const rel=score==null?null:score-hole.par,cls=rel==null?'empty':rel<0?'under':rel>0?'over':'';
    return `<article class="score-row">${avatar(p)}<div class="player-copy"><strong>${escapeHtml(p.name)}</strong><span>HCP ${p.hcp} · ${handicapStrokes(p.hcp,hole.si)} shot${handicapStrokes(p.hcp,hole.si)===1?'':'s'} here${net!=null?` · Net ${net} · ${pts} pts`:''}</span>${activeInfo.team?`<small class="team-chip">${escapeHtml(event.teams.find(t=>t.id===p.teamId)?.name||'Team')}</small>`:''}</div><div class="score-control"><button data-score="minus" data-player="${p.id}">−</button><button class="score-value ${cls}" data-score="par" data-player="${p.id}"><strong>${score==null?'—':score}</strong><span>${score==null?'Tap':rel===0?'Par':rel>0?`+${rel}`:String(rel)}</span></button><button data-score="plus" data-player="${p.id}">+</button><button class="clear-score" data-score="clear" data-player="${p.id}">×</button></div>${renderStatControls(event,'player',p.id,holeNo)}</article>`;
  }).join('');
}
function teamScoreRows(event,holeNo,formatKey=formatKeyForHole(event,holeNo)){
  const activeInfo=formatInfo(formatKey);
  return editableTeams(event,holeNo).map(team=>{
    const score=teamScoreFor(event,team.id,holeNo),members=playersForTeam(event,team.id);
    const drive=activeInfo.tracksDrive?`<div class="drive-select"><label>Selected drive</label><select data-drive-team="${team.id}"><option value="">Choose player</option>${members.map(p=>`<option value="${p.id}" ${event.driveSelections?.[team.id]?.[holeNo]===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}</select></div>`:'';
    return `<article class="team-score-card"><div class="team-score-top"><div><span class="eyebrow">${escapeHtml(team.name)}</span><h3>${members.map(p=>escapeHtml(p.name.split(' ')[0])).join(' · ')}</h3><small>Team HCP ${Number(team.teamHcp||0).toFixed(1)}</small></div><div class="score-control team-control"><button data-team-score="minus" data-team="${team.id}">−</button><button class="score-value" data-team-score="par" data-team="${team.id}"><strong>${score==null?'—':score}</strong><span>Team</span></button><button data-team-score="plus" data-team="${team.id}">+</button><button class="clear-score" data-team-score="clear" data-team="${team.id}">×</button></div></div>${drive}${renderStatControls(event,'team',team.id,holeNo)}${formatKey==='ambrose'?renderDriveRequirement(event,team):''}</article>`;
  }).join('');
}
function renderDriveRequirement(event,team){const counts=driveCounts(event,team);const req=Number(event.minDrives)||0;return `<div class="drive-counts">${playersForTeam(event,team.id).map(p=>`<span class="${req&&counts[p.id]>=req?'done':''}">${escapeHtml(p.name.split(' ')[0])}: ${counts[p.id]}/${req||'—'}</span>`).join('')}</div>`}

function renderTournamentScorebar(event){
  if(event?.eventMode!=='tournament')return '';
  ensureTournamentGroups(event);const g=currentGroup(event);
  const selector=event.cloud?.role==='admin'?`<select data-scoring-group aria-label="Scoring group">${event.groups.map(x=>`<option value="${x.id}" ${x.id===g?.id?'selected':''}>${escapeHtml(x.name)}</option>`).join('')}</select>`:`<span class="my-group-pill">My group</span>`;
  return `<section class="tournament-scorebar"><div><p class="eyebrow">TOURNAMENT SCORECARD</p><strong>${escapeHtml(g?.name||'Your group')}</strong><small>${g?`${g.playerIds.length} players · ${g.teeTime}${event.startType==='shotgun'?` · Start hole ${g.startingHole}`:''}`:''}</small></div>${selector}</section>`;
}
function claimPlayerPrompt(event){
  return `<div class="claim-player-card"><span class="eyebrow">LINK YOUR SCORECARD</span><h3>Which player are you?</h3><p>Your Fairway One account must be linked to your player entry before you can score. Once linked, you only enter your own score and personal stats.</p><button class="primary-btn gold" data-action="claim-player" data-event-id="${event.id}">Choose my player</button></div>`;
}
function playScreen(){
  const event=activeEvent();
  if(!event)return `<main class="screen">${topbar('Play','FAIRWAY ONE')}<section class="page-intro"><p class="eyebrow">LIVE SCORING</p><h1 class="page-title">Nothing to score yet.</h1><p class="body-copy">Create an event first.</p></section><button class="primary-btn full" data-action="create-event">Create event</button></main>`;
  ensureCustomSegments(event);ensureTournamentGroups(event);
  const holeNo=currentHoleNo(event),hole=event.course.holes[holeNo-1],formatKey=formatKeyForHole(event,holeNo),info=formatInfo(formatKey),segment=segmentForHole(event,holeNo),confirmed=isCurrentHoleConfirmed(event,holeNo);
  const needsClaim=!!(cloud.session&&event.cloud?.synced&&event.cloud?.role==='player'&&!selfPlayer(event));
  const entry=needsClaim?claimPlayerPrompt(event):(info.entry==='team'?teamScoreRows(event,holeNo,formatKey):individualScoreRows(event,holeNo,formatKey));
  const heading=needsClaim?'Link your player':info.entry==='team'?(editableTeams(event,holeNo).length===1?'Enter your team score':'Enter team scores'):(cloudSelfMode(event,holeNo)?'Enter your score':'Enter player scores');
  const actions=needsClaim?'':`<div class="hole-actions"><button class="secondary-btn" data-action="save-only">Save</button><button class="primary-btn" data-action="confirm-hole">${confirmed?'Update & next hole':`Confirm hole ${holeNo}`}</button></div>`;
  return `<main class="screen play-screen-v5">${topbar('Live scoring',event.course.name)}${renderTournamentScorebar(event)}<section class="play-header"><div class="hole-nav"><button data-action="prev-hole">‹</button><div class="hole-centre"><span>Hole</span><strong>${holeNo}</strong></div><button data-action="next-hole">›</button></div><div class="hole-info"><div><span>Par</span><strong>${hole.par}</strong></div><div><span>SI</span><strong>${hole.si}</strong></div><div><span>Metres</span><strong>${hole.distance||'—'}</strong></div><div><span>Status</span><strong>${confirmed?'✓':'—'}</strong></div></div><div class="format-banner"><div>${segment?`<span>${escapeHtml(segment.name)} · ${escapeHtml(holesLabel(segment.holes))}</span>`:`<span>${escapeHtml(info.category)}</span>`}<strong>${escapeHtml(info.name)}</strong></div><button data-action="format-info">How it works</button></div></section><section class="score-section"><div class="score-head"><div><p class="eyebrow">${escapeHtml(event.name)}</p><h2>${heading}</h2></div><span class="sync-pill"><i></i> ${escapeHtml(cloudLabel())}</span></div><div class="score-list">${entry}</div>${!needsClaim&&info.tracksDrive&&info.entry==='individual'?renderDriveSelectors(event,holeNo):''}</section>${renderLiveImpact(event)}${actions}${event.format==='custom'?`<p class="muted-note">Custom round active. Fairway One is applying <strong>${escapeHtml(info.name)}</strong> to hole ${holeNo} from the segment you built.</p>`:''}</main>`;
}
function renderDriveSelectors(event,holeNo){return `<div class="drive-selector-stack"><p class="eyebrow">SELECTED DRIVE</p>${editableTeams(event,holeNo).map(t=>`<div class="drive-select"><label>${escapeHtml(t.name)}</label><select data-drive-team="${t.id}"><option value="">Choose player</option>${playersForTeam(event,t.id).map(p=>`<option value="${p.id}" ${event.driveSelections?.[t.id]?.[holeNo]===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}</select></div>`).join('')}</div>`}
function strokeSideSummary(event){
  const info=formatInfo(formatKeyForHole(event,currentHoleNo(event)));
  if(info.entry==='team'){
    const rows=activeTeams(event).map(team=>({team,stats:teamRoundStats(event,team)})).filter(x=>x.stats.holes>0).sort((a,b)=>(a.stats.gross??a.stats.total??999)-(b.stats.gross??b.stats.total??999));
    return rows[0]?{label:`${rows[0].team.name} ${rows[0].stats.gross??rows[0].stats.total}`,detail:'Gross strokes'}:{label:'—',detail:'Gross strokes'};
  }
  const rows=currentScoringPlayers(event).map(player=>({player,stats:strokeStats(event,player)})).filter(x=>x.stats.holes>0).sort((a,b)=>a.stats.gross-b.stats.gross);
  return rows[0]?{label:`${rows[0].player.name.split(' ')[0]} ${rows[0].stats.gross}`,detail:`${rows[0].stats.holes} holes · gross`}:{label:'—',detail:'Gross strokes'};
}
function genericTeamMatchStatus(event){
  const teams=activeTeams(event);if(teams.length<2)return {label:'—',detail:teams.length===1?'Single team':'Need two teams'};
  const [a,b]=teams;let aw=0,bw=0,holes=0;
  event.course.holes.forEach(h=>{let av=teamHoleValue(event,a,h.number),bv=teamHoleValue(event,b,h.number);if(av==null||bv==null)return;holes++;if(event.format==='fourball_stableford'){if(av>bv)aw++;else if(bv>av)bw++;}else{if(av<bv)aw++;else if(bv<av)bw++;}});
  const diff=aw-bw;let label='ALL SQUARE';if(diff>0)label=`${a.name} ${diff} UP`;if(diff<0)label=`${b.name} ${Math.abs(diff)} UP`;return {label,detail:`${holes} hole${holes===1?'':'s'} matched`};
}
function matchSideSummary(event){
  const info=formatInfo(formatKeyForHole(event,currentHoleNo(event)));
  if(info.entry==='team'||eventUsesTeams(event)&&activeTeams(event).length>=2){const s=event.format==='fourball_match'?fourballMatchStatus(event):genericTeamMatchStatus(event);return {label:s.label||'—',detail:s.holes!=null?`${s.holes} holes`:s.detail||'Side match'};}
  const players=currentScoringPlayers(event);if(players.length<2)return {label:'—',detail:'Need two players'};
  const pairs=[];for(let i=0;i+1<players.length;i+=2)pairs.push([players[i],players[i+1]]);
  if(pairs.length===1){const st=matchStatus(event,pairs[0][0],pairs[0][1]);return {label:st.label,detail:`${st.holes} holes`};}
  const live=pairs.map(([a,b])=>matchStatus(event,a,b));return {label:`${live.length} matches`,detail:live.map(x=>x.label).join(' · ')};
}
function renderLiveImpact(event){
  if(event.format==='custom'){
    const seg=segmentForHole(event,currentHoleNo(event)),lead=seg?segmentLeader(event,seg):{label:'—',detail:''},info=seg?formatInfo(seg.format):formatInfo('custom'),overall=customEventPoints(event),overallLead=overall[0];
    return `<section class="mini-impact"><div class="card-row"><span class="eyebrow">LIVE IMPACT</span><span class="status-pill">CUSTOM</span></div><div class="impact-grid"><div class="impact-item"><span>Segment</span><strong>${escapeHtml(seg?.name||'Unassigned')}</strong><small>${escapeHtml(info.short)}</small></div><div class="impact-item"><span>Segment leader</span><strong>${escapeHtml(lead.label)}</strong><small>${escapeHtml(lead.detail||'Current segment')}</small></div><div class="impact-item"><span>Event points</span><strong>${overallLead?`${escapeHtml(overallLead.name)} ${eventPointsLabel(overallLead.points)}`:'—'}</strong><small>${overallLead?'Running overall':'No segment awarded yet'}</small></div><div class="impact-item"><span>Through</span><strong>${eventProgress(event)}</strong><small>Confirmed holes</small></div></div></section>`;
  }
  const board=scoredPrimaryLeaderboard(event);let leader='—';
  if(board[0]?.type==='player'){const x=board[0];leader=event.format==='stableford'?`${x.player.name.split(' ')[0]} ${x.stats.points} pts`:event.format==='skins'?`${x.player.name.split(' ')[0]} ${x.stats.skins} skins`:event.format==='par_bogey'||event.format==='modified_stableford'?`${x.player.name.split(' ')[0]} ${signed(x.stats.points)}`:event.format==='stroke'?`${x.player.name.split(' ')[0]} ${signed(x.stats.toPar)}`:'Live'}
  else if(board[0]?.type==='team')leader=`${board[0].team.name}`;else if(board[0]?.status)leader=board[0].status.label;
  const stroke=strokeSideSummary(event),match=matchSideSummary(event),group=currentGroup(event);
  return `<section class="mini-impact"><div class="card-row"><span class="eyebrow">LIVE IMPACT</span><span class="status-pill">AUTO</span></div><div class="impact-grid"><div class="impact-item primary-impact"><span>Format</span><strong>${escapeHtml(formatInfo(event.format).short)}</strong><small>Primary competition</small></div><div class="impact-item primary-impact"><span>Leader</span><strong>${escapeHtml(leader)}</strong><small>Official live standing</small></div><div class="impact-item side-impact"><span>Total strokes</span><strong>${escapeHtml(stroke.label)}</strong><small>${escapeHtml(stroke.detail)}</small></div><div class="impact-item side-impact"><span>Match play</span><strong>${escapeHtml(match.label)}</strong><small>${escapeHtml(match.detail)}</small></div><div class="impact-item"><span>Through</span><strong>${event.eventMode==='tournament'?groupProgress(event,group):eventProgress(event)}</strong><small>${event.eventMode==='tournament'?escapeHtml(group?.name||'Group'):'Completed holes'}</small></div><div class="impact-item"><span>Entries</span><strong>${event.eventMode==='tournament'?currentScoringPlayers(event).length:(formatInfo(event.format).entry==='team'?activeTeams(event).length:event.players.length)}</strong><small>${event.eventMode==='tournament'?'players in group':formatInfo(event.format).entry==='team'?'teams':'players'}</small></div></div></section>`;
}
function eventsScreen(){return `<main class="screen">${topbar('Events','FAIRWAY ONE')}<section class="page-intro"><p class="eyebrow">COMPETITION BUILDER</p><h1 class="page-title">Play it your way.</h1><p class="body-copy">Start a social round, join your group, build a mixed-format competition, or run a tournament with up to 72 players.</p></section><div class="event-create-grid"><button class="primary-btn gold" data-action="create-event">+ New round</button><button class="secondary-btn" data-action="join-event">Join an event</button><button class="secondary-btn" data-action="create-custom-event">Build custom round</button><button class="secondary-btn tournament-launch" data-action="create-tournament">Run a tournament · up to 72</button></div>${renderEventList(state.events)}</main>`}
function comparisonTabs(event){if(event.format==='custom'){const tabs=[['primary','Segments']];if(event.trackStats)tabs.push(['stats','Stats']);return tabs}const info=formatInfo(event.format);if(info.entry==='team'){const tabs=[['primary',info.short]];if(event.trackStats)tabs.push(['stats','Stats']);return tabs}const tabs=event.eventMode==='tournament'?[['primary',info.short],['stroke','Stroke'],['stableford','Stableford']]:[['primary',info.short],['stroke','Stroke'],['stableford','Stableford'],['match','Match']];if(event.trackStats)tabs.push(['stats','Stats']);return tabs.filter((x,i,a)=>a.findIndex(y=>y[0]===x[0])===i)}
function leaderboardScreen(){const event=activeEvent();if(!event)return `<main class="screen">${topbar('Scores','FAIRWAY ONE')}<section class="page-intro"><h1 class="page-title">No active event.</h1></section></main>`;if(event.format==='custom'){ensureCustomSegments(event);const tabs=comparisonTabs(event);if(!tabs.some(t=>t[0]===ui.leaderboard))ui.leaderboard='primary';const body=ui.leaderboard==='stats'?renderStatsBoard(event):renderCustomLeaderboard(event);return `<main class="screen">${topbar('Live scores',event.name)}<section class="page-intro"><p class="eyebrow">${eventProgress(event)}/18 COMPLETE</p><h1 class="page-title">${ui.leaderboard==='stats'?'Round stats':'Segment board'}</h1><p class="body-copy">${escapeHtml(event.course.name)} · Build Your Round</p></section><div class="segment-tabs">${tabs.map(([k,l])=>`<button class="${ui.leaderboard===k?'active':''}" data-leader-tab="${k}">${escapeHtml(l)}</button>`).join('')}</div>${body}</main>`}const tabs=comparisonTabs(event);if(!tabs.some(t=>t[0]===ui.leaderboard))ui.leaderboard='primary';let body='';if(ui.leaderboard==='primary')body=renderPrimaryLeaderboard(event);if(ui.leaderboard==='stroke')body=renderIndividualBoard(event,'stroke');if(ui.leaderboard==='stableford')body=renderIndividualBoard(event,'stableford');if(ui.leaderboard==='match')body=renderMatchBoard(event);if(ui.leaderboard==='stats')body=renderStatsBoard(event);return `<main class="screen">${topbar('Live scores',event.name)}<section class="page-intro"><p class="eyebrow">${event.eventMode==='tournament'?`${event.players.length} PLAYERS · ${event.groups?.length||0} GROUPS`:`${eventProgress(event)}/18 COMPLETE`}</p><h1 class="page-title">Leaderboard</h1><p class="body-copy">${escapeHtml(event.course.name)} · ${escapeHtml(formatInfo(event.format).name)}</p></section><div class="segment-tabs">${tabs.map(([k,l])=>`<button class="${ui.leaderboard===k?'active':''}" data-leader-tab="${k}">${escapeHtml(l)}</button>`).join('')}</div>${body}</main>`}
function renderCustomLeaderboard(event){const overall=customEventPoints(event),completed=event.customSegments.filter(seg=>segmentResult(event,seg).complete).length;const overallHtml=overall.length?`<section class="event-points-board"><div class="event-points-head"><div><p class="eyebrow">OVERALL EVENT SCORE</p><h2>Competition points</h2></div><span>${completed}/${event.customSegments.length} segments awarded</span></div><div class="event-points-list">${overall.map((x,i)=>`<div class="event-points-row"><span class="event-points-rank ${i===0?'first':''}">${i+1}</span><div><strong>${escapeHtml(x.name)}</strong><small>${escapeHtml(x.type==='team'?'Team':'Player')} · ${x.segments} segment${x.segments===1?'':'s'} scored</small></div><b>${eventPointsLabel(x.points)} pts</b></div>`).join('')}</div></section>`:`<section class="event-points-board empty"><p class="eyebrow">OVERALL EVENT SCORE</p><h2>Competition points</h2><p>No segment points have been awarded yet. Complete the first segment to start the overall score.</p></section>`;const segments=`<div class="custom-segment-board">${event.customSegments.map((seg,i)=>{const live=segmentLeader(event,seg),result=segmentResult(event,seg),info=formatInfo(seg.format),done=(seg.holes||[]).filter(h=>event.confirmedHoles.includes(h)).length,award=result.complete?(result.awards||[]).map(a=>`${escapeHtml(a.name)} +${eventPointsLabel(a.points)}`).join(' · '):'';return `<article class="custom-result-card ${segmentTone(i)} ${result.complete?'complete':''}"><div class="custom-result-top"><div><span class="segment-dot"></span><p class="eyebrow">${escapeHtml(seg.name)}</p></div><span class="segment-state ${result.status}">${result.complete?'AWARDED':`${done}/${seg.holes.length}`}</span></div><h3>${escapeHtml(info.name)}</h3><p>${escapeHtml(holesLabel(seg.holes))} · ${eventPointsLabel(Number(seg.points||0))} pt${Number(seg.points||0)===1?'':'s'}</p><div class="custom-result-leader"><span>${result.complete?'Segment result':'Current leader'}</span><strong>${escapeHtml(result.complete?result.label:live.label)}</strong><small>${escapeHtml(result.complete?(result.detail||'Final'):live.detail||'Awaiting scores')}</small></div>${result.complete?`<div class="segment-award"><span>POINTS AWARDED</span><strong>${award||'No points'}</strong></div>`:''}<div class="custom-result-footer"><span>${result.complete?'Derived from confirmed scores':'Points award when segment is decided'}</span><button data-action="event-edit" data-event-id="${event.id}">Edit setup</button></div></article>`}).join('')}</div>`;return `${overallHtml}<div class="section-head custom-results-title"><div><p class="eyebrow">SEGMENT RESULTS</p><h3>Each section scores itself</h3></div></div>${segments}`}

function renderIndividualBoard(event,mode){let entries=event.players.map(p=>({player:p,stats:mode==='stableford'?stablefordStats(event,p):strokeStats(event,p)}));if(event.eventMode==='tournament')entries=entries.filter(x=>x.stats.holes>0);entries.sort((a,b)=>mode==='stableford'?b.stats.points-a.stats.points:a.stats.toPar-b.stats.toPar);return `<section class="leaderboard"><div class="leader-head"><span>Pos</span><span>Player</span><span>Thru</span><span>Score</span></div>${entries.map((e,i)=>`<div class="leader-row"><span class="pos ${i===0?'first':''}">${i+1}</span><div class="leader-person">${avatar(e.player,true)}<div><strong>${escapeHtml(e.player.name)}</strong><span>HCP ${e.player.hcp}</span></div></div><span class="leader-thru">${e.stats.holes}</span><strong class="leader-score">${mode==='stableford'?`${e.stats.points} pts`:signed(e.stats.toPar)}</strong></div>`).join('')}</section>`}
function renderMatchBoard(event){return `<div class="match-list">${matchPairs(event).map(([a,b])=>{const s=matchStatus(event,a,b);return `<article class="match-card"><div><strong>${escapeHtml(a.name)}</strong><span>HCP ${a.hcp}</span></div><div class="match-result">${escapeHtml(s.label)}<span>${s.holes} holes</span></div><div><strong>${escapeHtml(b.name)}</strong><span>HCP ${b.hcp}</span></div></article>`}).join('')||'<div class="empty-card">Need two players.</div>'}</div>`}
function renderPrimaryLeaderboard(event){if(event.format==='custom')return renderCustomLeaderboard(event);const fmt=event.format;const board=scoredPrimaryLeaderboard(event);if(fmt==='match')return renderMatchBoard(event);if(fmt==='fourball_match')return `<div class="match-list"><article class="match-card"><div><strong>${escapeHtml(event.teams[0]?.name||'Team A')}</strong></div><div class="match-result">${escapeHtml(fourballMatchStatus(event).label)}<span>${fourballMatchStatus(event).holes} holes</span></div><div><strong>${escapeHtml(event.teams[1]?.name||'Team B')}</strong></div></article></div>`;if(board[0]?.type==='player')return `<section class="leaderboard"><div class="leader-head"><span>Pos</span><span>Player</span><span>Thru</span><span>Score</span></div>${board.map((e,i)=>{let score='';if(fmt==='stroke')score=signed(e.stats.toPar);if(fmt==='stableford')score=`${e.stats.points} pts`;if(fmt==='par_bogey'||fmt==='modified_stableford')score=signed(e.stats.points);if(fmt==='skins')score=`${e.stats.skins} skins`;return `<div class="leader-row"><span class="pos ${i===0?'first':''}">${i+1}</span><div class="leader-person">${avatar(e.player,true)}<div><strong>${escapeHtml(e.player.name)}</strong><span>HCP ${e.player.hcp}</span></div></div><span class="leader-thru">${e.stats.holes}</span><strong class="leader-score">${score}</strong></div>`}).join('')}</section>`;return `<div class="team-board">${board.map((e,i)=>{const stats=e.stats;const score=fmt==='fourball_stableford'?`${stats.points||0} pts`:formatInfo(fmt).entry==='team'?`${stats.gross||0} gross · ${stats.net!=null?signed(stats.toPar):'—'}`:signed(stats.toPar||0);return `<article class="team-leader-card"><div class="team-rank">${i+1}</div><div><span class="eyebrow">${escapeHtml(e.team.name)}</span><h3>${playersForTeam(event,e.team.id).map(p=>escapeHtml(p.name.split(' ')[0])).join(' · ')}</h3><p>${stats.holes||0} holes · ${score}</p>${fmt==='ambrose'?renderDriveRequirement(event,e.team):''}</div></article>`}).join('')}</div>`}

function profileScreen(){const signed=!!cloud.session;const email=cloud.session?.user?.email||'';const provider=countryHandicapProvider(state.profile.countryCode);return `<main class="screen">${topbar('More','FAIRWAY ONE')}<section class="profile-hero"><div class="profile-avatar">${state.profile.avatarPath?`<img src="${escapeHtml(profilePhotoUrl(state.profile.avatarPath))}" alt="${escapeHtml(state.profile.name)}">`:escapeHtml(initials(state.profile.name))}</div><div><p class="eyebrow">FAIRWAY ONE PROFILE</p><h1>${escapeHtml(state.profile.name)}</h1><p>${state.profile.homeClub?`${escapeHtml(state.profile.homeClub)} · `:''}HCP ${Number(state.profile.hcp||0).toFixed(1)}</p></div></section><section class="stat-grid"><article class="stat-card"><span>Rounds</span><strong>${completedEvents().length}</strong></article><article class="stat-card"><span>Formats</span><strong>${STANDALONE_FORMAT_COUNT}</strong></article><article class="stat-card"><span>Handicap</span><strong>${Number(state.profile.hcp||0).toFixed(1)}</strong></article><article class="stat-card"><span>Cloud</span><strong>${signed?'On':'Off'}</strong></article></section><section class="section"><div class="section-head"><div><p class="eyebrow">HANDICAP</p><h3>${escapeHtml(provider.name)}</h3></div></div><div class="event-card handicap-profile-card"><p class="muted-note">Use your national handicap service to confirm your playing handicap for the course and tees you are playing.</p><a class="primary-btn small-btn handicap-link" href="${provider.url}" target="_blank" rel="noopener">${escapeHtml(provider.label)} ↗</a></div></section><section class="section"><div class="section-head"><div><p class="eyebrow">FAIRWAY ONE CLOUD</p><h3>${signed?'Connected':'Connect your account'}</h3></div><span class="status-pill"><i></i>${escapeHtml(cloudLabel())}</span></div><div class="event-card cloud-card">${signed?`<p><strong>${escapeHtml(email)}</strong></p><p class="muted-note">Keep your rounds and scores synced across your devices.</p><div class="event-actions"><button class="primary-btn small-btn" data-action="cloud-sync">Sync active round</button><button class="secondary-btn small-btn" data-action="cloud-refresh">Refresh</button><button class="ghost-btn small-btn" data-action="cloud-signout">Sign out</button></div>`:`<p class="muted-note">Create or sign into a Fairway One account to keep your rounds and scores available across devices.</p><div class="event-actions"><button class="primary-btn small-btn" data-action="cloud-auth">Sign in / create account</button></div>`}${cloud.lastError?`<p class="cloud-error">Cloud error: ${escapeHtml(cloud.lastError.message||'Unknown error')}</p>`:''}</div></section><section class="section"><div class="section-head"><div><p class="eyebrow">LEARNING CENTRE</p><h3>Formats & rules</h3></div></div><div class="learn-grid"><button class="learn-card" data-action="open-game-guide"><span class="learn-icon">${icon('target')}</span><strong>How to play</strong><small>Every format in the Fairway One engine.</small><b>View formats →</b></button><button class="learn-card" data-action="open-rules"><span class="learn-icon">${icon('shield')}</span><strong>Rules of Golf</strong><small>Quick guide plus official rules links.</small><b>View rules →</b></button></div></section><section class="section"><div class="section-head"><div><p class="eyebrow">SETTINGS</p><h3>Account & data</h3></div></div><div class="event-card"><div class="event-actions"><button class="secondary-btn small-btn" data-action="edit-profile">Edit profile</button><button class="ghost-btn small-btn" data-action="export-data">Export rounds</button></div></div></section></main>`}

function render(){const screens={home:homeScreen,play:playScreen,events:eventsScreen,leaderboard:leaderboardScreen,profile:profileScreen};app.innerHTML=(screens[ui.tab]||homeScreen)();navButtons.forEach(b=>b.classList.toggle('active',b.dataset.tab===ui.tab));bindActions()}
function switchTab(tab){ui.tab=tab;app.scrollTop=0;render()}
function bindActions(){document.querySelectorAll('[data-action]').forEach(el=>el.addEventListener('click',handleAction));document.querySelectorAll('[data-score]').forEach(el=>el.addEventListener('click',handlePlayerScore));document.querySelectorAll('[data-team-score]').forEach(el=>el.addEventListener('click',handleTeamScore));document.querySelectorAll('[data-player-stat]').forEach(el=>el.addEventListener('click',handleStatAdjust));document.querySelectorAll('[data-team-stat]').forEach(el=>el.addEventListener('click',handleStatAdjust));document.querySelectorAll('[data-drive-team]').forEach(el=>el.addEventListener('change',handleDriveSelection));document.querySelectorAll('[data-leader-tab]').forEach(el=>el.addEventListener('click',()=>{ui.leaderboard=el.dataset.leaderTab;render()}));document.querySelectorAll('[data-scoring-group]').forEach(el=>el.addEventListener('change',()=>{const evt=activeEvent();if(!evt)return;evt.activeGroupId=el.value;saveState();render()}))}
async function handleAction(e){
  const el=e.currentTarget,a=el.dataset.action;
  if(a==='resume'){await subscribeActiveRound();return switchTab('play')}
  if(a==='create-event')return openEventModal();
  if(a==='create-custom-event')return openEventModal(null,true);
  if(a==='create-tournament')return openTournamentModal();
  if(a==='join-event')return cloud.session?openJoinEventModal():openCloudAuthModal('Sign in first, then use Join an event.');
  if(a==='claim-player')return openClaimPlayerModal(el.dataset.eventId||activeEvent()?.id);
  if(a==='event-edit'){
    const evt=state.events.find(x=>x.id===el.dataset.eventId);if(!evt)return;
    if(evt.cloud?.synced&&evt.cloud?.role!=='admin')return toast('Only the event organiser can edit this setup.');
    return evt.eventMode==='tournament'?openTournamentModal(el.dataset.eventId):openEventModal(el.dataset.eventId)
  }
  if(a==='activate-event'){
    const evt=state.events.find(x=>x.id===el.dataset.eventId);if(!evt)return;
    state.activeEventId=evt.id;if(evt.status!=='complete')evt.status='live';saveState();await subscribeActiveRound();
    if(evt.cloud?.synced&&evt.cloud?.role==='player'&&!selfPlayer(evt))return openClaimPlayerModal(evt.id);
    return switchTab('play')
  }
  if(a==='view-result'){const evt=state.events.find(x=>x.id===el.dataset.eventId);if(!evt)return;state.activeEventId=evt.id;saveState();return switchTab('leaderboard')}
  if(a==='prev-hole'||a==='next-hole'){
    const evt=activeEvent();if(!evt)return;const delta=a==='next-hole'?1:-1,h=currentHoleNo(evt),info=formatInfo(formatKeyForHole(evt,h)),me=selfPlayer(evt);
    if(cloud.session&&evt.cloud?.synced&&me){
      const next=evt.eventMode==='tournament'&&evt.startType==='shotgun'?rotateHole(h,delta):Math.min(18,Math.max(1,h+delta));
      evt.playerCurrentHoles ||= {};evt.playerCurrentHoles[me.id]=next;
      if(info.entry==='team'&&me.teamId){evt.teamCurrentHoles ||= {};evt.teamCurrentHoles[me.teamId]=next}
    }else if(evt.eventMode==='tournament'){
      const g=currentGroup(evt);if(!g)return;evt.groupCurrentHoles[g.id]=evt.startType==='shotgun'?rotateHole(h,delta):Math.min(18,Math.max(1,h+delta))
    }else evt.currentHole=Math.min(18,Math.max(1,(evt.currentHole||1)+delta));
    saveState();return render()
  }
  if(a==='save-only'){saveState(true);queueCloudSync(activeEvent(),{immediate:true});return}
  if(a==='confirm-hole')return confirmCurrentHole();
  if(a==='open-game-guide')return openGameGuideModal();
  if(a==='open-rules')return openRulesModal();
  if(a==='format-info'){const evt=activeEvent();return openSingleFormatModal(formatKeyForHole(evt,currentHoleNo(evt)))}
  if(a==='edit-profile')return openProfileModal();
  if(a==='export-data')return exportData();
  if(a==='reset-demo')return resetLocalData();
  if(a==='cloud-auth')return openCloudAuthModal();
  if(a==='cloud-refresh')return refreshCloud();
  if(a==='cloud-sync'){const evt=activeEvent();if(!evt)return toast('No active event to sync.');queueCloudSync(evt,{structure:evt.cloud?.role==='admin',immediate:true});return toast('Cloud sync started.')}
  if(a==='cloud-signout'){await signOut();toast('Signed out. Local scoring still works.');return}
  if(a==='about')return toast('<strong>Fairway One</strong> · Play · Score · Compete')
}

function recalcSharedConfirmation(event,hole){
  const h=Number(hole);
  if(event.eventMode==='tournament'){
    const g=currentGroup(event);if(!g)return;
    const all=(g.playerIds||[]).every(pid=>(event.playerConfirmedHoles?.[pid]||[]).includes(h));
    event.groupConfirmedHoles[g.id] ||= [];
    event.groupConfirmedHoles[g.id]=all?[...new Set([...event.groupConfirmedHoles[g.id],h])].sort((a,b)=>a-b):event.groupConfirmedHoles[g.id].filter(x=>x!==h);
  }else{
    const all=(event.players||[]).length>0&&(event.players||[]).every(p=>(event.playerConfirmedHoles?.[p.id]||[]).includes(h));
    event.confirmedHoles ||= [];
    event.confirmedHoles=all?[...new Set([...event.confirmedHoles,h])].sort((a,b)=>a-b):event.confirmedHoles.filter(x=>x!==h);
  }
}
function recalcTeamSharedConfirmation(event,hole){
  const h=Number(hole),teams=activeTeams(event),all=teams.length>0&&teams.every(t=>(event.teamConfirmedHoles?.[t.id]||[]).includes(h));
  event.confirmedHoles ||= [];
  event.confirmedHoles=all?[...new Set([...event.confirmedHoles,h])].sort((a,b)=>a-b):event.confirmedHoles.filter(x=>x!==h);
}
function handlePlayerScore(e){
  const evt=activeEvent();if(!evt)return;const pid=e.currentTarget.dataset.player,h=currentHoleNo(evt),action=e.currentTarget.dataset.score;const par=evt.course.holes[h-1].par;let v=scoreFor(evt,pid,h);
  if(action==='clear')v=null;else if(action==='par')v=v==null?par:v;else if(action==='plus')v=(v==null?par:v)+1;else if(action==='minus')v=Math.max(1,(v==null?par:v)-1);
  evt.scores[pid] ||= {};if(v==null)delete evt.scores[pid][h];else evt.scores[pid][h]=v;
  if(cloudSelfMode(evt,h)){evt.playerConfirmedHoles ||= {};evt.playerConfirmedHoles[pid]=(evt.playerConfirmedHoles[pid]||[]).filter(x=>x!==h);recalcSharedConfirmation(evt,h)}
  else if(evt.eventMode==='tournament'){const g=currentGroup(evt);if(g)evt.groupConfirmedHoles[g.id]=(evt.groupConfirmedHoles[g.id]||[]).filter(x=>x!==h)}
  else evt.confirmedHoles=evt.confirmedHoles.filter(x=>x!==h);
  saveState();queueCloudSync(evt);render()
}
function handleTeamScore(e){
  const evt=activeEvent();if(!evt)return;const tid=e.currentTarget.dataset.team,h=currentHoleNo(evt),action=e.currentTarget.dataset.teamScore;const par=evt.course.holes[h-1].par;let v=teamScoreFor(evt,tid,h);
  if(action==='clear')v=null;else if(action==='par')v=v==null?par:v;else if(action==='plus')v=(v==null?par:v)+1;else if(action==='minus')v=Math.max(1,(v==null?par:v)-1);
  evt.teamScores[tid] ||= {};if(v==null)delete evt.teamScores[tid][h];else evt.teamScores[tid][h]=v;
  if(cloudTeamMode(evt,h)){evt.teamConfirmedHoles ||= {};evt.teamConfirmedHoles[tid]=(evt.teamConfirmedHoles[tid]||[]).filter(x=>x!==h);recalcTeamSharedConfirmation(evt,h)}else evt.confirmedHoles=evt.confirmedHoles.filter(x=>x!==h);
  saveState();queueCloudSync(evt);render()
}
function handleStatAdjust(e){
  const evt=activeEvent();if(!evt)return;const h=currentHoleNo(evt),field=e.currentTarget.dataset.statField,dir=Number(e.currentTarget.dataset.statDir||0);const pid=e.currentTarget.dataset.playerStat,tid=e.currentTarget.dataset.teamStat;
  if(!field||(!pid&&!tid))return;const stat=holeStatObject(evt,tid?'team':'player',tid||pid,h);const current=stat[field]==null?0:Number(stat[field]||0);stat[field]=Math.max(0,Math.min(20,current+dir));saveState();queueCloudSync(evt);render()
}
function handleDriveSelection(e){const evt=activeEvent();if(!evt)return;const tid=e.currentTarget.dataset.driveTeam,h=currentHoleNo(evt);evt.driveSelections[tid] ||= {};if(e.currentTarget.value)evt.driveSelections[tid][h]=e.currentTarget.value;else delete evt.driveSelections[tid][h];saveState();queueCloudSync(evt);render()}
function confirmCurrentHole(){
  const evt=activeEvent();if(!evt)return;const h=currentHoleNo(evt),formatKey=formatKeyForHole(evt,h),info=formatInfo(formatKey),me=selfPlayer(evt);
  if(evt.cloud?.synced&&evt.cloud?.role==='player'&&!me)return openClaimPlayerModal(evt.id);
  if(info.entry==='team'){
    const teams=editableTeams(evt,h);if(!teams.length)return toast('Your team is not linked to this event.');
    if(teams.some(t=>teamScoreFor(evt,t.id,h)==null))return toast('Enter your team score before confirming.');
    if(info.tracksDrive&&teams.some(t=>!evt.driveSelections?.[t.id]?.[h]))return toast('Select the chosen drive before confirming.');
    if(cloudTeamMode(evt,h)){
      evt.teamConfirmedHoles ||= {};evt.teamCurrentHoles ||= {};evt.playerCurrentHoles ||= {};
      teams.forEach(t=>{evt.teamConfirmedHoles[t.id] ||= [];if(!evt.teamConfirmedHoles[t.id].includes(h))evt.teamConfirmedHoles[t.id].push(h);evt.teamConfirmedHoles[t.id].sort((a,b)=>a-b);recalcTeamSharedConfirmation(evt,h);const start=teamStartHole(evt,t);evt.teamCurrentHoles[t.id]=nextUnconfirmedHole(start,evt.teamConfirmedHoles[t.id])});
      const mine=teams[0];if(me)evt.playerCurrentHoles[me.id]=nextUnconfirmedHole(playerStartHole(evt,me.id),selfConfirmedHoles(evt,me));
      const done=me?selfCardComplete(evt,me):(evt.teamConfirmedHoles[mine.id]||[]).length>=18,allDone=(evt.players||[]).filter(p=>p.userId||p.isSelf).length?(evt.players||[]).filter(p=>p.userId||p.isSelf).every(p=>selfCardComplete(evt,p)):activeTeams(evt).every(t=>(evt.teamConfirmedHoles?.[t.id]||[]).length>=18);
      if(allDone&&evt.cloud?.role==='admin'){evt.status='complete';evt.completedAt=new Date().toISOString()}
      saveState();queueCloudSync(evt,{immediate:true});if(done){toast('<strong>Your card is complete.</strong>');return switchTab('leaderboard')}render();return toast(`Hole ${h} confirmed for ${mine.name}.`)
    }
  }else if(cloudSelfMode(evt,h)){
    const players=editableScoringPlayers(evt,h);if(!players.length)return openClaimPlayerModal(evt.id);const p=players[0];if(scoreFor(evt,p.id,h)==null)return toast('Enter your score before confirming.');
    if(info.tracksDrive&&editableTeams(evt,h).some(t=>!evt.driveSelections?.[t.id]?.[h]))return toast('Select the chosen drive for your team before confirming.');
    evt.playerConfirmedHoles ||= {};evt.playerCurrentHoles ||= {};evt.playerConfirmedHoles[p.id] ||= [];if(!evt.playerConfirmedHoles[p.id].includes(h))evt.playerConfirmedHoles[p.id].push(h);evt.playerConfirmedHoles[p.id].sort((a,b)=>a-b);recalcSharedConfirmation(evt,h);evt.playerCurrentHoles[p.id]=nextUnconfirmedHole(playerStartHole(evt,p.id),selfConfirmedHoles(evt,p));
    const done=selfCardComplete(evt,p),linked=(evt.players||[]).filter(x=>x.userId||x.isSelf),allDone=linked.length?linked.every(x=>selfCardComplete(evt,x)):(evt.players||[]).every(x=>(evt.playerConfirmedHoles?.[x.id]||[]).length>=18);
    if(allDone&&evt.cloud?.role==='admin'){evt.status='complete';evt.completedAt=new Date().toISOString()}
    saveState();queueCloudSync(evt,{immediate:true});if(done){toast('<strong>Your round is complete.</strong>');return switchTab('leaderboard')}render();return toast(`Hole ${h} confirmed.`)
  }
  let missing=false;if(info.entry==='team')missing=activeTeams(evt).some(t=>teamScoreFor(evt,t.id,h)==null);else missing=currentScoringPlayers(evt).some(p=>scoreFor(evt,p.id,h)==null);if(missing)return toast('Enter every required score before confirming.');
  if(info.tracksDrive){const teams=activeTeams(evt);if(teams.some(t=>!evt.driveSelections?.[t.id]?.[h]))return toast('Select the chosen drive for each team.')}
  if(evt.eventMode==='tournament'){
    const g=currentGroup(evt);if(!g)return;evt.groupConfirmedHoles[g.id] ||= [];if(!evt.groupConfirmedHoles[g.id].includes(h))evt.groupConfirmedHoles[g.id].push(h);
    if(evt.groupConfirmedHoles[g.id].length>=18){if(tournamentComplete(evt)){evt.status='complete';evt.completedAt=new Date().toISOString();saveState();queueCloudSync(evt,{immediate:true});toast('<strong>Tournament complete.</strong> Results saved.');return switchTab('leaderboard')}saveState();queueCloudSync(evt,{immediate:true});render();return toast(`${g.name} complete. Select another group to continue.`)}
    evt.groupCurrentHoles[g.id]=evt.startType==='shotgun'?rotateHole(h,1):Math.min(18,h+1);saveState();queueCloudSync(evt,{immediate:true});render();return toast(`${g.name} · hole ${h} confirmed.`)
  }
  if(!evt.confirmedHoles.includes(h))evt.confirmedHoles.push(h);if(evt.confirmedHoles.length>=18){evt.status='complete';evt.completedAt=new Date().toISOString();saveState();queueCloudSync(evt,{immediate:true});toast('<strong>Round complete.</strong> Results saved.');return switchTab('leaderboard')}evt.currentHole=Math.min(18,h+1);saveState();queueCloudSync(evt,{immediate:true});render();toast(`Hole ${h} confirmed.`)
}

function openJoinEventModal(){
  if(!cloud.session)return openCloudAuthModal('Sign in first, then join your event.');
  modalRoot.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-sheet"><div class="modal-handle"></div><div class="modal-title-row"><div><p class="eyebrow">JOIN AN EVENT</p><h2>Enter the Fairway One code</h2><p class="body-copy">Get the join code from the organiser. Once you join, choose your name from the player list and your phone becomes your personal scorecard.</p></div><button class="modal-close" data-modal-close>×</button></div><div class="form-section"><div class="field full-span"><label>Event join code</label><input id="eventJoinCode" inputmode="text" autocapitalize="characters" maxlength="12" placeholder="AB12CD34"></div></div><div class="modal-actions"><button class="secondary-btn" data-modal-close>Cancel</button><button class="primary-btn gold" id="joinEventNow">Join event</button></div></section></div>`;
  bindInfoModal();
  const input=modalRoot.querySelector('#eventJoinCode');input?.focus();
  input?.addEventListener('input',()=>input.value=input.value.toUpperCase().replace(/[^A-Z0-9]/g,''));
  modalRoot.querySelector('#joinEventNow')?.addEventListener('click',async()=>{
    const code=input?.value.trim().toUpperCase();if(!code)return toast('Enter the event join code.');
    try{
      const joined=await joinEventByCode(code);closeModal();await refreshCloud({silent:true});const evt=state.events.find(x=>x.cloud?.eventId===joined.event?.id||x.id===joined.event?.id);if(!evt)return toast('Event joined. Refresh Events to continue.');state.activeEventId=evt.id;saveState();toast(`<strong>Joined ${escapeHtml(evt.name)}.</strong>`);return selfPlayer(evt)?switchTab('play'):openClaimPlayerModal(evt.id)
    }catch(err){toast(`Could not join event: ${escapeHtml(err.message||'Unknown error')}`)}
  });
}
function openClaimPlayerModal(eventId){
  const evt=state.events.find(x=>x.id===eventId)||activeEvent();if(!evt)return;
  if(selfPlayer(evt)){closeModal();return switchTab('play')}
  if(!cloud.session)return openCloudAuthModal('Sign in to link your player entry.');
  const available=(evt.players||[]).filter(p=>!p.claimed&&!p.userId);
  const rows=available.length?available.map(p=>`<button class="claim-player-option" data-claim-player-id="${p.id}">${avatar(p)}<span><strong>${escapeHtml(p.name)}</strong><small>HCP ${Number(p.hcp||0).toFixed(1)}${playerGroup(evt,p.id)?` · ${escapeHtml(playerGroup(evt,p.id).name)}`:''}</small></span><b>Choose →</b></button>`).join(''):`<div class="empty-card"><h3>No unclaimed players.</h3><p>Ask the organiser to add you to the field or check that another account has not already claimed your name.</p></div>`;
  modalRoot.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-sheet"><div class="modal-handle"></div><div class="modal-title-row"><div><p class="eyebrow">YOUR SCORECARD</p><h2>Which player are you?</h2><p class="body-copy">This permanently links your Fairway One account to your player entry for this event. You will then score only yourself. Shared-ball team formats use your team's scorecard.</p></div><button class="modal-close" data-modal-close>×</button></div><div class="claim-player-list">${rows}</div><div class="modal-actions single"><button class="secondary-btn" data-modal-close>Cancel</button></div></section></div>`;
  bindInfoModal();
  modalRoot.querySelectorAll('[data-claim-player-id]').forEach(btn=>btn.addEventListener('click',async()=>{
    try{await claimEventPlayer(evt.cloud?.eventId||evt.id,btn.dataset.claimPlayerId);closeModal();await refreshCloud({silent:true});const refreshed=state.events.find(x=>x.cloud?.eventId===(evt.cloud?.eventId||evt.id)||x.id===evt.id);if(refreshed)state.activeEventId=refreshed.id;saveState();toast('<strong>Player linked.</strong> This is now your scorecard.');switchTab('play')}catch(err){toast(`Could not link player: ${escapeHtml(err.message||'Unknown error')}`)}
  }));
}

function openEventModal(eventId=null,forceCustom=false){const source=eventId?state.events.find(e=>e.id===eventId):null;const draft=source?structuredClone(source):{id:uid('event'),name:'',date:isoDate(),teeTime:'07:00',status:'live',eventMode:'round',ambroseMode:'single',format:forceCustom?'custom':'stableford',course:{name:'',tee:'White',holes:defaultHoles(),saveToLibrary:false},players:[{id:uid('p'),name:state.profile.name||'Golfer',hcp:Number(state.profile.hcp||0),tone:1,teamId:'team_a',avatarPath:state.profile.avatarPath||'',isSelf:true}],teams:createTeams(),scores:{},teamScores:{team_a:{},team_b:{}},playerStats:{},playerConfirmedHoles:{},playerCurrentHoles:{},teamStats:{},teamConfirmedHoles:{},teamCurrentHoles:{},trackStats:false,driveSelections:{team_a:{},team_b:{}},customSegments:forceCustom?defaultCustomSegments():[],minDrives:3,currentHole:1,confirmedHoles:[],createdAt:new Date().toISOString()};draft.eventMode ||= 'round';draft.ambroseMode ||= 'single';draft.trackStats=!!draft.trackStats;draft.playerStats ||= {};draft.teamStats ||= {};draft.course.saveToLibrary=!!draft.course.saveToLibrary;ensureTeams(draft);ensureCustomSegments(draft);ui.modal={type:'event',view:'setup',draft,editing:!!source};renderEventModal()}

function courseLibraryEntries(){
  const entries=[];
  (state.courseLibrary||[]).forEach(course=>(course.tees||[]).forEach(tee=>entries.push({course,tee,key:`${course.id}|${tee.id}`})));
  return entries.sort((a,b)=>`${a.course.name} ${a.tee.name}`.localeCompare(`${b.course.name} ${b.tee.name}`));
}
function courseLibraryKey(course){return course?.libraryCourseId&&course?.libraryTeeId?`${course.libraryCourseId}|${course.libraryTeeId}`:''}
function courseLibraryOptions(course){
  const selected=courseLibraryKey(course);
  const rows=courseLibraryEntries();
  return `<option value="" ${selected?'':'selected'}>Enter course manually</option>${rows.map(({course:c,tee,key})=>`<option value="${key}" ${selected===key?'selected':''}>${escapeHtml(c.name)} · ${escapeHtml(tee.name)}${c.verified?' · Verified':' · Community'}</option>`).join('')}`;
}
function applyCourseLibrarySelection(d,key){
  if(!key){delete d.course.libraryCourseId;delete d.course.libraryTeeId;return false}
  const entry=courseLibraryEntries().find(x=>x.key===key);if(!entry)return false;
  const {course,tee}=entry;
  d.course={name:course.name,tee:tee.name,holes:(tee.holes?.length?structuredClone(tee.holes):defaultHoles()),libraryCourseId:course.id,libraryTeeId:tee.id,saveToLibrary:false,libraryVerified:!!course.verified};
  return true;
}
function courseLibraryStatus(course){
  if(course?.libraryCourseId)return `<p class="course-library-note">${course.libraryVerified?'✓ Verified course':'Community course'} · Hole data is loaded from the Fairway One library for this round.</p>`;
  return `<label class="toggle-card course-share-toggle"><input type="checkbox" data-course-share ${course?.saveToLibrary?'checked':''}><span><strong>Share this course with Fairway One</strong><span>Once saved to cloud, other golfers can select this course and tee. You remain the owner of the course record.</span></span></label>`;
}

function tournamentFormatOptions(selected){const allowed=['stableford','stroke','par_bogey','modified_stableford'];return allowed.map(k=>`<option value="${k}" ${selected===k?'selected':''}>${escapeHtml(formatInfo(k).name)}</option>`).join('')}
function tournamentGroupPreview(d){const size=Math.max(2,Math.min(4,Number(d.groupSize||4))),groups=[];for(let i=0;i<d.players.length;i+=size)groups.push(d.players.slice(i,i+size));return groups}

function openTournamentModal(eventId=null){
  const source=eventId?state.events.find(e=>e.id===eventId):null;
  const draft=source?structuredClone(source):{
    id:uid('event'),name:'',date:isoDate(),teeTime:'07:00',status:'live',eventMode:'tournament',format:'stableford',
    course:{name:'',tee:'White',holes:defaultHoles(),saveToLibrary:false},
    players:[],teams:createTeams(),scores:{},teamScores:{team_a:{},team_b:{}},playerStats:{},playerConfirmedHoles:{},playerCurrentHoles:{},teamStats:{},teamConfirmedHoles:{},teamCurrentHoles:{},
    driveSelections:{team_a:{},team_b:{}},customSegments:[],minDrives:0,currentHole:1,confirmedHoles:[],
    groupSize:4,startType:'tee_times',groups:[],groupStartHoles:{},groupConfirmedHoles:{},groupCurrentHoles:{},
    trackStats:false,createdAt:new Date().toISOString()
  };
  draft.eventMode='tournament';
  draft.groupSize=Math.max(2,Math.min(4,Number(draft.groupSize||4)));
  draft.startType ||= 'tee_times';
  if(draft.startType==='shotgun')draft.groupSize=4;
  draft.groupStartHoles ||= {};
  (draft.groups||[]).forEach((g,i)=>draft.groupStartHoles[i+1]=Number(g.startingHole||draft.groupStartHoles[i+1]||((i%18)+1)));
  draft.trackStats=!!draft.trackStats;draft.playerStats ||= {};draft.teamStats ||= {};
  if(!['stableford','stroke','par_bogey','modified_stableford'].includes(draft.format))draft.format='stableford';
  ui.modal={type:'tournament',draft,editing:!!source};renderTournamentModal();
}
function renderTournamentModal(){
  const m=ui.modal;if(!m||m.type!=='tournament')return;const d=m.draft,groups=tournamentGroupPreview(d);
  const playerRows=d.players.map((p,i)=>`<div class="tournament-player-row"><span>${i+1}</span><input value="${escapeHtml(p.name)}" data-t-player-name="${p.id}" aria-label="Player name"><input type="number" min="-10" max="54" step="0.1" value="${p.hcp}" data-t-player-hcp="${p.id}" aria-label="Handicap"><button data-t-remove="${p.id}" ${d.players.length<=1?'disabled':''}>×</button></div>`).join('');
  const startHoleOptions=(selected)=>Array.from({length:18},(_,i)=>i+1).map(h=>`<option value="${h}" ${Number(selected)===h?'selected':''}>Hole ${h}</option>`).join('');
  const preview=groups.length?`<div class="tournament-group-preview">${groups.map((players,i)=>{
    const groupNo=i+1;
    const startHole=Math.max(1,Math.min(18,Number(d.groupStartHoles?.[groupNo]||((i%18)+1))));
    return `<article><div><strong>Group ${groupNo}</strong>${d.startType==='shotgun'?`<label class="shotgun-hole-select"><span>Starting hole</span><select data-t-start-hole="${groupNo}">${startHoleOptions(startHole)}</select></label>`:`<span>${addMinutes(d.teeTime||'07:00',i*10)}</span>`}</div><p>${players.map(p=>escapeHtml(p.name||'Player')).join(' · ')}</p></article>`;
  }).join('')}</div>`:'<div class="empty-card"><p>Add players to create groups.</p></div>';
  const courseSelected=courseLibraryKey(d.course);
  modalRoot.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-sheet tournament-sheet"><div class="modal-handle"></div><div class="modal-title-row"><div><p class="eyebrow">${m.editing?'EDIT TOURNAMENT':'TOURNAMENT MODE'}</p><h2>${m.editing?'Tournament setup':'Run a tournament'}</h2><p class="body-copy">Create a field of up to ${MAX_TOURNAMENT_PLAYERS} golfers. Fairway One splits them into scoring groups while keeping one overall leaderboard.</p></div><button class="modal-close" data-modal-close>×</button></div>
  <div class="form-section"><h3>Competition</h3><div class="form-grid"><div class="field full-span"><label>Tournament name</label><input data-t-draft="name" value="${escapeHtml(d.name)}" placeholder="Club Championship"></div><div class="field"><label>Date</label><input type="date" data-t-draft="date" value="${d.date}"></div><div class="field"><label>First tee time</label><input type="time" data-t-draft="teeTime" value="${d.teeTime}"></div><div class="field full-span"><label>Format</label><select data-t-format>${tournamentFormatOptions(d.format)}</select></div></div><label class="toggle-card stats-toggle"><input type="checkbox" data-t-track-stats ${d.trackStats?'checked':''}><span><strong>Track round stats</strong><span>Each signed-in golfer records their own putts, sand shots and penalty strokes.</span></span></label></div>
  <div class="form-section"><h3>Course</h3><div class="field full-span"><label>Fairway One course library</label><select data-t-course-library>${courseLibraryOptions(d.course)}</select></div><div class="form-grid"><div class="field full-span"><label>Course name</label><input data-t-course="name" value="${escapeHtml(d.course.name)}" placeholder="Course name" ${courseSelected?'readonly':''}></div><div class="field"><label>Tee</label><input data-t-course="tee" value="${escapeHtml(d.course.tee)}" ${courseSelected?'readonly':''}></div><div class="field"><label>Holes</label><select disabled><option>18 holes</option></select></div></div>${courseLibraryStatus(d.course)}</div>
  <div class="form-section"><div class="section-head"><div><h3>Field · ${d.players.length}/${MAX_TOURNAMENT_PLAYERS}</h3><p class="muted-note">Add golfers manually or paste a list. One player per line, optionally followed by a handicap: <strong>Jane Smith, 18.4</strong>.</p></div><button class="secondary-btn small-btn" data-t-add-player ${d.players.length>=MAX_TOURNAMENT_PLAYERS?'disabled':''}>+ Player</button></div><div class="field full-span tournament-import"><label>Paste player list</label><textarea id="tournamentImport" rows="5" placeholder="Jane Smith, 18.4&#10;Tom Jones, 11.2&#10;Alex Brown, 23"></textarea><button class="secondary-btn small-btn" data-t-import>Import list</button></div><div class="tournament-player-list">${playerRows}</div></div>
  <div class="form-section"><h3>Groups</h3><div class="form-grid"><div class="field"><label>Players per group</label><select data-t-group-size ${d.startType==='shotgun'?'disabled':''}><option value="4" ${d.groupSize===4?'selected':''}>4 players</option><option value="3" ${d.groupSize===3?'selected':''}>3 players</option><option value="2" ${d.groupSize===2?'selected':''}>2 players</option></select></div><div class="field"><label>Start type</label><select data-t-start-type><option value="tee_times" ${d.startType==='tee_times'?'selected':''}>Tee times</option><option value="shotgun" ${d.startType==='shotgun'?'selected':''}>Shotgun</option></select></div></div><div class="tournament-summary"><strong>${groups.length} scoring group${groups.length===1?'':'s'}</strong><span>${d.startType==='shotgun'?'Assign each four-ball to its own starting hole below.':'Players join with the event code, claim their name and score themselves. The leaderboard combines the full field.'}</span></div>${preview}</div>
  <div class="form-section"><h3>Hole setup</h3><div class="course-grid">${d.course.holes.map(h=>`<div class="hole-edit"><strong>Hole ${h.number}</strong><div class="tiny-grid labeled-hole-grid"><label><span>Par</span><input type="number" min="3" max="6" value="${h.par}" data-t-hole-par="${h.number}"></label><label><span>Index</span><input type="number" min="1" max="18" value="${h.si}" data-t-hole-si="${h.number}"></label></div></div>`).join('')}</div></div>
  ${m.editing?`<div class="form-section danger-zone"><h4>Danger zone</h4><p>Deletes this tournament from this device and cloud if connected.</p><button class="danger-btn small-btn" data-delete-event>Delete tournament</button></div>`:''}
  <div class="modal-actions"><button class="secondary-btn" data-modal-close>Cancel</button><button class="primary-btn gold" data-t-save>${m.editing?'Save tournament':'Create & start tournament'}</button></div></section></div>`;
  bindTournamentModal();
}
function parseTournamentImport(text){return String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(line=>{const parts=line.split(/[\t,;]/).map(x=>x.trim()).filter(Boolean);let hcp=18,name=line;if(parts.length>1&&!Number.isNaN(Number(parts[parts.length-1]))){hcp=Math.max(-10,Math.min(54,Number(parts.pop())));name=parts.join(' ')}return{name:name.trim(),hcp}}).filter(x=>x.name)}
function bindTournamentModal(){
  const d=ui.modal.draft;modalRoot.querySelectorAll('[data-modal-close]').forEach(x=>x.addEventListener('click',closeModal));modalRoot.querySelector('#modalBackdrop')?.addEventListener('click',e=>{if(e.target.id==='modalBackdrop')closeModal()});
  modalRoot.querySelectorAll('[data-t-draft]').forEach(x=>x.addEventListener('input',()=>{d[x.dataset.tDraft]=x.value;if(x.dataset.tDraft==='teeTime')renderTournamentModal()}));
  modalRoot.querySelectorAll('[data-t-course]').forEach(x=>x.addEventListener('input',()=>{d.course[x.dataset.tCourse]=x.value;delete d.course.libraryCourseId;delete d.course.libraryTeeId;d.course.libraryVerified=false}));
  modalRoot.querySelector('[data-t-course-library]')?.addEventListener('change',e=>{applyCourseLibrarySelection(d,e.target.value);renderTournamentModal()});
  modalRoot.querySelector('[data-course-share]')?.addEventListener('change',e=>d.course.saveToLibrary=!!e.target.checked);
  modalRoot.querySelector('[data-t-track-stats]')?.addEventListener('change',e=>d.trackStats=!!e.target.checked);
  modalRoot.querySelector('[data-t-format]')?.addEventListener('change',e=>{d.format=e.target.value});
  modalRoot.querySelectorAll('[data-t-player-name]').forEach(x=>x.addEventListener('input',()=>{const p=d.players.find(p=>p.id===x.dataset.tPlayerName);if(p)p.name=x.value}));
  modalRoot.querySelectorAll('[data-t-player-hcp]').forEach(x=>x.addEventListener('input',()=>{const p=d.players.find(p=>p.id===x.dataset.tPlayerHcp);if(p)p.hcp=Math.max(-10,Math.min(54,Number(x.value)||0))}));
  modalRoot.querySelector('[data-t-add-player]')?.addEventListener('click',()=>{if(d.players.length>=MAX_TOURNAMENT_PLAYERS)return;const n=d.players.length+1;d.players.push({id:uid('p'),name:`Player ${n}`,hcp:18,tone:(n%6)+1,teamId:null});renderTournamentModal()});
  modalRoot.querySelectorAll('[data-t-remove]').forEach(x=>x.addEventListener('click',()=>{if(d.players.length<=1)return;d.players=d.players.filter(p=>p.id!==x.dataset.tRemove);renderTournamentModal()}));
  modalRoot.querySelector('[data-t-import]')?.addEventListener('click',()=>{const imported=parseTournamentImport(modalRoot.querySelector('#tournamentImport')?.value);if(!imported.length)return toast('Paste at least one player name.');const room=MAX_TOURNAMENT_PLAYERS-d.players.length;imported.slice(0,room).forEach((x,i)=>d.players.push({id:uid('p'),name:x.name,hcp:x.hcp,tone:((d.players.length+i)%6)+1,teamId:null}));renderTournamentModal();toast(`${Math.min(imported.length,room)} players imported.`)});
  modalRoot.querySelector('[data-t-group-size]')?.addEventListener('change',e=>{d.groupSize=Number(e.target.value)||4;renderTournamentModal()});
  modalRoot.querySelector('[data-t-start-type]')?.addEventListener('change',e=>{d.startType=e.target.value;if(d.startType==='shotgun')d.groupSize=4;renderTournamentModal()});
  modalRoot.querySelectorAll('[data-t-start-hole]').forEach(x=>x.addEventListener('change',()=>{d.groupStartHoles ||= {};d.groupStartHoles[Number(x.dataset.tStartHole)]=Math.max(1,Math.min(18,Number(x.value)||1))}));
  modalRoot.querySelectorAll('[data-t-hole-par]').forEach(x=>x.addEventListener('input',()=>{const h=d.course.holes.find(h=>h.number===Number(x.dataset.tHolePar));if(h)h.par=Math.max(3,Math.min(6,Number(x.value)||4))}));
  modalRoot.querySelectorAll('[data-t-hole-si]').forEach(x=>x.addEventListener('input',()=>{const h=d.course.holes.find(h=>h.number===Number(x.dataset.tHoleSi));if(h)h.si=Math.max(1,Math.min(18,Number(x.value)||1))}));
  modalRoot.querySelector('[data-t-save]')?.addEventListener('click',saveTournamentDraft);modalRoot.querySelector('[data-delete-event]')?.addEventListener('click',deleteEditingEvent);
}
function saveTournamentDraft(){
  const m=ui.modal,d=m.draft;
  if(!d.name.trim())return toast('Give the tournament a name.');
  if(!d.course.name.trim())return toast('Enter a course name.');
  if(d.players.length<2||d.players.length>MAX_TOURNAMENT_PLAYERS)return toast(`Tournament mode supports 2–${MAX_TOURNAMENT_PLAYERS} players.`);
  if(d.players.some(p=>!p.name.trim()))return toast('Every player needs a name.');
  if(d.startType==='shotgun'){
    d.groupSize=4;
    const groups=tournamentGroupPreview(d);
    if(groups.length>18)return toast('A shotgun start supports a maximum of 18 four-ball groups.');
    groups.forEach((_,i)=>{d.groupStartHoles ||= {};d.groupStartHoles[i+1]=Math.max(1,Math.min(18,Number(d.groupStartHoles[i+1]||((i%18)+1))))});
  }
  d.eventMode='tournament';d.status=d.status==='complete'?'complete':'live';d.trackStats=!!d.trackStats;
  d.players.forEach((p,i)=>{p.tone=(i%6)+1;p.teamId=null});d.scores ||= {};d.playerStats ||= {};d.playerConfirmedHoles ||= {};d.playerCurrentHoles ||= {};
  d.players.forEach(p=>{d.scores[p.id] ||= {};d.playerStats[p.id] ||= {};d.playerConfirmedHoles[p.id] ||= []});
  Object.keys(d.scores).forEach(pid=>{if(!d.players.some(p=>p.id===pid))delete d.scores[pid]});
  Object.keys(d.playerStats).forEach(pid=>{if(!d.players.some(p=>p.id===pid))delete d.playerStats[pid]});
  buildTournamentGroups(d);d.confirmedHoles=[];d.currentHole=1;
  const idx=state.events.findIndex(e=>e.id===d.id);if(idx>=0)state.events[idx]=d;else state.events.unshift(d);state.activeEventId=d.id;saveState();queueCloudSync(d,{structure:true,immediate:true});closeModal();switchTab('play');toast(m.editing?'Tournament updated.':'<strong>Tournament created.</strong> Group scorecards ready.');
}

function formatOptions(selected){const groups={};standaloneFormats().forEach(([k,v])=>(groups[v.category] ||= []).push([k,v]));return `<optgroup label="Fairway One"><option value="custom" ${selected==='custom'?'selected':''}>Build Your Round · Custom</option></optgroup>`+Object.entries(groups).map(([g,items])=>`<optgroup label="${escapeHtml(g)}">${items.map(([k,v])=>`<option value="${k}" ${selected===k?'selected':''}>${escapeHtml(v.name)}</option>`).join('')}</optgroup>`).join('')}
function segmentFormatOptions(selected){return standaloneFormats().map(([k,v])=>`<option value="${k}" ${selected===k?'selected':''}>${escapeHtml(v.name)}</option>`).join('')}

function renderEventModal(){
  const m=ui.modal;if(!m||m.type!=='event')return;if(m.view==='builder')return renderCustomBuilderModal();
  const d=m.draft;ensureCustomSegments(d);ensureTeams(d);d.ambroseMode ||= 'single';
  const info=formatInfo(d.format),teamMode=eventUsesTeams(d),ambroseSingle=d.format==='ambrose'&&d.ambroseMode==='single',showTeamSelect=teamMode&&!ambroseSingle;
  const minPlayers=d.format==='custom'?1:ambroseSingle?2:d.format==='ambrose'?4:info.minPlayers;
  const maxPlayers=d.format==='custom'?8:ambroseSingle?4:info.maxPlayers;
  if(ambroseSingle)d.players.forEach(p=>p.teamId='team_a');
  const players=d.players.map((p,i)=>`<div class="player-edit-row ${showTeamSelect?'with-team':''}"><input value="${escapeHtml(p.name)}" data-player-name="${p.id}" aria-label="Player name"><input type="number" min="0" max="54" value="${p.hcp}" data-player-hcp="${p.id}" aria-label="Handicap">${showTeamSelect?`<select data-player-team="${p.id}">${d.teams.map(t=>`<option value="${t.id}" ${p.teamId===t.id?'selected':''}>${escapeHtml(t.name)}</option>`).join('')}</select>`:''}<button data-remove-player="${p.id}" ${d.players.length<=minPlayers?'disabled':''}>×</button></div>`).join('');
  const holes=d.course.holes.map(h=>`<div class="hole-edit"><strong>Hole ${h.number}</strong><div class="tiny-grid labeled-hole-grid"><label><span>Par</span><input type="number" min="3" max="6" value="${h.par}" data-hole-par="${h.number}"></label><label><span>Index</span><input type="number" min="1" max="18" value="${h.si}" data-hole-si="${h.number}"></label></div></div>`).join('');
  const anyAmbrose=d.format==='ambrose'||(d.format==='custom'&&d.customSegments.some(seg=>seg.format==='ambrose'));
  const teamsToShow=ambroseSingle?[d.teams[0]]:d.teams;
  const teamSettings=teamMode?`<div class="form-section"><h3>${ambroseSingle?'Team settings':'Teams'}</h3><div class="form-grid">${teamsToShow.map(t=>`<div class="field ${ambroseSingle?'full-span':''}"><label>${ambroseSingle?'Team handicap allowance':`${escapeHtml(t.name)} handicap allowance`}</label><input type="number" step="0.1" data-team-hcp="${t.id}" value="${Number(t.teamHcp||0)}"></div>`).join('')}${anyAmbrose?`<div class="field full-span"><label>Minimum selected drives per player</label><input type="number" min="0" max="18" data-min-drives value="${Number(d.minDrives||0)}"></div>`:''}</div><p class="course-note">Team handicap rules vary by competition. Enter the allowance being used for this event.</p></div>`:'';
  const formatBlock=d.format==='custom'?`<div class="custom-format-preview"><div><span class="guide-status build">CUSTOM BUILDER</span><strong>${d.customSegments.length} segment${d.customSegments.length===1?'':'s'} · ${customAssignedHoles(d).length}/18 holes assigned</strong><p>Mix formats across any holes. The live scorecard will switch automatically when the format changes.</p></div><button class="primary-btn gold small-btn" data-open-custom-builder>Configure holes</button></div>`:`<div class="format-preview"><span class="guide-status live">Playable now</span><strong>${escapeHtml(info.name)}</strong><p>${escapeHtml(info.description)}</p></div>`;
  const ambroseSetup=d.format==='ambrose'?`<div class="form-section ambrose-mode-block"><h3>Ambrose scoring setup</h3><div class="field full-span"><label>Who are you scoring?</label><select data-ambrose-mode><option value="single" ${d.ambroseMode==='single'?'selected':''}>One team · score ourselves</option><option value="versus" ${d.ambroseMode==='versus'?'selected':''}>Two teams · head-to-head</option></select></div><p class="course-note">Choose one team for a social 2–4 player Ambrose. Choose two teams for a 4–8 player head-to-head Ambrose. Any linked team member can enter the shared team score.</p></div>`:'';
  modalRoot.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-sheet"><div class="modal-handle"></div><div class="modal-title-row"><div><p class="eyebrow">${m.editing?'EDIT EVENT':'NEW EVENT'}</p><h2>${m.editing?'Event setup':'Build your round'}</h2><p class="body-copy">Choose one complete format or build a custom 18-hole competition.</p></div><button class="modal-close" data-modal-close>×</button></div><div class="form-section"><h3>Event</h3><div class="form-grid"><div class="field full-span"><label>Event name</label><input data-draft="name" value="${escapeHtml(d.name)}" placeholder="Sunday Golf"></div><div class="field"><label>Date</label><input type="date" data-draft="date" value="${d.date}"></div><div class="field"><label>Tee time</label><input type="time" data-draft="teeTime" value="${d.teeTime}"></div></div></div><div class="form-section"><h3>Round format</h3><div class="field full-span"><label>How do you want to play?</label><select data-format>${formatOptions(d.format)}</select></div>${formatBlock}<label class="toggle-card stats-toggle"><input type="checkbox" data-track-stats ${d.trackStats?'checked':''}><span><strong>Track round stats</strong><span>For individual formats, each signed-in golfer records their own putts, sand shots and penalties. Shared-ball formats record team stats.</span></span></label></div>${ambroseSetup}<div class="form-section"><h3>Course</h3><div class="field full-span"><label>Fairway One course library</label><select data-course-library>${courseLibraryOptions(d.course)}</select></div><div class="form-grid"><div class="field full-span"><label>Course name</label><input data-course="name" value="${escapeHtml(d.course.name)}" placeholder="Course name" ${courseLibraryKey(d.course)?'readonly':''}></div><div class="field"><label>Tee</label><input data-course="tee" value="${escapeHtml(d.course.tee)}" ${courseLibraryKey(d.course)?'readonly':''}></div><div class="field"><label>Holes</label><select disabled><option>18 holes</option></select></div></div>${courseLibraryStatus(d.course)}</div><div class="form-section"><div class="section-head"><div><h3>Players</h3><p class="muted-note">${d.format==='custom'?'1–8 players. Each custom segment is checked against its selected format before saving.':ambroseSingle?'2–4 players in one Ambrose team.':d.format==='ambrose'?'4–8 players split across two Ambrose teams.':`${info.minPlayers}–${info.maxPlayers} players for ${escapeHtml(info.name)}.`}</p></div><button class="secondary-btn small-btn" data-add-player ${d.players.length>=maxPlayers?'disabled':''}>+ Player</button></div><div class="player-editor">${players}</div></div>${teamSettings}<div class="form-section"><h3>Hole setup</h3><div class="course-grid">${holes}</div><p class="course-note">Left = par. Right = stroke index. Set the par and stroke index for each hole. Course distances can be added as the course library expands.</p></div>${m.editing?`<div class="form-section danger-zone"><h4>Danger zone</h4><p>Deletes this Fairway One event from this device and cloud if connected.</p><button class="danger-btn small-btn" data-delete-event>Delete event</button></div>`:''}<div class="modal-actions"><button class="secondary-btn" data-modal-close>Cancel</button><button class="primary-btn gold" data-save-event>${m.editing?'Save changes':'Create & start'}</button></div></section></div>`;
  bindEventModal();
}
function bindEventModal(){
  modalRoot.querySelectorAll('[data-modal-close]').forEach(x=>x.addEventListener('click',closeModal));modalRoot.querySelector('#modalBackdrop')?.addEventListener('click',e=>{if(e.target.id==='modalBackdrop')closeModal()});
  modalRoot.querySelectorAll('[data-draft]').forEach(x=>x.addEventListener('input',()=>ui.modal.draft[x.dataset.draft]=x.value));modalRoot.querySelectorAll('[data-course]').forEach(x=>x.addEventListener('input',()=>{const d=ui.modal.draft;d.course[x.dataset.course]=x.value;delete d.course.libraryCourseId;delete d.course.libraryTeeId;d.course.libraryVerified=false}));modalRoot.querySelector('[data-course-library]')?.addEventListener('change',e=>{applyCourseLibrarySelection(ui.modal.draft,e.target.value);renderEventModal()});modalRoot.querySelector('[data-course-share]')?.addEventListener('change',e=>ui.modal.draft.course.saveToLibrary=!!e.target.checked);modalRoot.querySelector('[data-track-stats]')?.addEventListener('change',e=>ui.modal.draft.trackStats=!!e.target.checked);
  modalRoot.querySelector('[data-format]')?.addEventListener('change',e=>{const d=ui.modal.draft;d.format=e.target.value;ensureCustomSegments(d);if(d.format==='ambrose'){d.ambroseMode='single';d.players=d.players.slice(0,4);d.players.forEach(p=>p.teamId='team_a');while(d.players.length<2){const n=d.players.length+1;d.players.push({id:uid('p'),name:`Player ${n}`,hcp:18,tone:n,teamId:'team_a'})}}else if(d.format!=='custom'){const info=formatInfo(d.format);while(d.players.length>info.maxPlayers)d.players.pop();while(d.players.length<info.minPlayers){const n=d.players.length+1;d.players.push({id:uid('p'),name:`Player ${n}`,hcp:18,tone:n,teamId:n%2?'team_a':'team_b'})}}renderEventModal()});
  modalRoot.querySelector('[data-ambrose-mode]')?.addEventListener('change',e=>{const d=ui.modal.draft;d.ambroseMode=e.target.value;if(d.ambroseMode==='single'){d.players=d.players.slice(0,4);d.players.forEach(p=>p.teamId='team_a');while(d.players.length<2){const n=d.players.length+1;d.players.push({id:uid('p'),name:`Player ${n}`,hcp:18,tone:n,teamId:'team_a'})}}else{while(d.players.length<4){const n=d.players.length+1;d.players.push({id:uid('p'),name:`Player ${n}`,hcp:18,tone:n,teamId:n<=2?'team_a':'team_b'})}d.players=d.players.slice(0,8);const split=Math.ceil(d.players.length/2);d.players.forEach((p,i)=>p.teamId=i<split?'team_a':'team_b')}renderEventModal()});
  modalRoot.querySelector('[data-open-custom-builder]')?.addEventListener('click',()=>{ui.modal.view='builder';renderCustomBuilderModal()});
  modalRoot.querySelectorAll('[data-player-name]').forEach(x=>x.addEventListener('input',()=>{const p=ui.modal.draft.players.find(p=>p.id===x.dataset.playerName);if(p)p.name=x.value}));modalRoot.querySelectorAll('[data-player-hcp]').forEach(x=>x.addEventListener('input',()=>{const p=ui.modal.draft.players.find(p=>p.id===x.dataset.playerHcp);if(p)p.hcp=Math.max(0,Math.min(54,Number(x.value)||0))}));modalRoot.querySelectorAll('[data-player-team]').forEach(x=>x.addEventListener('change',()=>{const p=ui.modal.draft.players.find(p=>p.id===x.dataset.playerTeam);if(p)p.teamId=x.value}));modalRoot.querySelectorAll('[data-team-hcp]').forEach(x=>x.addEventListener('input',()=>{const t=ui.modal.draft.teams.find(t=>t.id===x.dataset.teamHcp);if(t)t.teamHcp=Number(x.value)||0}));modalRoot.querySelector('[data-min-drives]')?.addEventListener('input',e=>ui.modal.draft.minDrives=Math.max(0,Math.min(18,Number(e.target.value)||0)));
  modalRoot.querySelectorAll('[data-hole-par]').forEach(x=>x.addEventListener('input',()=>{const h=ui.modal.draft.course.holes.find(h=>h.number===Number(x.dataset.holePar));if(h)h.par=Math.max(3,Math.min(6,Number(x.value)||4))}));modalRoot.querySelectorAll('[data-hole-si]').forEach(x=>x.addEventListener('input',()=>{const h=ui.modal.draft.course.holes.find(h=>h.number===Number(x.dataset.holeSi));if(h)h.si=Math.max(1,Math.min(18,Number(x.value)||1))}));
  modalRoot.querySelector('[data-add-player]')?.addEventListener('click',()=>{const d=ui.modal.draft;const max=d.format==='custom'?8:d.format==='ambrose'&&d.ambroseMode==='single'?4:formatInfo(d.format).maxPlayers;if(d.players.length>=max)return;const n=d.players.length+1,ca=d.players.filter(p=>p.teamId==='team_a').length,cb=d.players.filter(p=>p.teamId==='team_b').length;d.players.push({id:uid('p'),name:`Player ${n}`,hcp:18,tone:n,teamId:d.format==='ambrose'&&d.ambroseMode==='single'?'team_a':ca<=cb?'team_a':'team_b'});renderEventModal()});
  modalRoot.querySelectorAll('[data-remove-player]').forEach(x=>x.addEventListener('click',()=>{const d=ui.modal.draft,min=d.format==='custom'?1:d.format==='ambrose'?(d.ambroseMode==='single'?2:4):formatInfo(d.format).minPlayers;if(d.players.length<=min)return;d.players=d.players.filter(p=>p.id!==x.dataset.removePlayer);renderEventModal()}));
  modalRoot.querySelector('[data-save-event]')?.addEventListener('click',saveEventDraft);modalRoot.querySelector('[data-delete-event]')?.addEventListener('click',deleteEditingEvent);
}
function saveEventDraft(){
  const m=ui.modal,d=m.draft;ensureCustomSegments(d);const info=formatInfo(d.format);if(!d.name.trim())return toast('Give the event a name.');if(!d.course.name.trim())return toast('Enter a course name.');
  if(d.format==='custom'){const assigned=customAssignedHoles(d);if(assigned.length!==18)return toast('Assign all 18 holes before starting a custom round.');const bad=d.customSegments.find(seg=>{const f=formatInfo(seg.format);return d.players.length<f.minPlayers||d.players.length>f.maxPlayers});if(bad){const f=formatInfo(bad.format);return toast(`${escapeHtml(bad.name)} uses ${escapeHtml(f.name)}, which needs ${f.minPlayers}–${f.maxPlayers} players.`)}}
  else if(d.format==='ambrose'){if(d.ambroseMode==='single'){if(d.players.length<2||d.players.length>4)return toast('A single Ambrose team needs 2–4 players.');d.players.forEach(p=>p.teamId='team_a')}else{if(d.players.length<4||d.players.length>8)return toast('Head-to-head Ambrose needs 4–8 players.');const counts=d.teams.map(t=>d.players.filter(p=>p.teamId===t.id).length);if(counts.some(n=>n<2||n>4))return toast('Put 2–4 players in each Ambrose team.')}}
  else if(d.players.length<info.minPlayers||d.players.length>info.maxPlayers)return toast(`${info.name} needs ${info.minPlayers}–${info.maxPlayers} players here.`);
  if(d.players.some(p=>!p.name.trim()))return toast('Every player needs a name.');d.eventMode='round';d.trackStats=!!d.trackStats;d.players.forEach((p,i)=>p.tone=(i%6)+1);ensureTeams(d);d.scores ||= {};d.teamScores ||= {};d.playerStats ||= {};d.playerConfirmedHoles ||= {};d.playerCurrentHoles ||= {};d.teamStats ||= {};d.teamConfirmedHoles ||= {};d.teamCurrentHoles ||= {};d.driveSelections ||= {};d.players.forEach(p=>{d.scores[p.id] ||= {};d.playerStats[p.id] ||= {};d.playerConfirmedHoles[p.id] ||= []});Object.keys(d.scores).forEach(pid=>{if(!d.players.some(p=>p.id===pid))delete d.scores[pid]});Object.keys(d.playerStats).forEach(pid=>{if(!d.players.some(p=>p.id===pid))delete d.playerStats[pid]});d.teams.forEach(t=>{d.teamScores[t.id] ||= {};d.teamStats[t.id] ||= {};d.teamConfirmedHoles[t.id] ||= [];d.driveSelections[t.id] ||= {}});const idx=state.events.findIndex(e=>e.id===d.id);if(idx>=0)state.events[idx]=d;else state.events.unshift(d);state.activeEventId=d.id;d.status=d.status==='complete'?'complete':'live';saveState();queueCloudSync(d,{structure:true,immediate:true});closeModal();switchTab('play');toast(m.editing?'Event updated.':'<strong>Event created.</strong> Scorecard ready.');
}
function renderCustomBuilderModal(){const m=ui.modal;if(!m?.draft)return;const d=m.draft;ensureCustomSegments(d);m.view='builder';const assigned=new Map();d.customSegments.forEach((seg,i)=>(seg.holes||[]).forEach(h=>assigned.set(h,i)));const holeMap=Array.from({length:18},(_,i)=>{const h=i+1,idx=assigned.get(h),seg=idx!=null?d.customSegments[idx]:null;return `<div class="builder-hole ${idx!=null?segmentTone(idx):'unassigned'}"><strong>${h}</strong><span>${seg?escapeHtml(formatInfo(seg.format).short):'—'}</span></div>`}).join('');const segments=d.customSegments.map((seg,i)=>`<article class="builder-segment ${segmentTone(i)}"><div class="builder-segment-head"><span class="segment-dot"></span><input data-segment-name="${seg.id}" value="${escapeHtml(seg.name)}" aria-label="Segment name"><button data-remove-segment="${seg.id}" ${d.customSegments.length===1?'disabled':''}>×</button></div><div class="builder-segment-grid"><div class="field"><label>Format</label><select data-segment-format="${seg.id}">${segmentFormatOptions(seg.format)}</select></div><div class="field"><label>Competition points</label><input type="number" min="0" step="0.5" data-segment-points="${seg.id}" value="${Number(seg.points||1)}"></div></div><div class="builder-hole-picker"><p>${escapeHtml(holesLabel(seg.holes))}</p><div>${Array.from({length:18},(_,x)=>x+1).map(h=>`<button class="${seg.holes.includes(h)?'active':''}" data-segment-hole="${seg.id}" data-hole="${h}">${h}</button>`).join('')}</div></div></article>`).join('');modalRoot.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-sheet builder-sheet"><div class="modal-handle"></div><div class="modal-title-row"><div><p class="eyebrow">CUSTOM COMPETITION</p><h2>Build Your Round</h2><p class="body-copy">Create segments, choose a format, then tap the holes that belong to it. A hole can belong to one segment at a time.</p></div><button class="modal-close" data-builder-done>×</button></div><div class="builder-map"><div class="section-head"><div><h3>18-hole map</h3><p class="muted-note">${customAssignedHoles(d).length}/18 assigned</p></div><button class="secondary-btn small-btn" data-add-segment>+ Segment</button></div><div class="builder-hole-map">${holeMap}</div></div><div class="builder-segments">${segments}</div><div class="info-callout"><strong>How Fairway One scores it</strong><p>Fairway One keeps the raw hole scores underneath. When you reach a hole it applies the format assigned to that segment, including individual, team and shared-ball entry models.</p></div><div class="modal-actions"><button class="secondary-btn" data-builder-back>Back</button><button class="primary-btn gold" data-builder-done>Use this setup</button></div></section></div>`;bindCustomBuilder()}
function bindCustomBuilder(){const d=ui.modal.draft;const back=()=>{ui.modal.view='setup';renderEventModal()};modalRoot.querySelectorAll('[data-builder-back],[data-builder-done]').forEach(x=>x.addEventListener('click',back));modalRoot.querySelector('#modalBackdrop')?.addEventListener('click',e=>{if(e.target.id==='modalBackdrop')back()});modalRoot.querySelectorAll('[data-segment-name]').forEach(x=>x.addEventListener('input',()=>{const seg=d.customSegments.find(s=>s.id===x.dataset.segmentName);if(seg)seg.name=x.value}));modalRoot.querySelectorAll('[data-segment-format]').forEach(x=>x.addEventListener('change',()=>{const seg=d.customSegments.find(s=>s.id===x.dataset.segmentFormat);if(seg)seg.format=x.value;renderCustomBuilderModal()}));modalRoot.querySelectorAll('[data-segment-points]').forEach(x=>x.addEventListener('input',()=>{const seg=d.customSegments.find(s=>s.id===x.dataset.segmentPoints);if(seg)seg.points=Math.max(0,Number(x.value)||0)}));modalRoot.querySelectorAll('[data-segment-hole]').forEach(x=>x.addEventListener('click',()=>{const seg=d.customSegments.find(s=>s.id===x.dataset.segmentHole),hole=Number(x.dataset.hole);if(!seg)return;const active=seg.holes.includes(hole);d.customSegments.forEach(s=>s.holes=s.holes.filter(h=>h!==hole));if(!active)seg.holes.push(hole);d.customSegments.forEach(s=>s.holes.sort((a,b)=>a-b));renderCustomBuilderModal()}));modalRoot.querySelector('[data-add-segment]')?.addEventListener('click',()=>{if(d.customSegments.length>=18)return toast('A round can have up to 18 segments.');d.customSegments.push({id:uid('seg'),name:`Segment ${d.customSegments.length+1}`,format:'match',holes:[],points:1});renderCustomBuilderModal()});modalRoot.querySelectorAll('[data-remove-segment]').forEach(x=>x.addEventListener('click',()=>{if(d.customSegments.length===1)return;const idx=d.customSegments.findIndex(s=>s.id===x.dataset.removeSegment);if(idx<0)return;const removed=d.customSegments[idx],fallback=d.customSegments.find((_,i)=>i!==idx);fallback.holes=[...new Set([...fallback.holes,...removed.holes])].sort((a,b)=>a-b);d.customSegments.splice(idx,1);renderCustomBuilderModal()}))}

async function deleteEditingEvent(){const id=ui.modal?.draft?.id;if(!id)return;const evt=state.events.find(e=>e.id===id);if(!confirm(cloud.session&&evt?.cloud?.eventId?'Delete this event locally and from Fairway One cloud?':'Delete this Fairway One event from this browser?'))return;try{if(cloud.session&&evt?.cloud?.eventId)await deleteCloudEvent(evt)}catch(err){return toast(`Cloud delete failed: ${escapeHtml(err.message||'Unknown error')}`)}state.events=state.events.filter(e=>e.id!==id);if(state.activeEventId===id)state.activeEventId=state.events[0]?.id||null;saveState();closeModal();render();toast('Event deleted.')}

function openGameGuideModal(){const grouped={};standaloneFormats().forEach(([k,v])=>(grouped[v.category] ||= []).push([k,v]));modalRoot.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-sheet info-sheet"><div class="modal-handle"></div><div class="modal-title-row"><div><p class="eyebrow">FAIRWAY ONE GUIDE</p><h2>How to play</h2><p class="body-copy">Choose from ${STANDALONE_FORMAT_COUNT} standalone formats or create your own combination with Build Your Round.</p></div><button class="modal-close" data-modal-close>×</button></div><button class="custom-guide-hero" data-action="create-custom-event"><span>${icon('spark')}</span><div><small>FEATURED</small><strong>Build Your Round</strong><p>Assign different formats to any holes you choose.</p></div><b>→</b></button>${Object.entries(grouped).map(([cat,items])=>`<div class="guide-category"><p class="eyebrow">${escapeHtml(cat)}</p><div class="guide-stack">${items.map(([k,v],i)=>`<button class="guide-format guide-button" data-guide-format="${k}"><div class="guide-number">${String(i+1).padStart(2,'0')}</div><div><span class="guide-status live">Playable now</span><h3>${escapeHtml(v.name)}</h3><p>${escapeHtml(v.description)}</p><div class="guide-example"><strong>How it works</strong><span>${escapeHtml(v.how)}</span></div></div></button>`).join('')}</div></div>`).join('')}<div class="modal-actions single"><button class="primary-btn" data-modal-close>Done</button></div></section></div>`;bindInfoModal();modalRoot.querySelectorAll('[data-guide-format]').forEach(x=>x.addEventListener('click',()=>openSingleFormatModal(x.dataset.guideFormat)));modalRoot.querySelector('[data-action="create-custom-event"]')?.addEventListener('click',()=>{closeModal();openEventModal(null,true)})}
function openSingleFormatModal(key,backToEvent=false){const f=formatInfo(key);modalRoot.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-sheet info-sheet"><div class="modal-handle"></div><div class="modal-title-row"><div><p class="eyebrow">${escapeHtml(f.category)}</p><h2>${escapeHtml(f.name)}</h2><p class="body-copy">${escapeHtml(f.description)}</p></div><button class="modal-close" data-modal-close>×</button></div><article class="format-detail-card"><span class="guide-status live">Playable now</span><h3>How to play</h3><p>${escapeHtml(f.how)}</p><div class="format-facts"><span>Entry: <strong>${f.entry==='team'?'Team score':'Individual scores'}</strong></span><span>Players: <strong>${f.minPlayers}–${f.maxPlayers}</strong></span>${f.tracksDrive?'<span>Drive tracking: <strong>Yes</strong></span>':''}</div></article><div class="info-callout"><strong>Competition rules</strong><p>Clubs and organisers may use different handicap allowances or local conditions. Fairway One stores those event settings explicitly rather than treating one local convention as universal.</p></div><div class="modal-actions single"><button class="primary-btn" data-modal-close>${backToEvent?'Back':'Done'}</button></div></section></div>`;bindInfoModal()}
function openRulesModal(){modalRoot.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-sheet info-sheet"><div class="modal-handle"></div><div class="modal-title-row"><div><p class="eyebrow">ON-COURSE REFERENCE</p><h2>Rules of Golf</h2><p class="body-copy">A practical Fairway One summary. For a ruling, always use the official Rules and the course’s Local Rules.</p></div><button class="modal-close" data-modal-close>×</button></div><div class="rules-principles"><div><strong>1</strong><span>Play the course as you find it.</span></div><div><strong>2</strong><span>Play the ball as it lies unless a Rule allows relief.</span></div><div><strong>3</strong><span>Apply penalties honestly and protect the field.</span></div></div><div class="rules-list"><article><h3>Count every stroke</h3><p>A stroke made at the ball counts, together with any penalty strokes. Some formats alter when a player must hole out, so check the competition terms.</p></article><article><h3>Lost ball or out of bounds</h3><p>Stroke-and-distance relief is the standard procedure. If a ball may be lost outside a penalty area or out of bounds, a provisional ball can save time.</p></article><article><h3>Penalty areas</h3><p>Red and yellow penalty areas have different relief options. Relief normally adds one penalty stroke.</p></article><article><h3>Unplayable ball</h3><p>A player may declare a ball unplayable outside a penalty area and use an available relief option for one penalty stroke.</p></article><article><h3>Putting green</h3><p>You may mark, lift and clean your ball on the putting green and repair certain damage under the Rules.</p></article><article><h3>Local Rules matter</h3><p>Always check the host course’s Local Rules and Terms of Competition before play.</p></article></div><div class="official-rules-card"><span class="guide-status official">Official source</span><h3>Golf Australia</h3><p>Use Golf Australia’s current rules guidance for official information and the R&A/USGA Rules of Golf adopted for competition.</p><div class="official-links"><a href="https://www.golf.org.au/thebasicsofgolf" target="_blank" rel="noopener">Golf Australia beginner guide ↗</a><a href="https://www.golf.org.au/participationprograms" target="_blank" rel="noopener">Golf Australia rules & participation resources ↗</a></div></div><p class="rules-disclaimer">Fairway One’s quick guide is for convenience only and does not replace the official Rules, Local Rules or a Committee ruling.</p><div class="modal-actions single"><button class="primary-btn" data-modal-close>Done</button></div></section></div>`;bindInfoModal()}
function bindInfoModal(){modalRoot.querySelectorAll('[data-modal-close]').forEach(x=>x.addEventListener('click',closeModal));modalRoot.querySelector('#modalBackdrop')?.addEventListener('click',e=>{if(e.target.id==='modalBackdrop')closeModal()})}
function closeModal(){ui.modal=null;modalRoot.innerHTML=''}
function openCloudAuthModal(){modalRoot.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-sheet"><div class="modal-handle"></div><div class="modal-title-row"><div><p class="eyebrow">FAIRWAY ONE CLOUD</p><h2>Sign in or create account</h2><p class="body-copy">Sign in to keep your rounds and scores synced across your devices.</p></div><button class="modal-close" data-modal-close>×</button></div><div class="form-section"><div class="form-grid"><div class="field full-span"><label>Email</label><input id="cloudEmail" type="email" autocomplete="email" placeholder="you@example.com"></div><div class="field full-span"><label>Password</label><input id="cloudPassword" type="password" autocomplete="current-password" minlength="6" placeholder="At least 6 characters"></div></div><p class="course-note">New accounts may need email confirmation before the first sign-in, depending on the Supabase Auth setting.</p></div><div class="modal-actions"><button class="secondary-btn" id="cloudCreateAccount">Create account</button><button class="primary-btn" id="cloudSignIn">Sign in</button></div></section></div>`;bindInfoModal();
  const values=()=>({email:modalRoot.querySelector('#cloudEmail')?.value.trim(),password:modalRoot.querySelector('#cloudPassword')?.value||''});
  modalRoot.querySelector('#cloudSignIn')?.addEventListener('click',async()=>{const {email,password}=values();if(!email||password.length<6)return toast('Enter a valid email and password.');try{const data=await signIn(email,password);cloud.session=data.session;cloud.status='connected';closeModal();await syncProfile(state.profile);await refreshCloud({silent:true});toast('Signed in to Fairway One cloud.')}catch(err){toast(`Sign in failed: ${escapeHtml(err.message||'Unknown error')}`)}});
  modalRoot.querySelector('#cloudCreateAccount')?.addEventListener('click',async()=>{const {email,password}=values();if(!email||password.length<6)return toast('Enter a valid email and password of at least 6 characters.');try{const data=await signUp(email,password);if(data.session){cloud.session=data.session;cloud.status='connected';await syncProfile(state.profile);closeModal();await refreshCloud({silent:true});toast('Fairway One account created.')}else{toast('Account created. Check your email to confirm it, then sign in.')}}catch(err){toast(`Account creation failed: ${escapeHtml(err.message||'Unknown error')}`)}});
}
function openProfileModal(){
  const countries=[['AU','Australia'],['NZ','New Zealand'],['US','United States'],['CA','Canada'],['GB','United Kingdom']];
  const photo=state.profile.avatarPath?profilePhotoUrl(state.profile.avatarPath):'';
  modalRoot.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-sheet"><div class="modal-handle"></div><div class="modal-title-row"><div><p class="eyebrow">PROFILE</p><h2>Your golf profile</h2></div><button class="modal-close" data-modal-close>×</button></div><div class="profile-photo-editor"><div class="profile-photo-preview" id="profilePhotoPreview">${photo?`<img src="${escapeHtml(photo)}" alt="${escapeHtml(state.profile.name)}">`:escapeHtml(initials(state.profile.name))}</div><div><strong>Profile photo</strong><p>${cloud.session?'Shown beside your name while scoring and on leaderboards.':'Sign in to Fairway One Cloud to upload a profile photo.'}</p><label class="secondary-btn small-btn profile-photo-button ${cloud.session?'':'disabled'}">Choose photo<input id="profilePhotoInput" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" ${cloud.session?'':'disabled'}></label></div></div><div class="form-section"><div class="form-grid"><div class="field full-span"><label>Name</label><input id="profileName" value="${escapeHtml(state.profile.name)}"></div><div class="field full-span"><label>Home club</label><input id="profileClub" value="${escapeHtml(state.profile.homeClub||'')}"></div><div class="field"><label>Handicap index</label><input id="profileHcp" type="number" step="0.1" min="-10" max="54" value="${Number(state.profile.hcp||0)}"></div><div class="field"><label>Country</label><select id="profileCountry">${countries.map(([code,name])=>`<option value="${code}" ${state.profile.countryCode===code?'selected':''}>${name}</option>`).join('')}</select></div></div></div><div class="modal-actions"><button class="secondary-btn" data-modal-close>Cancel</button><button class="primary-btn" id="saveProfile">Save profile</button></div></section></div>`;
  bindInfoModal();
  modalRoot.querySelector('#profilePhotoInput')?.addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    if(file.size>5*1024*1024)return toast('Choose an image under 5 MB.');
    try{
      const uploaded=await uploadProfilePhoto(file);
      state.profile.avatarPath=uploaded.path;
      saveState();
      const preview=modalRoot.querySelector('#profilePhotoPreview');
      if(preview)preview.innerHTML=`<img src="${escapeHtml(uploaded.url)}" alt="${escapeHtml(state.profile.name)}">`;
      await syncProfile(state.profile);
      state.events.forEach(event=>(event.players||[]).forEach(p=>{if(p.isSelf||p.name===state.profile.name){p.avatarPath=state.profile.avatarPath;p.isSelf=true}}));
      saveState();
      toast('Profile photo updated.');
    }catch(err){toast(`Photo upload failed: ${escapeHtml(err.message||'Unknown error')}`)}
  });
  modalRoot.querySelector('#saveProfile').addEventListener('click',async()=>{
    const oldName=state.profile.name;
    state.profile.name=modalRoot.querySelector('#profileName').value.trim()||'Golfer';
    state.profile.homeClub=modalRoot.querySelector('#profileClub').value.trim();
    state.profile.hcp=Math.max(-10,Math.min(54,Number(modalRoot.querySelector('#profileHcp').value)||0));
    state.profile.countryCode=modalRoot.querySelector('#profileCountry').value||'AU';
    state.events.forEach(event=>(event.players||[]).forEach(p=>{if(p.isSelf||p.name===oldName){p.name=state.profile.name;p.hcp=state.profile.hcp;p.avatarPath=state.profile.avatarPath||'';p.isSelf=true}}));
    saveState();
    if(cloud.session){try{await syncProfile(state.profile)}catch(err){cloud.lastError=err}}
    closeModal();render();toast('Profile updated.');
  });
}
function resetLocalData(){if(!confirm('Clear Fairway One data stored on this device?'))return;state=initialState();ui.tab='home';ui.leaderboard='primary';saveState();render();toast('Local data cleared.')}
function exportData(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='fairway-one-rounds.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Round data exported.')}
function toast(msg){toastRoot.innerHTML=`<div class="toast">${msg}</div>`;clearTimeout(toast._timer);toast._timer=setTimeout(()=>toastRoot.innerHTML='',2300)}

navButtons.forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
render();
bootCloud();
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
