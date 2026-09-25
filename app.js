import {
  FORMAT_LIBRARY, isPickup, supportsPickup, formatInfo, handicapStrokes, scoreFor, teamScoreFor, holeNet, holeStableford,
  strokeStats, stablefordStats, parBogeyStats, modifiedStablefordStats, matchPairs, matchStatus,
  skinsStats, ensureTeams, playersForTeam, teamHoleValue, teamRoundStats, fourballMatchStatus,
  driveCounts, primaryLeaderboard, commonScoredHoles
} from './format-engine.js';
import { initCloud, onCloudAuthChange, signUp, signIn, signOut, loadProfile, syncProfile, uploadProfilePhoto, profilePhotoUrl, joinEventByCode, claimEventPlayer, submitScorecard, verifyScorecard, reopenScorecard, tournamentAdminAction, loadPublicTournament, syncEvent, deleteCloudEvent, loadCloudEvents, loadCourseLibrary, subscribeToRound, unsubscribe } from './cloud.js';
import QRCode from 'https://esm.sh/qrcode@1.5.4';

const STORAGE_KEY='fairwayOneV12';
const LEGACY_STORAGE_KEYS=['fairwayOneV11','fairwayOneV10','fairwayOneV9','fairwayOneV8','fairwayOneV7','fairwayOneV6','fairwayOnePrototypeV5','fairwayOnePrototypeV4'];
const STANDALONE_FORMAT_COUNT=Object.keys(FORMAT_LIBRARY).filter(k=>k!=='custom').length;
const MAX_TOURNAMENT_PLAYERS=72;
const app=document.getElementById('app');
const modalRoot=document.getElementById('modalRoot');
const toastRoot=document.getElementById('toastRoot');
const navButtons=[...document.querySelectorAll('.nav-item')];
const today=new Date();
let ui={tab:'home',leaderboard:'primary',modal:null,eventView:null,spectatorEvent:null};
let state=loadState();
let cloud={session:null,status:'checking',syncing:false,subscription:null,refreshTimer:null,spectatorTimer:null,lastError:null};
let pendingJoinCode=new URLSearchParams(location.search).get('join')?.trim().toUpperCase()||'';
let pendingSpectatorCode=new URLSearchParams(location.search).get('spectate')?.trim().toUpperCase()||'';
const PENDING_SYNC_KEY='fairwayOnePendingSyncV12';
let pendingSyncEventIds=new Set((()=>{try{return JSON.parse(localStorage.getItem(PENDING_SYNC_KEY)||'[]')}catch{return[]}})());

function uid(prefix='id'){return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`}
function isoDate(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))}
function signed(v){if(v==null)return '—';if(Math.abs(v)<0.0001)return 'E'; return v>0?`+${Number(v).toFixed(Number.isInteger(v)?0:1)}`:Number(v).toFixed(Number.isInteger(v)?0:1)}
function initials(name=''){return name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'P'}
function formatDate(value){if(!value)return'';return new Date(`${value}T12:00:00`).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})}

function persistPendingSync(){localStorage.setItem(PENDING_SYNC_KEY,JSON.stringify([...pendingSyncEventIds]))}
function pendingKey(event){return event?.cloud?.eventId||event?.id||''}
function markPendingSync(event){const key=pendingKey(event);if(!key)return;pendingSyncEventIds.add(key);persistPendingSync()}
function clearPendingSync(event){const key=pendingKey(event);if(!key)return;pendingSyncEventIds.delete(key);persistPendingSync()}
function hasPendingSync(){return pendingSyncEventIds.size>0}
function findPendingEvent(key){return state.events.find(e=>e.id===key||e.cloud?.eventId===key)||null}
function markPlayerScoreDirty(event,playerId,hole){event._dirtyPlayerScores ||= [];const key=`${playerId}:${Number(hole)}`;if(!event._dirtyPlayerScores.includes(key))event._dirtyPlayerScores.push(key)}
function spectatorInviteUrl(event){const code=event?.cloud?.spectatorCode||'';const base=`${location.origin}${location.pathname}`;return code?`${base}?spectate=${encodeURIComponent(code)}`:base}
function connectionBanner(){
  if(ui.spectatorEvent)return'';
  if(!navigator.onLine)return `<div class="connection-banner offline"><strong>Offline</strong><span>Scores are saved on this device and will sync when the connection returns.</span></div>`;
  if(hasPendingSync())return `<div class="connection-banner pending"><strong>Sync pending</strong><span>${pendingSyncEventIds.size} event${pendingSyncEventIds.size===1?'':'s'} waiting to reach the cloud.</span></div>`;
  if(cloud.status==='error'||cloud.status==='reconnecting')return `<div class="connection-banner warning"><strong>${cloud.status==='reconnecting'?'Reconnecting':'Cloud issue'}</strong><span>Your local scorecard is still safe.</span></div>`;
  return'';
}

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
function tournamentGroupSizes(playerCount,maxSize,startType='tee_times'){
  const n=Math.max(0,Number(playerCount||0)),cap=startType==='shotgun'?4:Math.max(2,Math.min(4,Number(maxSize||4)));
  if(!n)return[];
  if(startType!=='shotgun'&&cap===2&&n%2===1)return[];
  const groupCount=Math.max(1,Math.ceil(n/cap));
  const base=Math.floor(n/groupCount),extra=n%groupCount;
  if(base<2&&n>1)return[];
  return Array.from({length:groupCount},(_,i)=>base+(i<extra?1:0));
}
function buildTournamentGroups(event){
  const size=Math.max(2,Math.min(4,Number(event.groupSize||4))), start=event.teeTime||'07:00';
  const previousStartHoles={...(event.groupStartHoles||{})},sizes=tournamentGroupSizes((event.players||[]).length,size,event.startType);
  event.groups=[];
  let offset=0;
  sizes.forEach((groupSize,index)=>{
    const groupNo=index+1;
    const startingHole=event.startType==='shotgun'?Math.max(1,Math.min(18,Number(previousStartHoles[groupNo]||((index%18)+1)))):1;
    event.groups.push({id:uid('grp'),name:`Group ${groupNo}`,playerIds:event.players.slice(offset,offset+groupSize).map(p=>p.id),startingHole,teeTime:event.startType==='shotgun'?start:addMinutes(start,index*10)});
    offset+=groupSize;
  });
  event.groupStartHoles={};
  event.groups.forEach((g,i)=>event.groupStartHoles[i+1]=g.startingHole);
  event.activeGroupId=event.groups[0]?.id||null;
  event.groupConfirmedHoles={};event.groupCurrentHoles={};
  event.groups.forEach(g=>{event.groupConfirmedHoles[g.id]=[];event.groupCurrentHoles[g.id]=event.startType==='shotgun'?g.startingHole:1});
  return event;
}
function currentGroup(event){ensureTournamentGroups(event);return event?.eventMode==='tournament'?(event.groups.find(g=>g.id===event.activeGroupId)||event.groups[0]||null):null}
function currentScoringPlayers(event){const g=currentGroup(event);const players=g?(event.players||[]).filter(p=>g.playerIds.includes(p.id)):(event.players||[]);return event?.eventMode==='tournament'?players.filter(p=>(p.competitionStatus||'active')==='active'):players}
function selfPlayer(event){return (event?.players||[]).find(p=>p.isSelf)||null}
function playerGroup(event,playerId){if(event?.eventMode!=='tournament')return null;ensureTournamentGroups(event);return (event.groups||[]).find(g=>(g.playerIds||[]).includes(playerId))||null}
function holeCount(event){return event?.course?.holes?.length===9?9:18}
function holeOrder(start=1,count=18){return Array.from({length:count},(_,i)=>((start-1+i)%count)+1)}
function nextUnconfirmedHole(start,confirmed=[],count=18){const set=new Set((confirmed||[]).map(Number)),order=holeOrder(start,count);return order.find(h=>!set.has(h))||order[order.length-1]}
function cloudSelfMode(event,holeNo){if(!cloud.session||!event?.cloud?.synced||!selfPlayer(event))return false;const info=formatInfo(formatKeyForHole(event,Number(holeNo||event.currentHole||1)));return info.entry!=='team'}
function cloudTeamMode(event,holeNo){if(!cloud.session||!event?.cloud?.synced||!selfPlayer(event))return false;const info=formatInfo(formatKeyForHole(event,Number(holeNo||event.currentHole||1)));return info.entry==='team'}
function editableScoringPlayers(event,holeNo){if(cloudSelfMode(event,holeNo)){const me=selfPlayer(event);return me?[me]:[]}return currentScoringPlayers(event)}
function editableTeams(event,holeNo){const teams=activeTeams(event);const me=selfPlayer(event);if(cloud.session&&event?.cloud?.synced&&me?.teamId)return teams.filter(t=>t.id===me.teamId);return teams}
function playerStartHole(event,playerId){const g=playerGroup(event,playerId);return event?.eventMode==='tournament'&&event.startType==='shotgun'?(g?.startingHole||1):1}
function selfHoleConfirmed(event,player,holeNo){const h=Number(holeNo),info=formatInfo(formatKeyForHole(event,h));if(info.entry==='team'&&player?.teamId)return (event.teamConfirmedHoles?.[player.teamId]||[]).includes(h);return (event.playerConfirmedHoles?.[player?.id]||[]).includes(h)}
function selfConfirmedHoles(event,player){return Array.from({length:holeCount(event)},(_,i)=>i+1).filter(h=>selfHoleConfirmed(event,player,h))}
function selfCardComplete(event,player){return !!player&&selfConfirmedHoles(event,player).length>=holeCount(event)}
function personalCurrentHole(event,player){event.playerCurrentHoles ||= {};const start=playerStartHole(event,player.id),confirmed=selfConfirmedHoles(event,player),saved=Number(event.playerCurrentHoles[player.id]||0);if(saved>=1&&saved<=holeCount(event)&&!selfHoleConfirmed(event,player,saved))return saved;const next=nextUnconfirmedHole(start,confirmed,holeCount(event));event.playerCurrentHoles[player.id]=next;return next}
function teamStartHole(event,team){const member=playersForTeam(event,team.id)[0];return member?playerStartHole(event,member.id):1}
function personalTeamCurrentHole(event,team){event.teamCurrentHoles ||= {};const start=teamStartHole(event,team),confirmed=event.teamConfirmedHoles?.[team.id]||[];const saved=Number(event.teamCurrentHoles[team.id]||0);if(saved>=1&&saved<=holeCount(event)&&!confirmed.includes(saved))return saved;const next=nextUnconfirmedHole(start,confirmed,holeCount(event));event.teamCurrentHoles[team.id]=next;return next}
function currentHoleNo(event){const base=event?.eventMode==='tournament'?(currentGroup(event)?Math.max(1,Math.min(18,Number(event.groupCurrentHoles?.[currentGroup(event).id]||1))):1):Math.max(1,Math.min(holeCount(event),Number(event?.currentHole||1)));if(cloud.session&&event?.cloud?.synced){const me=selfPlayer(event);if(me)return personalCurrentHole(event,me)}return base}
function isCurrentHoleConfirmed(event,hole){const h=Number(hole);if(cloud.session&&event?.cloud?.synced){const me=selfPlayer(event);if(me)return selfHoleConfirmed(event,me,h)}if(event?.eventMode==='tournament'){const g=currentGroup(event);return !!g&&(event.groupConfirmedHoles?.[g.id]||[]).includes(h)}return (event?.confirmedHoles||[]).includes(h)}
function groupProgress(event,group=currentGroup(event)){if(!group)return 0;return (event.groupConfirmedHoles?.[group.id]||[]).length}
function rotateHole(hole,delta=1){return ((Number(hole||1)-1+delta)%18+18)%18+1}
function tournamentComplete(event){return event?.eventMode==='tournament'&&event.groups?.length&&event.groups.every(g=>{const active=(event.players||[]).filter(p=>g.playerIds.includes(p.id)&&(p.competitionStatus||'active')==='active');return !active.length||(event.groupConfirmedHoles?.[g.id]||[]).length>=18})}

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
  base.events.forEach(e=>{e.format ||= 'stableford';e.eventMode ||= 'round';e.ambroseMode ||= (e.format==='ambrose'&&activeTeams(e).length<=1?'single':'versus');e.advancedStats=!!e.advancedStats;e.trackStats=!!e.trackStats||e.advancedStats;e.playerStats ||= {};e.playerConfirmedHoles ||= {};e.playerCurrentHoles ||= {};e.teamStats ||= {};e.teamConfirmedHoles ||= {};e.teamCurrentHoles ||= {};e.groupStartHoles ||= {};e.scorecards ||= [];e.recentActivity ||= [];e.announcements ||= [];e.auditLog ||= [];e.registrationOpen=e.registrationOpen!==false;e.scoringLocked=!!e.scoringLocked;e.resultsPublished=!!e.resultsPublished;e.spectatorEnabled=e.spectatorEnabled!==false;e._dirtyPlayerScores ||= [];e.sideGames ||= {ntpHole:0,ntpPlayerId:null,ldHole:0,ldPlayerId:null};ensureTeams(e);ensureCustomSegments(e);ensureTournamentGroups(e)});
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
async function flushPendingSyncs(){
  if(!cloud.session||!navigator.onLine||!pendingSyncEventIds.size)return false;
  let changed=false;
  for(const key of [...pendingSyncEventIds]){
    const evt=findPendingEvent(key);
    if(!evt){pendingSyncEventIds.delete(key);changed=true;continue}
    try{await syncEvent(evt,state.profile,{structure:false});clearPendingSync(evt);changed=true}
    catch(err){cloud.lastError=err;cloud.status='error';break}
  }
  if(changed){persistPendingSync();saveState()}
  return !pendingSyncEventIds.size;
}
async function refreshCloud({silent=false}={}){
  if(!cloud.session)return;
  if(!navigator.onLine){cloud.status='reconnecting';if(!silent)toast('Offline. Your local scorecard is safe.');return render()}
  if(silent&&(cloud.syncing||hasPendingSync()))return;
  try{
    if(hasPendingSync()){const flushed=await flushPendingSyncs();if(!flushed&&hasPendingSync())return}
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
    cloud.refreshTimer=setTimeout(()=>refreshCloud({silent:true}),450);
  },evt.cloud.eventId,status=>{
    if(status==='SUBSCRIBED')cloud.status='connected';
    else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status))cloud.status='reconnecting';
    render();
  });
}
let cloudSyncTimer=null;
function queueCloudSync(event,{structure=false,immediate=false}={}){
  if(!cloud.session||!event)return;
  markPendingSync(event);
  saveState();
  clearTimeout(cloudSyncTimer);
  const run=async()=>{
    if(cloud.syncing)return;
    if(!navigator.onLine){cloud.status='reconnecting';render();return}
    cloud.syncing=true;cloud.status='connected';render();
    try{
      await syncEvent(event,state.profile,{structure});
      clearPendingSync(event);
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
async function bootSpectator(){
  document.body.classList.add('spectator-mode');
  try{ui.spectatorEvent=await loadPublicTournament(pendingSpectatorCode);render()}
  catch(err){ui.spectatorEvent={error:err.message||'Live tournament view unavailable'};render()}
  clearInterval(cloud.spectatorTimer);
  cloud.spectatorTimer=setInterval(async()=>{if(!pendingSpectatorCode||!navigator.onLine)return;try{ui.spectatorEvent=await loadPublicTournament(pendingSpectatorCode);render()}catch{}},12000);
}
async function bootCloud(){
  if(pendingSpectatorCode)return bootSpectator();
  try{
    cloud.session=await initCloud();
    cloud.status=cloud.session?'connected':'local';
    await refreshCourseLibrary({silent:true});
    if(cloud.session){await flushPendingSyncs();await refreshCloud({silent:true})}
  }catch(err){cloud.lastError=err;cloud.status='error'}
  render();
  if(pendingJoinCode)setTimeout(()=>completePendingJoin(),0);
  onCloudAuthChange(async session=>{
    const changed=cloud.session?.user?.id!==session?.user?.id;
    cloud.session=session;cloud.status=session?'connected':'local';
    if(session&&changed){await flushPendingSyncs();await refreshCloud({silent:true})}
    await refreshCourseLibrary({silent:true});
    if(!session&&cloud.subscription){await unsubscribe(cloud.subscription);cloud.subscription=null}
    render();
    if(session&&pendingJoinCode)setTimeout(()=>completePendingJoin(),0);
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
  return `<div class="recent-rounds">${rounds.map(e=>{const meta=personalCardMeta(e);return `<button class="recent-round-card" data-action="view-result" data-event-id="${e.id}"><div><span class="recent-date">${formatDate(e.date)}</span><strong>${escapeHtml(e.course?.name||e.name)}</strong><small>${escapeHtml(formatInfo(e.format).name)} · ${escapeHtml(e.course?.tee||'')}</small>${meta?`<span class="recent-card-status ${meta.key}">${escapeHtml(meta.label)}</span>`:''}</div><div class="recent-result"><b>${escapeHtml(eventResultSummary(e))}</b><span>View →</span></div></button>`}).join('')}</div>`;
}
function historicalSelf(event){
  const direct=selfPlayer(event);if(direct)return direct;
  const wanted=String(state.profile.name||'').trim().toLowerCase();
  if(!wanted)return (event?.players||[]).length===1?event.players[0]:null;
  return (event?.players||[]).find(p=>String(p.name||'').trim().toLowerCase()===wanted)||((event?.players||[]).length===1?event.players[0]:null);
}
function roundMetrics(event,player){
  if(!event||!player)return null;
  const pickupHoles=(event.course?.holes||[]).filter(h=>isPickup(scoreFor(event,player.id,h.number))).map(h=>h.number);
  const rows=(event.course?.holes||[]).map(h=>{const gross=scoreFor(event,player.id,h.number);if(gross==null||isPickup(gross))return null;return{hole:h.number,par:Number(h.par||0),gross:Number(gross),net:holeNet(event,player,h.number),pts:holeStableford(event,player,h.number)}}).filter(Boolean);
  if(!rows.length&&!pickupHoles.length)return null;
  const sum=a=>a.reduce((x,y)=>x+y,0),gross=sum(rows.map(x=>x.gross)),par=sum(rows.map(x=>x.par)),net=sum(rows.map(x=>Number(x.net??x.gross))),points=sum(rows.map(x=>Number(x.pts||0)));
  const front=rows.filter(x=>x.hole<=9),back=rows.filter(x=>x.hole>=10),stat=statTotalsFor(event.playerStats,player.id);
  let bestStretch=null;
  for(let start=1;start<=holeCount(event)-2;start++){
    const three=rows.filter(x=>x.hole>=start&&x.hole<=start+2);if(three.length!==3)continue;
    const rel=sum(three.map(x=>x.gross-x.par));
    if(!bestStretch||rel<bestStretch.rel)bestStretch={start,end:start+2,rel};
  }
  const scoreCounts={eagles:0,birdies:0,pars:0,bogeys:0,doubles:0};
  rows.forEach(x=>{const r=x.gross-x.par;if(r<=-2)scoreCounts.eagles++;else if(r===-1)scoreCounts.birdies++;else if(r===0)scoreCounts.pars++;else if(r===1)scoreCounts.bogeys++;else scoreCounts.doubles++});
  return {holes:rows.length+pickupHoles.length,pickups:pickupHoles.length,gross:pickupHoles.length?null:gross,net:pickupHoles.length?null:net,points,toPar:pickupHoles.length?null:gross-par,frontGross:pickupHoles.some(h=>h<=9)?null:front.length?sum(front.map(x=>x.gross)):null,backGross:pickupHoles.some(h=>h>9)?null:back.length?sum(back.map(x=>x.gross)):null,frontPoints:front.length?sum(front.map(x=>x.pts)):null,backPoints:back.length?sum(back.map(x=>x.pts)):null,bestStretch,scoreCounts,...stat};
}
function personalRounds(excludeEventId=null){
  return completedEvents().filter(e=>e.id!==excludeEventId).map(event=>{const player=historicalSelf(event),metrics=roundMetrics(event,player);return metrics?{event,player,metrics}:null}).filter(Boolean);
}
function courseKey(event){return `${String(event?.course?.name||'').trim().toLowerCase()}|${String(event?.course?.tee||'').trim().toLowerCase()}|${holeCount(event)}`}
function courseHistoryFor(event){
  const key=courseKey(event),rounds=personalRounds(event?.id).filter(x=>courseKey(x.event)===key);
  if(!rounds.length)return null;
  const avg=(vals)=>vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
  const gross=rounds.map(x=>x.metrics.gross).filter(x=>x!=null),pts=rounds.map(x=>x.metrics.points);
  const holeHistory={};for(let h=1;h<=holeCount(event);h++){const vals=[];rounds.forEach(x=>{const v=scoreFor(x.event,x.player.id,h);if(v!=null&&!isPickup(v))vals.push(Number(v))});if(vals.length)holeHistory[h]={last:vals[0],avg:avg(vals),best:Math.min(...vals),count:vals.length}}
  return {rounds,count:rounds.length,last:rounds[0],bestGross:gross.length?Math.min(...gross):null,avgGross:gross.length?avg(gross):null,avgPoints:avg(pts),holeHistory};
}
function allPerformanceSummary(){
  const rounds=personalRounds();if(!rounds.length)return null;const avg=vals=>vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0;
  const summaryCount=holeCount(rounds[0].event),comparable=rounds.filter(x=>holeCount(x.event)===summaryCount),gross=comparable.map(x=>x.metrics.gross).filter(x=>x!=null),points=comparable.map(x=>x.metrics.points),puttRounds=rounds.filter(x=>x.metrics.holesTracked>0);
  return {rounds,summaryCount,bestGross:gross.length?Math.min(...gross):null,avgGross:gross.length?avg(gross):null,avgPoints:avg(points),bestPoints:Math.max(...points),avgPutts:puttRounds.length?avg(puttRounds.map(x=>x.metrics.putts)):null,totalPars:rounds.reduce((n,x)=>n+x.metrics.scoreCounts.pars,0),lastFive:rounds.slice(0,5)};
}
function rivalHistory(){
  const map=new Map();
  completedEvents().forEach(event=>{
    if(eventUsesTeams(event)||event.format==='custom')return;
    const me=historicalSelf(event);if(!me)return;
    const board=primaryLeaderboard(event),myIndex=board.findIndex(x=>x.type==='player'&&x.player?.id===me.id);if(myIndex<0)return;
    (event.players||[]).filter(p=>p.id!==me.id).forEach(p=>{
      const idx=board.findIndex(x=>x.type==='player'&&x.player?.id===p.id);if(idx<0)return;
      const key=String(p.name||'').trim().toLowerCase();if(!key)return;
      const row=map.get(key)||{name:p.name,rounds:0,wins:0,losses:0,ties:0,lastDate:event.date};row.rounds++;if(myIndex<idx)row.wins++;else if(myIndex>idx)row.losses++;else row.ties++;if(String(event.date||'')>String(row.lastDate||''))row.lastDate=event.date;map.set(key,row);
    });
  });
  return [...map.values()].sort((a,b)=>b.rounds-a.rounds||b.wins-a.wins||a.name.localeCompare(b.name));
}
function achievementsFor(event,metrics){
  if(!metrics)return[];const prior=personalRounds(event.id),coursePrior=prior.filter(x=>courseKey(x.event)===courseKey(event)),out=[];
  if(metrics.holes===holeCount(event)&&!metrics.pickups&&(!coursePrior.length||metrics.gross<Math.min(...coursePrior.map(x=>x.metrics.gross).filter(x=>x!=null))))out.push({icon:'★',title:'Course best',detail:coursePrior.length?`New low round at ${event.course.name}`:`First saved round at ${event.course.name}`});
  if(!prior.length||metrics.scoreCounts.pars>Math.max(...prior.map(x=>x.metrics.scoreCounts.pars)))out.push({icon:'◆',title:'Most pars',detail:`${metrics.scoreCounts.pars} par${metrics.scoreCounts.pars===1?'':'s'} in the round`});
  const priorBack=prior.map(x=>x.metrics.backGross).filter(x=>x!=null);if(metrics.backGross!=null&&(!priorBack.length||metrics.backGross<Math.min(...priorBack)))out.push({icon:'↗',title:'Best back nine',detail:`${metrics.backGross} strokes on holes 10–18`});
  if(event.format==='stableford'){const priorPts=prior.filter(x=>x.event.format==='stableford'&&holeCount(x.event)===holeCount(event)).map(x=>x.metrics.points);if(!priorPts.length||metrics.points>Math.max(...priorPts))out.push({icon:'●',title:'Stableford best',detail:`${metrics.points} points`})}
  return out.slice(0,3);
}
function leaderboardMetric(event,entry){
  if(entry?.type!=='player')return{value:'Live',raw:0,higher:false};
  if(event.format==='stableford')return{value:`${entry.stats.points} pts`,raw:Number(entry.stats.points||0),higher:true};
  if(event.format==='stroke')return{value:signed(entry.stats.toPar),raw:Number(entry.stats.toPar||0),higher:false};
  if(event.format==='par_bogey'||event.format==='modified_stableford')return{value:signed(entry.stats.points),raw:Number(entry.stats.points||0),higher:true};
  if(event.format==='skins')return{value:`${entry.stats.skins} skins`,raw:Number(entry.stats.skins||0),higher:true};
  return{value:'Live',raw:0,higher:false};
}
function playerMomentum(event,player){
  const scored=(event.course?.holes||[]).map(h=>({h:h.number,s:scoreFor(event,player.id,h.number),p:h.par})).filter(x=>x.s!=null&&!isPickup(x.s)).slice(-3);if(!scored.length)return'—';const rel=scored.reduce((n,x)=>n+Number(x.s)-Number(x.p),0);return `${signed(rel)} last ${scored.length}`;
}
function renderPersonalPulse(event){
  const me=historicalSelf(event);if(!me||formatInfo(formatKeyForHole(event,currentHoleNo(event))).entry==='team')return'';const m=roundMetrics(event,me);if(!m)return'';
  const board=primaryLeaderboard(event),idx=board.findIndex(x=>x.type==='player'&&x.player?.id===me.id),position=idx>=0?ordinal(idx+1):'—';
  return `<section class="elite-pulse"><div><span>THROUGH</span><strong>${m.holes}</strong></div><div><span>GROSS</span><strong>${m.gross??'—'}</strong></div><div><span>POINTS</span><strong>${m.points}</strong></div><div><span>POSITION</span><strong>${position}</strong></div><div class="elite-momentum"><span>MOMENTUM</span><strong>${escapeHtml(playerMomentum(event,me))}</strong></div></section>`;
}
function renderHoleStrip(event){
  const me=historicalSelf(event),hole=currentHoleNo(event),team=me?.teamId?(event.teams||[]).find(t=>t.id===me.teamId):null;
  return `<div class="elite-hole-strip" aria-label="Jump to hole">${Array.from({length:holeCount(event)},(_,i)=>i+1).map(h=>{const hInfo=formatInfo(formatKeyForHole(event,h)),score=hInfo.entry==='team'&&team?teamScoreFor(event,team.id,h):(me?scoreFor(event,me.id,h):null),done=me?selfHoleConfirmed(event,me,h):(event.confirmedHoles||[]).includes(h);return `<button class="elite-hole-chip ${h===hole?'current':''} ${done?'done':''}" data-action="jump-hole" data-hole="${h}"><span>${h}</span><small>${score==null?'·':isPickup(score)?'P/U':score}</small></button>`}).join('')}</div>`;
}
function renderCourseMemory(event,holeNo){
  const history=courseHistoryFor(event);if(!history)return'';const h=history.holeHistory[Number(holeNo)];
  return `<section class="course-memory"><div><p class="eyebrow">COURSE MEMORY</p><strong>${history.count} previous round${history.count===1?'':'s'} here</strong></div><div class="course-memory-grid"><span><small>Last round</small><b>${history.last.metrics.gross??'—'}</b></span><span><small>Best round</small><b>${history.bestGross??'—'}</b></span><span><small>Hole ${holeNo} avg</small><b>${h?h.avg.toFixed(1):'—'}</b></span><span><small>Hole best</small><b>${h?.best??'—'}</b></span></div></section>`;
}
function splitLeader(event,start,end){
  const players=(event.players||[]).filter(p=>{for(let h=start;h<=end;h++)if(scoreFor(event,p.id,h)!=null)return true;return false});if(!players.length)return null;
  const usePoints=event.format==='stableford'||event.format==='par_bogey'||event.format==='modified_stableford';
  const rows=players.map(p=>{let value=0,holes=0;for(let h=start;h<=end;h++){const score=scoreFor(event,p.id,h);if(score==null)continue;holes++;value+=usePoints?holeStableford(event,p,h):Number(score)}return{p,value,holes}}).filter(x=>x.holes);
  if(!rows.length)return null;rows.sort((a,b)=>usePoints?b.value-a.value:a.value-b.value);const best=rows[0].value,winners=rows.filter(x=>x.value===best);return{label:winners.map(x=>x.p.name.split(' ')[0]).join(' / '),value:usePoints?`${best} pts`:`${best} gross`,holes:rows[0].holes};
}
function renderSideGames(event,holeNo){
  const sg=event.sideGames||{},h=Number(holeNo),items=[];if(Number(sg.ntpHole)===h)items.push({key:'ntp',label:'Nearest the pin',playerId:sg.ntpPlayerId});if(Number(sg.ldHole)===h)items.push({key:'ld',label:'Longest drive',playerId:sg.ldPlayerId});if(!items.length)return'';
  const canEdit=!event.cloud?.synced||event.cloud?.role==='admin';
  return `<section class="side-game-panel"><div class="side-game-head"><div><p class="eyebrow">SIDE COMPETITION</p><h3>Something extra on this hole</h3></div><span>Hole ${h}</span></div>${items.map(item=>{const leader=(event.players||[]).find(p=>p.id===item.playerId);return `<article><div><span>${escapeHtml(item.label)}</span><strong>${leader?escapeHtml(leader.name):'No leader yet'}</strong></div>${canEdit?`<div class="side-game-players">${(event.players||[]).map(p=>`<button class="${p.id===item.playerId?'active':''}" data-side-game="${item.key}" data-side-player="${p.id}">${escapeHtml(p.name.split(' ')[0])}</button>`).join('')}</div>`:`<small>Managed by the organiser</small>`}</article>`}).join('')}</section>`;
}


function renderSideGameSummary(event){
  const sg=event.sideGames||{},items=[];if(Number(sg.ntpHole)>0){const p=(event.players||[]).find(x=>x.id===sg.ntpPlayerId);items.push(`<span><small>NTP · H${Number(sg.ntpHole)}</small><strong>${p?escapeHtml(p.name.split(' ')[0]):'Open'}</strong></span>`)}if(Number(sg.ldHole)>0){const p=(event.players||[]).find(x=>x.id===sg.ldPlayerId);items.push(`<span><small>Longest · H${Number(sg.ldHole)}</small><strong>${p?escapeHtml(p.name.split(' ')[0]):'Open'}</strong></span>`)}return items.length?`<div class="side-summary">${items.join('')}</div>`:'';
}
function renderGroupRace(event){
  if(event.eventMode==='tournament'||(event.players||[]).length<2||(event.players||[]).length>4)return'';
  const board=primaryLeaderboard(event);const playerRows=board.filter(x=>x.type==='player');
  if(!playerRows.length){const match=board.find(x=>x.type==='match'||x.type==='team_match');return match?`<section class="group-race"><div class="group-race-head"><div><p class="eyebrow">LIVE GROUP COMPETITION</p><h3>${escapeHtml(match.status?.label||'Match live')}</h3></div><span class="live-pill"><i></i>Live</span></div></section>`:''}
  const leaderMetric=leaderboardMetric(event,playerRows[0]);
  const rows=playerRows.slice(0,4).map((x,i)=>{const metric=leaderboardMetric(event,x);let gap='Leader';if(i>0){const d=metric.higher?leaderMetric.raw-metric.raw:metric.raw-leaderMetric.raw;gap=d===0?'Tied':`${Math.abs(d)} ${event.format==='stableford'?'pts':'back'}`};return `<div class="group-race-row ${i===0?'leader':''}"><span class="race-pos">${i+1}</span>${avatar(x.player,true)}<div><strong>${escapeHtml(x.player.name)}</strong><small>${escapeHtml(playerMomentum(event,x.player))}</small></div><b>${escapeHtml(metric.value)}</b><em>${escapeHtml(gap)}</em></div>`}).join('');
  const front=splitLeader(event,1,9),back=holeCount(event)===18?splitLeader(event,10,18):null;return `<section class="group-race"><div class="group-race-head"><div><p class="eyebrow">LIVE GROUP COMPETITION</p><h3>Race in your pocket</h3></div><span class="live-pill"><i></i>Live</span></div><div class="group-race-list">${rows}</div>${front||back?`<div class="split-race"><span><small>Front 9</small><strong>${front?`${escapeHtml(front.label)} · ${escapeHtml(front.value)}`:'—'}</strong></span>${holeCount(event)===18?`<span><small>Back 9</small><strong>${back?`${escapeHtml(back.label)} · ${escapeHtml(back.value)}`:'—'}</strong></span>`:''}</div>`:''}${renderSideGameSummary(event)}</section>`;
}
function renderRoundRecap(event){
  if(!eventCompleteForCurrentUser(event)||event.eventMode==='tournament')return'';const me=historicalSelf(event),m=roundMetrics(event,me);if(!m)return'';const ach=achievementsFor(event,m),stat=m.holesTracked?`<div><span>Putts</span><strong>${m.putts}</strong></div><div><span>Penalties</span><strong>${m.penaltyStrokes}</strong></div>`:'';
  const advanced=event.advancedStats?`<div><span>Fairways</span><strong>${m.fairwaysTracked?`${Math.round((m.fairwaysHit/m.fairwaysTracked)*100)}%`:'—'}</strong></div><div><span>GIR</span><strong>${m.girTracked?`${Math.round((m.gir/m.girTracked)*100)}%`:'—'}</strong></div>`:'';
  return `<section class="round-recap"><div class="recap-kicker"><div><p class="eyebrow">YOUR ROUND</p><h2>${escapeHtml(event.course.name)}</h2><span>${formatDate(event.date)} · ${escapeHtml(event.course.tee||'')}</span></div><button class="secondary-btn small-btn" data-action="share-round-recap" data-event-id="${event.id}">Share round</button></div><div class="recap-score"><strong>${m.gross??'—'}</strong><div><span>GROSS</span><b>${signed(m.toPar)}</b><small>${m.net??'—'} net · ${m.points} Stableford pts</small></div></div><div class="recap-grid"><div><span>Front 9</span><strong>${m.frontGross??'—'}</strong></div>${holeCount(event)===18?`<div><span>Back 9</span><strong>${m.backGross??'—'}</strong></div>`:''}<div><span>Pars</span><strong>${m.scoreCounts.pars}</strong></div><div><span>Birdies+</span><strong>${m.scoreCounts.birdies+m.scoreCounts.eagles}</strong></div>${stat}${advanced}</div>${m.bestStretch?`<div class="recap-highlight"><span>BEST 3-HOLE STRETCH</span><strong>Holes ${m.bestStretch.start}–${m.bestStretch.end} · ${signed(m.bestStretch.rel)}</strong></div>`:''}${ach.length?`<div class="achievement-row">${ach.map(a=>`<div class="achievement"><b>${a.icon}</b><span><strong>${escapeHtml(a.title)}</strong><small>${escapeHtml(a.detail)}</small></span></div>`).join('')}</div>`:''}</section>`;
}
function renderProfilePerformance(){
  const s=allPerformanceSummary();if(!s)return `<section class="section"><div class="section-head"><div><p class="eyebrow">PERFORMANCE</p><h3>Your golf, remembered.</h3></div></div><div class="empty-card"><h3>No performance history yet.</h3><p>Complete a round and Fairway One will start building your personal golf profile.</p></div></section>`;
  const form=s.lastFive.map(x=>`<span title="${escapeHtml(x.event.course.name)}"><b>${x.metrics.gross??'—'}</b><small>${x.metrics.points} pts</small></span>`).join(''),par=parPerformanceSummary();
  const parValue=v=>v==null?'—':signed(v);
  return `<section class="section elite-performance"><div class="section-head"><div><p class="eyebrow">PERFORMANCE</p><h3>Your game at a glance</h3><small>${s.summaryCount}-hole scoring averages</small></div><span>${s.rounds.length} saved rounds</span></div><div class="performance-grid"><article><span>Best gross</span><strong>${s.bestGross??'—'}</strong></article><article><span>Avg gross</span><strong>${s.avgGross==null?'—':s.avgGross.toFixed(1)}</strong></article><article><span>Avg Stableford</span><strong>${s.avgPoints.toFixed(1)}</strong></article><article><span>Best points</span><strong>${s.bestPoints}</strong></article><article><span>Avg putts</span><strong>${s.avgPutts==null?'—':s.avgPutts.toFixed(1)}</strong></article><article><span>Total pars</span><strong>${s.totalPars}</strong></article></div><div class="par-profile"><span><small>Par 3 avg</small><b>${parValue(par.p3)}</b></span><span><small>Par 4 avg</small><b>${parValue(par.p4)}</b></span><span><small>Par 5 avg</small><b>${parValue(par.p5)}</b></span><span><small>Points on shot holes</small><b>${par.shotPts==null?'—':par.shotPts.toFixed(1)}</b></span></div>${renderHandicapTrend()}<div class="form-strip"><span>RECENT FORM</span><div>${form}</div></div></section>`;
}


function parPerformanceSummary(){
  const buckets={3:[],4:[],5:[]},shotPts=[],noShotPts=[];personalRounds().forEach(({event,player})=>{(event.course?.holes||[]).forEach(h=>{const score=scoreFor(event,player.id,h.number);if(score==null)return;const par=Number(h.par);if(!isPickup(score)&&buckets[par])buckets[par].push(Number(score)-par);const pts=holeStableford(event,player,h.number);(handicapStrokes(player.hcp,h.si,holeCount(event))>0?shotPts:noShotPts).push(Number(pts||0))})});
  const avg=arr=>arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:null;return{p3:avg(buckets[3]),p4:avg(buckets[4]),p5:avg(buckets[5]),shotPts:avg(shotPts),noShotPts:avg(noShotPts)};
}
function renderHandicapTrend(){
  const rounds=personalRounds().slice(0,10).reverse();if(rounds.length<2)return'';const values=rounds.map(x=>Number(x.player.hcp||0)),min=Math.min(...values),max=Math.max(...values),span=Math.max(1,max-min),pts=values.map((v,i)=>`${12+(i/(values.length-1))*296},${74-((v-min)/span)*52}`).join(' '),latest=values[values.length-1],first=values[0];
  return `<div class="hcp-trend"><div><span>HANDICAP TREND</span><strong>${latest.toFixed(1)}</strong><small>${latest<first?'Trending down':latest>first?'Trending up':'Holding steady'} · last ${values.length} rounds</small></div><svg viewBox="0 0 320 86" role="img" aria-label="Handicap trend"><line x1="12" y1="74" x2="308" y2="74"></line><polyline points="${pts}"></polyline>${values.map((v,i)=>`<circle cx="${12+(i/(values.length-1))*296}" cy="${74-((v-min)/span)*52}" r="3"></circle>`).join('')}</svg></div>`;
}
function renderCourseRecords(){
  const groups=new Map();personalRounds().forEach(x=>{const key=courseKey(x.event),row=groups.get(key)||{name:x.event.course?.name||'Course',tee:x.event.course?.tee||'',holeCount:holeCount(x.event),rounds:[],lastDate:x.event.date};row.rounds.push(x);if(String(x.event.date||'')>String(row.lastDate||''))row.lastDate=x.event.date;groups.set(key,row)});
  const rows=[...groups.values()].sort((a,b)=>b.rounds.length-a.rounds.length||String(b.lastDate).localeCompare(String(a.lastDate))).slice(0,6);if(!rows.length)return'';
  return `<section class="section course-records"><div class="section-head"><div><p class="eyebrow">COURSE HISTORY</p><h3>Your course records</h3></div></div><div class="course-record-list">${rows.map(r=>{const gross=r.rounds.map(x=>x.metrics.gross).filter(x=>x!=null),pts=r.rounds.map(x=>x.metrics.points),avg=gross.reduce((a,b)=>a+b,0)/gross.length;return `<article><div><strong>${escapeHtml(r.name)}</strong><small>${escapeHtml(r.tee)} · ${r.holeCount} holes · ${r.rounds.length} round${r.rounds.length===1?'':'s'}</small></div><span><small>Best</small><b>${gross.length?Math.min(...gross):'—'}</b></span><span><small>Avg</small><b>${gross.length?avg.toFixed(1):'—'}</b></span><span><small>Pts</small><b>${(pts.reduce((a,b)=>a+b,0)/pts.length).toFixed(1)}</b></span></article>`}).join('')}</div></section>`;
}
function renderRivals(){
  const rivals=rivalHistory().slice(0,5);if(!rivals.length)return'';
  return `<section class="section rivals-section"><div class="section-head"><div><p class="eyebrow">HEAD TO HEAD</p><h3>Your regular rivals</h3></div></div><div class="rival-list">${rivals.map(r=>`<article><div class="rival-avatar">${escapeHtml(initials(r.name))}</div><div><strong>${escapeHtml(r.name)}</strong><small>${r.rounds} round${r.rounds===1?'':'s'} together</small></div><span><b>${r.wins}</b> W · ${r.ties} T · ${r.losses} L</span></article>`).join('')}</div></section>`;
}

async function shareRoundRecap(event){
  const me=historicalSelf(event),m=roundMetrics(event,me);if(!m)return toast('No personal round data is available to share yet.');
  const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1350;const ctx=canvas.getContext('2d');
  const green='#0f2f27',cream='#f6f0e2',gold='#c9a95f',soft='#d8d1c1';
  ctx.fillStyle=green;ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle=gold;ctx.fillRect(72,78,8,1194);
  ctx.fillStyle=cream;ctx.font='700 42px Georgia, serif';ctx.fillText('FAIRWAY ONE',112,140);
  ctx.fillStyle=gold;ctx.font='600 22px Arial, sans-serif';ctx.fillText('PLAY  •  SCORE  •  COMPETE',112,182);
  ctx.fillStyle=cream;ctx.font='700 72px Georgia, serif';ctx.fillText(event.course.name||'Round recap',112,300);
  ctx.fillStyle=soft;ctx.font='400 28px Arial, sans-serif';ctx.fillText(`${formatDate(event.date)}  ·  ${event.course.tee||'Tee'}  ·  ${formatInfo(event.format).name}`,112,350);
  ctx.fillStyle=gold;ctx.font='700 220px Georgia, serif';ctx.fillText(String(m.gross??'—'),104,620);
  ctx.fillStyle=cream;ctx.font='700 30px Arial, sans-serif';ctx.fillText('GROSS',118,670);
  ctx.fillStyle=soft;ctx.font='500 30px Arial, sans-serif';ctx.fillText(`${signed(m.toPar)}  ·  ${m.net??'—'} net  ·  ${m.points} Stableford pts`,118,720);
  const cells=[['FRONT 9',m.frontGross??'—'],...(holeCount(event)===18?[['BACK 9',m.backGross??'—']]:[]),['PARS',m.scoreCounts.pars],['BIRDIES+',m.scoreCounts.birdies+m.scoreCounts.eagles],['PUTTS',m.holesTracked?m.putts:'—'],['PENALTIES',m.holesTracked?m.penaltyStrokes:'—']];
  cells.forEach((cell,i)=>{const col=i%3,row=Math.floor(i/3),x=112+col*300,y=835+row*170;ctx.fillStyle='rgba(246,240,226,.08)';ctx.fillRect(x,y,260,132);ctx.fillStyle=gold;ctx.font='600 18px Arial, sans-serif';ctx.fillText(cell[0],x+20,y+34);ctx.fillStyle=cream;ctx.font='700 52px Georgia, serif';ctx.fillText(String(cell[1]),x+20,y+94)});
  if(m.bestStretch){ctx.fillStyle=gold;ctx.font='600 20px Arial, sans-serif';ctx.fillText('BEST 3-HOLE STRETCH',112,1198);ctx.fillStyle=cream;ctx.font='700 34px Arial, sans-serif';ctx.fillText(`Holes ${m.bestStretch.start}–${m.bestStretch.end}  ·  ${signed(m.bestStretch.rel)}`,112,1243)}
  ctx.fillStyle=soft;ctx.font='400 20px Arial, sans-serif';ctx.fillText('Scored with Fairway One',760,1270);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png',1));if(!blob)return toast('Could not create the share card.');
  const safe=String(event.course.name||'round').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase();const file=new File([blob],`fairway-one-${safe||'round'}.png`,{type:'image/png'});
  try{if(navigator.share&&navigator.canShare?.({files:[file]})){await navigator.share({title:'Fairway One round',text:`${event.course.name} · ${m.gross??'—'} gross · ${m.points} points`,files:[file]});return}}
  catch(err){if(err?.name==='AbortError')return}
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=file.name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('<strong>Round card created.</strong>');
}

function eventProgress(event){const me=selfPlayer(event);if(event?.cloud?.synced&&me)return selfConfirmedHoles(event,me).length;if(event?.eventMode==='tournament'){const total=(event.groups||[]).length*18,done=(event.groups||[]).reduce((n,g)=>n+(event.groupConfirmedHoles?.[g.id]||[]).length,0);return total?Math.round((done/total)*18):0}return event?.format==='custom'?[...new Set(event.confirmedHoles||[])].length:commonScoredHoles(event).length}
function standaloneFormats(){return Object.entries(FORMAT_LIBRARY).filter(([k])=>k!=='custom')}
function defaultCustomSegments(count=18){return [{id:uid('seg'),name:'Segment 1',format:'stableford',holes:Array.from({length:count},(_,i)=>i+1),points:1}]}
function ensureCustomSegments(event){if(!event)return event;if(event.format!=='custom'){event.customSegments ||= [];return event}if(!Array.isArray(event.customSegments)||!event.customSegments.length)event.customSegments=defaultCustomSegments(holeCount(event));event.customSegments.forEach((seg,i)=>{seg.id ||= uid('seg');seg.name ||= `Segment ${i+1}`;if(!FORMAT_LIBRARY[seg.format]||seg.format==='custom')seg.format='stableford';seg.holes=[...new Set((seg.holes||[]).map(Number).filter(h=>h>=1&&h<=holeCount(event)))].sort((a,b)=>a-b);seg.points=Number(seg.points??1)});return event}
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

function cloudPlayerId(event,localId){return event?.cloud?.playerIds?.[localId]||localId}
function cloudTeamId(event,localId){return event?.cloud?.teamIds?.[localId]||localId}
function playerForCloudId(event,id){return (event?.players||[]).find(p=>cloudPlayerId(event,p.id)===id||p.id===id)||null}
function teamForCloudId(event,id){return (event?.teams||[]).find(t=>cloudTeamId(event,t.id)===id||t.id===id)||null}
function cardForPlayer(event,player){if(!player)return null;const id=cloudPlayerId(event,player.id);return (event?.scorecards||[]).find(c=>c.scope==='player'&&c.playerId===id)||null}
function cardForTeam(event,team){if(!team)return null;const id=cloudTeamId(event,team.id);return (event?.scorecards||[]).find(c=>c.scope==='team'&&c.teamId===id)||null}
function scorecardEntryLocked(event,type,id){
  if(!event?.cloud?.synced)return false;
  if(type==='team'){const team=(event.teams||[]).find(t=>t.id===id);return cardForTeam(event,team)?.status==='final'}
  const player=(event.players||[]).find(p=>p.id===id),status=cardForPlayer(event,player)?.status;return status==='awaiting_verification'||status==='final'
}
function cardStatusMeta(card,complete=false,count=18){
  if(card?.status==='final')return{key:'final',label:'SIGNED · FINAL',detail:'Scorecard verified and locked'};
  if(card?.status==='awaiting_verification')return{key:'awaiting',label:'AWAITING VERIFICATION',detail:'Submitted to your marker'};
  if(complete)return{key:'finished',label:'READY TO SUBMIT',detail:`${count} holes confirmed`};
  return{key:'playing',label:'PLAYING',detail:'Scorecard in progress'};
}
function eventInviteUrl(event){const code=event?.cloud?.joinCode||'';const base=`${location.origin}${location.pathname}`;return code?`${base}?join=${encodeURIComponent(code)}`:base}
function markerCandidates(event,player){
  if(!player)return[];
  const group=playerGroup(event,player.id);const source=group?(event.players||[]).filter(p=>group.playerIds.includes(p.id)):(event.players||[]);
  return source.filter(p=>p.id!==player.id&&p.userId);
}
function cardsToVerify(event){
  const awaiting=(event?.scorecards||[]).filter(c=>c.scope==='player'&&c.status==='awaiting_verification');
  if(event?.cloud?.role==='admin')return awaiting;
  const me=selfPlayer(event);if(!me)return[];const myCloudId=cloudPlayerId(event,me.id);
  return awaiting.filter(c=>c.playerId!==myCloudId&&(!c.markerPlayerId||c.markerPlayerId===myCloudId)).filter(c=>{const subject=playerForCloudId(event,c.playerId);if(!subject)return false;const g=playerGroup(event,subject.id);return !g||g.playerIds.includes(me.id)})
}
function finalCardsForAdmin(event){return event?.cloud?.role==='admin'?(event.scorecards||[]).filter(c=>c.status==='final').sort((a,b)=>new Date(b.verifiedAt||b.updatedAt||0)-new Date(a.verifiedAt||a.updatedAt||0)).slice(0,8):[]}
function personalCardMeta(event){
  const me=selfPlayer(event);if(!me||!event?.cloud?.synced)return null;
  const info=formatInfo(event.format),team=me.teamId?(event.teams||[]).find(t=>t.id===me.teamId):null,shared=event.format!=='custom'&&info.entry==='team';
  const card=shared&&team?cardForTeam(event,team):cardForPlayer(event,me);
  const complete=shared&&team?(event.teamConfirmedHoles?.[team.id]||[]).length>=holeCount(event):selfCardComplete(event,me);
  return cardStatusMeta(card,complete,holeCount(event))
}
function playerProgress(event,player){return (event?.playerConfirmedHoles?.[player?.id]||[]).length}
function competitionStatusMeta(status='active'){
  const map={active:{label:'Active',short:'ACTIVE'},withdrawn:{label:'Withdrawn',short:'WD'},disqualified:{label:'Disqualified',short:'DQ'},no_show:{label:'No show',short:'NS'}};
  return map[status]||map.active;
}
function tournamentStatusCounts(event){
  const counts={notStarted:0,playing:0,finished:0,awaiting:0,final:0,withdrawn:0,disqualified:0,noShow:0};
  (event.players||[]).forEach(p=>{
    const competition=p.competitionStatus||'active';
    if(competition!=='active'){
      if(competition==='withdrawn')counts.withdrawn++;else if(competition==='disqualified')counts.disqualified++;else if(competition==='no_show')counts.noShow++;
      return;
    }
    const card=cardForPlayer(event,p);if(card?.status==='final')counts.final++;else if(card?.status==='awaiting_verification')counts.awaiting++;else{const n=playerProgress(event,p);if(n>=18)counts.finished++;else if(n>0)counts.playing++;else counts.notStarted++}
  });return counts
}
function timeAgo(value){if(!value)return'';const ms=Date.now()-new Date(value).getTime();if(!Number.isFinite(ms))return'';const m=Math.max(0,Math.round(ms/60000));if(m<1)return'just now';if(m<60)return`${m}m ago`;const h=Math.round(m/60);if(h<24)return`${h}h ago`;return new Date(value).toLocaleDateString('en-AU',{day:'numeric',month:'short'})}
function tournamentPreflight(event){
  ensureTournamentGroups(event);
  const players=event.players||[],active=players.filter(p=>(p.competitionStatus||'active')==='active'),groups=event.groups||[],holes=event.course?.holes||[];
  const sis=holes.map(h=>Number(h.si)),validIndexes=holes.length===18&&sis.every(x=>Number.isInteger(x)&&x>=1&&x<=18)&&new Set(sis).size===18;
  const assigned=new Map();groups.forEach(g=>(g.playerIds||[]).forEach(pid=>assigned.set(pid,(assigned.get(pid)||0)+1)));
  const activeAssigned=active.every(p=>assigned.get(p.id)===1),validGroups=groups.length>0&&groups.every(g=>{const activeInGroup=(g.playerIds||[]).filter(pid=>active.some(p=>p.id===pid)).length;return activeInGroup===0||(activeInGroup>=2&&activeInGroup<=4)});
  const shotgunStarts=groups.map(g=>Number(g.startingHole||1)),shotgunValid=event.startType!=='shotgun'||(groups.length<=18&&new Set(shotgunStarts).size===groups.length&&shotgunStarts.every(h=>h>=1&&h<=18));
  const uniqueNames=new Set(players.map(p=>String(p.name||'').trim().toLowerCase())).size===players.length;
  const joined=active.filter(p=>p.userId||p.claimed).length;
  const checks=[
    {key:'course',label:'Course & indexes',ok:validIndexes,detail:validIndexes?'18 holes · unique SI 1–18':'Check all 18 pars and use each stroke index 1–18 once'},
    {key:'field',label:'Field',ok:active.length>=2&&players.length<=MAX_TOURNAMENT_PLAYERS&&uniqueNames,detail:uniqueNames?`${active.length} active · ${players.length} total`:'Duplicate player display names need to be made distinct'},
    {key:'groups',label:'Scoring groups',ok:activeAssigned&&validGroups&&shotgunValid,detail:shotgunValid?(activeAssigned&&validGroups?`${groups.length} valid group${groups.length===1?'':'s'}`:'Every active golfer must be in one 2–4 player group'):'Shotgun starting holes must be unique'},
    {key:'cloud',label:'Cloud event',ok:!!event.cloud?.synced&&!!event.cloud?.eventId&&!!event.cloud?.joinCode,detail:event.cloud?.joinCode?`Join code ${event.cloud.joinCode}`:'Sync the tournament before inviting players'},
    {key:'players',label:'Player accounts',ok:joined===active.length,warning:true,detail:`${joined}/${active.length} active golfers linked`},
    {key:'connection',label:'Event-day connection',ok:navigator.onLine&&!hasPendingSync()&&cloud.status!=='error',warning:true,detail:!navigator.onLine?'This device is offline':hasPendingSync()?'Local changes are still waiting to sync':'Cloud connection clear'}
  ];
  const required=checks.filter(c=>!c.warning),ready=required.every(c=>c.ok);
  return {checks,ready,requiredIssues:required.filter(c=>!c.ok).length,warnings:checks.filter(c=>c.warning&&!c.ok).length};
}
function tournamentReadiness(event){
  const counts=tournamentStatusCounts(event),players=event.players||[],active=players.filter(p=>(p.competitionStatus||'active')==='active'),joined=active.filter(p=>p.userId||p.claimed).length;
  const scored=active.filter(p=>playerProgress(event,p)>=18).length,exceptions=players.length-active.length,preflight=tournamentPreflight(event);
  return {counts,total:players.length,activeTotal:active.length,joined,unjoined:active.length-joined,scored,exceptions,allScored:active.length>0&&scored===active.length,awaiting:counts.awaiting,final:counts.final,preflight};
}
function renderTournamentPreflight(event){
  const pf=tournamentPreflight(event),label=pf.ready?(pf.warnings?'READY · CHECK WARNINGS':'READY FOR PLAY'):`${pf.requiredIssues} SETUP ISSUE${pf.requiredIssues===1?'':'S'}`;
  return `<details class="ops-preflight" ${event.status==='draft'?'open':''}><summary><span><b>Event-day preflight</b><small>Course, groups, cloud and player readiness</small></span><strong class="${pf.ready?'ready':'issue'}">${label}</strong></summary><div class="preflight-list">${pf.checks.map(c=>`<div class="preflight-row ${c.ok?'ok':c.warning?'warn':'fail'}"><span>${c.ok?'✓':c.warning?'!':'×'}</span><div><strong>${escapeHtml(c.label)}</strong><small>${escapeHtml(c.detail)}</small></div></div>`).join('')}</div></details>`;
}
function renderAnnouncements(event,{compact=false}={}){
  const items=(event?.announcements||[]).slice(0,compact?2:5);if(!items.length)return'';
  return `<section class="event-announcements ${compact?'compact':''}"><div class="section-head"><div><p class="eyebrow">TOURNAMENT DESK</p><h3>Announcements</h3></div><span>${items.length}</span></div>${items.map(a=>`<article class="announcement ${a.kind==='important'?'important':''}"><div><strong>${a.kind==='important'?'Important update':'Event update'}</strong><p>${escapeHtml(a.message)}</p></div><small>${escapeHtml(timeAgo(a.createdAt))}</small>${event.cloud?.role==='admin'?`<button class="announcement-delete" data-action="delete-announcement" data-announcement-id="${a.id}" data-event-id="${event.id}" aria-label="Delete announcement">×</button>`:''}</article>`).join('')}</section>`;
}
function auditActionLabel(action=''){const labels={event_join:'Player joined',player_claim:'Player claimed entry',player_claim_released:'Player claim released',player_status_changed:'Player tournament status changed',scorecard_submitted:'Card submitted',scorecard_verified:'Card verified',scorecard_reopened:'Card reopened',official_score_override:'Official score correction',registration_opened:'Registration opened',registration_closed:'Registration closed',scoring_locked:'Scoring locked',scoring_unlocked:'Scoring unlocked',announcement_posted:'Announcement posted',announcement_deleted:'Announcement removed',results_published:'Results published',results_reopened:'Tournament reopened',spectator_enabled:'Spectator view enabled',spectator_disabled:'Spectator view disabled',spectator_code_rotated:'Spectator link rotated',organiser_card_finalized:'Card finalized by organiser'};return labels[action]||String(action||'Event action').replaceAll('_',' ')}
function renderTournamentExceptions(event){
  const players=(event.players||[]).filter(p=>(p.competitionStatus||'active')!=='active');if(!players.length)return'';
  return `<div class="tournament-exceptions"><strong>Field status</strong>${players.map(p=>{const meta=competitionStatusMeta(p.competitionStatus);return `<span><b>${escapeHtml(meta.short)}</b>${escapeHtml(p.name)}</span>`}).join('')}</div>`;
}
function renderTournamentRoster(event){
  const groups=event.groups||[];
  return `<div class="ops-roster">${groups.map(g=>{const players=(event.players||[]).filter(p=>g.playerIds.includes(p.id));return `<article class="ops-group"><div class="ops-group-head"><div><strong>${escapeHtml(g.name)}</strong><span>${escapeHtml(g.teeTime||'')}${event.startType==='shotgun'?` · Hole ${g.startingHole}`:''}</span></div><small>${g.lastActivityAt?`Active ${escapeHtml(timeAgo(g.lastActivityAt))}`:(g.status==='completed'?'Finished':'No scoring yet')}</small></div>${players.map(p=>{const card=cardForPlayer(event,p),progress=playerProgress(event,p),joined=!!p.userId,competition=p.competitionStatus||'active',meta=competitionStatusMeta(competition);const stateLabel=competition!=='active'?meta.label:card?.status==='final'?'Final':card?.status==='awaiting_verification'?'Verify':progress>=18?'Finished':progress?`${progress}/18`:'Ready';return `<div class="ops-player-row ${competition!=='active'?'inactive':''}">${avatar(p,true)}<div><strong>${escapeHtml(p.name)}</strong><small>${joined?'Account linked':'Not joined'} · ${escapeHtml(stateLabel)}</small></div><span class="ops-state ${competition!=='active'?competition:(card?.status||(!joined?'unjoined':progress?'playing':'ready'))}">${competition!=='active'?escapeHtml(meta.short):(joined?'●':'○')}</span><div class="ops-row-actions"><button class="ghost-btn tiny-btn" data-action="player-status" data-player-id="${p.id}" data-event-id="${event.id}">Status</button>${competition==='active'&&progress>=18&&!card?`<button class="ghost-btn tiny-btn finalize" data-action="finalize-player-card" data-player-id="${p.id}" data-event-id="${event.id}">Finalize</button>`:''}${joined?`<button class="ghost-btn tiny-btn" data-action="release-claim" data-player-id="${p.id}" data-event-id="${event.id}">Release</button>`:''}</div></div>`}).join('')}</article>`}).join('')}</div>`;
}
function renderOrganizerConsole(event){
  if(event.cloud?.role!=='admin')return'';const r=tournamentReadiness(event),published=!!event.resultsPublished;
  const audit=(event.auditLog||[]).slice(0,14).map(a=>`<div class="audit-row"><span></span><div><strong>${escapeHtml(auditActionLabel(a.action))}</strong><small>${a.reason?`${escapeHtml(a.reason)} · `:''}${escapeHtml(timeAgo(a.createdAt))}</small></div></div>`).join('')||'<div class="centre-empty">Operational actions will appear here.</div>';
  return `<section class="organiser-console"><div class="console-title"><div><p class="eyebrow">TOURNAMENT CONTROL</p><h2>Organiser command centre</h2></div><span class="ops-health ${event.scoringLocked?'locked':event.status==='draft'?'setup':'ready'}">${event.scoringLocked?'SCORING LOCKED':event.status==='draft'?'SETUP':'SYSTEM LIVE'}</span></div>${renderTournamentPreflight(event)}<div class="readiness-grid"><article><span>Field</span><strong>${r.joined}/${r.activeTotal}</strong><small>active accounts linked</small></article><article><span>Cards</span><strong>${r.scored}/${r.activeTotal}</strong><small>active cards complete</small></article><article><span>Verify</span><strong>${r.awaiting}</strong><small>awaiting marker</small></article><article><span>Final</span><strong>${r.final}</strong><small>signed active cards</small></article></div><div class="ops-actions"><button class="secondary-btn" data-action="share-event" data-event-id="${event.id}">Player invite</button><button class="secondary-btn" data-action="share-spectator" data-event-id="${event.id}">Spectator link</button><button class="secondary-btn" data-action="post-announcement" data-event-id="${event.id}">Announcement</button><button class="secondary-btn" data-action="score-override" data-event-id="${event.id}">Official correction</button><button class="secondary-btn" data-action="toggle-registration" data-event-id="${event.id}" data-open="${event.registrationOpen?'0':'1'}">${event.registrationOpen?'Close registration':'Open registration'}</button><button class="secondary-btn ${event.scoringLocked?'':'danger-outline'}" data-action="toggle-scoring" data-event-id="${event.id}" data-locked="${event.scoringLocked?'0':'1'}">${event.scoringLocked?'Unlock scoring':'Lock scoring'}</button><button class="secondary-btn" data-action="export-tournament" data-event-id="${event.id}">Export results CSV</button><button class="primary-btn gold" data-action="${published?'reopen-results':'publish-results'}" data-event-id="${event.id}">${published?'Reopen tournament':'Publish final results'}</button></div><div class="ops-status-line"><span class="${event.registrationOpen?'on':''}">Registration ${event.registrationOpen?'open':'closed'}</span><span class="${event.spectatorEnabled?'on':''}">Spectator ${event.spectatorEnabled?'live':'off'}</span><span class="${event.resultsPublished?'on':''}">Results ${event.resultsPublished?'published':'live'}</span>${r.exceptions?`<span class="exception">${r.exceptions} field exception${r.exceptions===1?'':'s'}</span>`:''}</div><details class="ops-roster-details" open><summary>Field & account readiness</summary>${renderTournamentRoster(event)}</details><details class="ops-audit"><summary>Audit trail · ${(event.auditLog||[]).length} recent actions</summary><div>${audit}</div></details></section>`;
}
function renderTournamentCentre(event){
  if(event?.eventMode!=='tournament')return'';
  ensureTournamentGroups(event);const counts=tournamentStatusCounts(event);
  const groups=(event.groups||[]).map(g=>{const progress=(event.groupConfirmedHoles?.[g.id]||[]).length;const status=progress>=18?'Finished':progress>0?'On course':'Not started';const players=(event.players||[]).filter(p=>g.playerIds.includes(p.id));return `<article class="centre-group"><div><span class="centre-group-number">${escapeHtml(g.name)}</span><strong>${progress}/18</strong></div><p>${escapeHtml(g.teeTime)}${event.startType==='shotgun'?` · Start ${g.startingHole}`:''}${g.lastActivityAt?` · ${escapeHtml(timeAgo(g.lastActivityAt))}`:''}</p><div class="centre-group-players">${players.map(p=>avatar(p,true)).join('')}</div><span class="centre-state ${progress>=18?'complete':progress>0?'live':''}">${status}</span></article>`}).join('');
  const activity=(event.recentActivity||[]).slice(0,8).map(a=>`<div class="centre-activity"><span>${a.type==='team'?icon('users'):icon('flag')}</span><div><strong>${escapeHtml(a.name)}</strong><p>Hole ${a.hole} · ${escapeHtml(a.result)} · ${a.score}</p></div><small>${escapeHtml(timeAgo(a.at))}</small></div>`).join('')||'<div class="centre-empty">Highlights appear here as confirmed scores arrive.</div>';
  const adminAwaiting=event.cloud?.role==='admin'?cardsToVerify(event):[];
  const adminRows=adminAwaiting.slice(0,12).map(c=>{const p=playerForCloudId(event,c.playerId);return `<button class="centre-card-control" data-action="verify-card" data-card-id="${c.id}" data-event-id="${event.id}">${p?avatar(p,true):''}<span><strong>${escapeHtml(p?.name||'Player')}</strong><small>Awaiting verification${c.submittedAt?` · ${escapeHtml(timeAgo(c.submittedAt))}`:''}</small></span><b>Review →</b></button>`}).join('');
  const finalRows=finalCardsForAdmin(event).map(c=>{const p=c.scope==='player'?playerForCloudId(event,c.playerId):null,t=c.scope==='team'?teamForCloudId(event,c.teamId):null,name=p?.name||t?.name||'Scorecard';return `<div class="centre-final-card"><span><strong>${escapeHtml(name)}</strong><small>SIGNED · FINAL${c.verifiedAt?` · ${escapeHtml(timeAgo(c.verifiedAt))}`:''}</small></span><button class="ghost-btn small-btn" data-action="reopen-card" data-card-id="${c.id}" data-event-id="${event.id}">Reopen</button></div>`}).join('');
  const organiserCards=event.cloud?.role==='admin'?`<div class="centre-section-head organiser-head"><strong>Card control</strong><span>${adminAwaiting.length} awaiting</span></div><div class="centre-card-control-list">${adminRows||'<div class="centre-empty">No cards are waiting for verification.</div>'}</div>${finalRows?`<details class="centre-final-details"><summary>Recent final cards</summary><div>${finalRows}</div></details>`:''}`:'';
  return `${renderOrganizerConsole(event)}<section class="tournament-centre"><div class="centre-title"><div><p class="eyebrow">LIVE TOURNAMENT CENTRE</p><h2>${event.resultsPublished?'Final field status':'Field status'}</h2></div><span class="live-pill ${event.resultsPublished?'final':''}"><i></i>${event.resultsPublished?'Final':'Live'}</span></div><div class="centre-metrics"><article><span>On course</span><strong>${counts.playing}</strong></article><article><span>Finished</span><strong>${counts.finished}</strong></article><article><span>Verify</span><strong>${counts.awaiting}</strong></article><article><span>Final</span><strong>${counts.final}</strong></article></div>${renderTournamentExceptions(event)}${organiserCards}<div class="centre-section-head"><strong>Groups</strong><span>${event.groups?.length||0} total</span></div><div class="centre-groups">${groups}</div><div class="centre-section-head"><strong>Recent highlights</strong><span>Live feed</span></div><div class="centre-activity-list">${activity}</div></section>`;
}
function renderMyEventScreen(event){
  ensureTournamentGroups(event);const me=selfPlayer(event),info=formatInfo(event.format),group=me?playerGroup(event,me.id):null,partners=group?(event.players||[]).filter(p=>group.playerIds.includes(p.id)):(event.players||[]),canManage=!event.cloud?.synced||event.cloud?.role==='admin';
  const verificationAvailable=!!event.cloud?.synced;const activeInfo=me?formatInfo(formatKeyForHole(event,currentHoleNo(event))):info;const team=me?.teamId?(event.teams||[]).find(t=>t.id===me.teamId):null;const sharedWholeRound=event.format!=='custom'&&info.entry==='team';const card=verificationAvailable?(sharedWholeRound&&team?cardForTeam(event,team):cardForPlayer(event,me)):null;const complete=sharedWholeRound&&team?(event.teamConfirmedHoles?.[team.id]||[]).length>=holeCount(event):(me?selfCardComplete(event,me):false);const cardStatus=cardStatusMeta(card,complete,holeCount(event)),competition=me?(me.competitionStatus||'active'):'active',status=competition!=='active'?{key:competition,label:competitionStatusMeta(competition).label}:cardStatus;const verify=verificationAvailable?cardsToVerify(event):[];
  const joinBlock=canManage?`<section class="event-pass-invite"><div><span>PLAYER JOIN CODE</span><strong>${escapeHtml(event.cloud?.joinCode||'SYNCING')}</strong><small>${event.registrationOpen?'Registration open':'Registration closed'} · share the player invite with the field.</small></div><div class="event-pass-invite-actions"><button class="secondary-btn small-btn" data-action="share-event" data-event-id="${event.id}">Player invite</button>${event.eventMode==='tournament'?`<button class="secondary-btn small-btn" data-action="share-spectator" data-event-id="${event.id}">Spectator link</button>`:''}</div></section>`:'';
  const groupPlayers=partners.map(p=>`<div class="event-pass-player">${avatar(p)}<div><strong>${escapeHtml(p.name)}</strong><span>HCP ${Number(p.hcp||0).toFixed(1)}${p.isSelf?' · You':''}${(p.competitionStatus||'active')!=='active'?` · ${escapeHtml(competitionStatusMeta(p.competitionStatus).short)}`:''}</span></div><b class="joined-dot ${p.userId?'on':''}" title="${p.userId?'Joined':'Not joined'}"></b></div>`).join('');
  const claim=!me&&event.cloud?.role==='player'?claimPlayerPrompt(event):'';
  const submit=verificationAvailable&&me&&competition==='active'&&complete&&!card?`<button class="primary-btn gold" data-action="submit-card" data-event-id="${event.id}">${sharedWholeRound?'Finalize team card':'Submit scorecard'}</button>`:'';
  const verifyRows=verify.map(c=>{const p=playerForCloudId(event,c.playerId);return `<button class="verify-request" data-action="verify-card" data-card-id="${c.id}" data-event-id="${event.id}">${p?avatar(p,true):''}<span><strong>${escapeHtml(p?.name||'Player')}</strong><small>Card ready for your verification</small></span><b>Review →</b></button>`}).join('');
  return `<main class="screen my-event-screen">${topbar('My Event','FAIRWAY ONE')}<button class="event-back" data-action="event-list">‹ All events</button><section class="event-pass-hero"><div class="event-pass-top"><span class="event-pass-badge">${event.eventMode==='tournament'?'TOURNAMENT':'EVENT'} PASS</span><span>${formatDate(event.date)}</span></div><h1>${escapeHtml(event.name)}</h1><p>${escapeHtml(event.course.name)} · ${escapeHtml(event.course.tee||'')}</p><div class="event-pass-format">${icon('medal')}<div><span>FORMAT</span><strong>${escapeHtml(info.name)}</strong></div></div></section>${claim}${renderAnnouncements(event,{compact:true})}<section class="event-pass-grid"><article><span>TEE TIME</span><strong>${escapeHtml(group?.teeTime||event.teeTime||'—')}</strong></article><article><span>${event.startType==='shotgun'?'START HOLE':'GROUP'}</span><strong>${event.startType==='shotgun'?(group?.startingHole||'—'):(group?.name||'Social')}</strong></article><article><span>HANDICAP</span><strong>${me?Number(me.hcp||0).toFixed(1):'—'}</strong></article><article class="card-state ${status.key}"><span>CARD STATUS</span><strong>${escapeHtml(status.label)}</strong></article></section>${joinBlock}<section class="event-pass-section"><div class="section-head"><div><p class="eyebrow">YOUR GROUP</p><h3>${escapeHtml(group?.name||'Playing partners')}</h3></div><span>${partners.length} golfer${partners.length===1?'':'s'}</span></div><div class="event-pass-players">${groupPlayers}</div></section>${verifyRows?`<section class="event-pass-section"><div class="section-head"><div><p class="eyebrow">${event.cloud?.role==='admin'?'CARD CONTROL':'MARKER DUTY'}</p><h3>${event.cloud?.role==='admin'?'Cards awaiting verification':'Cards to verify'}</h3></div></div><div class="verify-list">${verifyRows}</div></section>`:''}<section class="event-pass-actions">${me&&competition!=='active'?`<button class="secondary-btn" disabled>${escapeHtml(competitionStatusMeta(competition).label)}</button>`:`<button class="secondary-btn" data-action="activate-event" data-event-id="${event.id}">${complete?'View scorecard':'Start / resume scorecard'}</button>`}<button class="secondary-btn" data-action="event-centre" data-event-id="${event.id}">${event.eventMode==='tournament'?'Live Tournament Centre':'Live leaderboard'}</button>${submit}</section>${event.eventMode==='tournament'?renderTournamentCentre(event):''}</main>`
}

function scoredPrimaryLeaderboard(event){const board=primaryLeaderboard(event).filter(x=>x.type!=='team'||playersForTeam(event,x.team?.id).length);if(event?.eventMode!=='tournament')return board;return board.filter(x=>x.type!=='player'||(((x.player?.competitionStatus||'active')==='active')&&(x.stats?.holes||0)>0))}
function formatHeroScore(event){if(event?.format==='custom'){ensureCustomSegments(event);const points=customEventPoints(event);if(points.length)return `${points[0].name} ${eventPointsLabel(points[0].points)} pts`;return `${event.customSegments.length} segment${event.customSegments.length===1?'':'s'}`}const board=scoredPrimaryLeaderboard(event);if(!board.length)return '—';const first=board[0];if(first.type==='player'){if(event.format==='stableford')return `${first.stats.points} pts`;if(event.format==='par_bogey'||event.format==='modified_stableford')return signed(first.stats.points);if(event.format==='skins')return `${first.stats.skins} skins`;if(event.format==='stroke')return signed(first.stats.toPar);return 'Live'}if(first.type==='team'){if(event.format==='fourball_stableford')return `${first.stats.points||0} pts`;return `${first.team.name}`}if(first.type==='match'||first.type==='team_match')return first.status.label;return 'Live'}
function homeScreen(){
  const event=activeLiveEvent();
  const day=today.toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'long'}).toUpperCase();
  const firstName=(state.profile.name||'Golfer').split(' ')[0];
  const provider=countryHandicapProvider(state.profile.countryCode);
  const homeProfilePhoto=state.profile.avatarPath?profilePhotoUrl(state.profile.avatarPath):'';
  let hero='';
  if(event){
    ensureCustomSegments(event);ensureTournamentGroups(event);const heroHole=currentHoleNo(event),h=event.course.holes[heroHole-1]||event.course.holes[0];const info=event.format==='custom'?formatInfo('custom'):formatInfo(event.format);
    hero=`<section class="hero-card premium-hero"><div class="hero-top"><span class="live-pill"><i></i>Live round</span><span class="hero-round-id">${event.eventMode==='tournament'?`${event.groups?.filter(g=>(event.groupConfirmedHoles?.[g.id]||[]).length>=18).length||0} / ${event.groups?.length||0} GROUPS COMPLETE`:`${eventProgress(event)} / ${holeCount(event)} COMPLETE`}</span></div><div class="hero-main"><p class="eyebrow">${escapeHtml(info.name)}</p><h2>${escapeHtml(event.name||'Round in progress')}</h2><p>${escapeHtml(event.course.name)} · ${formatDate(event.date)} · ${escapeHtml(event.teeTime)}</p><div class="hero-meta"><span>${icon('users')}${event.players.length} PLAYERS</span>${event.eventMode==='tournament'?`<span>${icon('flag')}${event.groups?.length||0} GROUPS</span>`:''}${eventUsesTeams(event)?`<span>${icon('users')}${(event.teams||[]).filter(t=>playersForTeam(event,t.id).length).length} TEAMS</span>`:''}<span>${icon('target')}${event.format==='custom'?'CUSTOM':escapeHtml(info.category.toUpperCase())}</span></div></div><div class="hero-bottom"><div class="hero-stat"><span>${icon('medal')} LEADER PREVIEW</span><strong>${escapeHtml(formatHeroScore(event))}</strong></div><div class="hero-stat current-hole-stat"><span>${icon('flag')} CURRENT HOLE</span><div><strong>${heroHole}</strong><small>Par ${h?.par||'—'}<br>${h?.distance||'—'} m · SI ${h?.si||'—'}</small></div></div><div class="hero-actions"><button class="primary-btn gold hero-resume" data-action="resume"><span>▶</span> Resume round</button><button class="ghost-btn hero-edit" data-action="event-edit" data-event-id="${event.id}">${icon('spark')} Edit</button></div></div></section>`;
  }else{
    hero=`<section class="hero-card premium-hero ready-hero"><div class="hero-top"><span class="ready-pill">${icon('flag')} READY TO PLAY</span><span class="hero-round-id">NO ROUND IN PROGRESS</span></div><div class="hero-main"><p class="eyebrow">YOUR NEXT ROUND</p><h2>Ready when you are.</h2><p>Choose a course, add your players and pick how you want to play.</p><div class="hero-meta"><span>${icon('target')} 16 FORMATS</span><span>${icon('spark')} BUILD YOUR ROUND</span></div></div><div class="ready-actions"><button class="primary-btn gold" data-action="create-event"><span>▶</span> Start a round</button><button class="ghost-btn" data-action="create-custom-event">Build your round</button></div></section>`;
  }
  return `<main class="screen home-screen"><section class="home-masthead">${homeBrand()}<button class="home-profile" data-action="edit-profile"><span>${homeProfilePhoto?`<img src="${escapeHtml(homeProfilePhoto)}" alt="${escapeHtml(state.profile.name)}">`:escapeHtml(initials(state.profile.name))}</span><small>${escapeHtml(firstName)}</small></button></section><section class="welcome premium-welcome"><p class="eyebrow">${day}</p><h1>Good ${today.getHours()<12?'morning':today.getHours()<18?'afternoon':'evening'}, ${escapeHtml(firstName)}.</h1><p class="subtle">Choose the game. Enter the score. Let Fairway One do the maths.</p></section>${hero}<section class="handicap-home-card"><div><p class="eyebrow">HANDICAP</p><h3>Playing today?</h3><p>HCP ${Number(state.profile.hcp||0).toFixed(1)} · ${escapeHtml(provider.name)}</p></div><a class="secondary-btn handicap-link" href="${provider.url}" target="_blank" rel="noopener">${escapeHtml(provider.label)} ↗</a></section><section class="section"><div class="section-head"><div><p class="eyebrow">ROUND HISTORY</p><h3>Recent rounds</h3></div><button class="text-btn" data-action="create-event">+ New round</button></div>${renderRecentRounds()}</section><section class="section format-engine-home"><div class="section-head"><div><p class="eyebrow">FORMAT ENGINE</p><h3>${STANDALONE_FORMAT_COUNT} ways to play</h3></div><button class="text-btn with-arrow" data-action="open-game-guide">View all ${STANDALONE_FORMAT_COUNT} <span>→</span></button></div><div class="premium-format-grid"><button class="premium-format-card" data-action="open-game-guide"><span class="premium-format-icon">${icon('target')}</span><div><strong>INDIVIDUAL</strong><small>Stroke, Stableford,<br>Par + more</small></div><b>›</b></button><button class="premium-format-card" data-action="open-game-guide"><span class="premium-format-icon">${icon('users')}</span><div><strong>TEAM</strong><small>Four-Ball, Best Ball,<br>Ambrose + more</small></div><b>›</b></button><button class="premium-format-card" data-action="open-game-guide"><span class="premium-format-icon">${icon('medal')}</span><div><strong>MATCH PLAY</strong><small>Head-to-head<br>or teams</small></div><b>›</b></button><button class="premium-format-card custom" data-action="create-custom-event"><span class="premium-format-icon crossed">${icon('spark')}</span><div><strong>CUSTOM</strong><small>Build your own<br>round format</small></div><b>›</b></button></div></section><section class="section"><div class="section-head"><div><p class="eyebrow">LEARN</p><h3>Know the game</h3></div></div><div class="learn-grid"><button class="learn-card" data-action="open-game-guide"><span class="learn-icon">${icon('target')}</span><strong>How to play</strong><small>Guide to every scoring format in Fairway One.</small><b>Open guide →</b></button><button class="learn-card" data-action="open-rules"><span class="learn-icon">${icon('shield')}</span><strong>Rules of Golf</strong><small>Quick reference plus official rules resources.</small><b>Open rules →</b></button></div></section></main>`;
}
function renderEventList(events){
  if(!events.length)return '<div class="empty-card"><p>No events yet.</p></div>';
  return `<div class="event-list">${events.map(e=>{
    ensureCustomSegments(e);
    const canManage=!e.cloud?.synced||e.cloud?.role==='admin';
    const needsClaim=!!(cloud.session&&e.cloud?.synced&&e.cloud?.role==='player'&&!selfPlayer(e));
    const joinCode=canManage&&e.cloud?.joinCode?`<div class="event-join-code"><span>PLAYER JOIN CODE</span><strong>${escapeHtml(e.cloud.joinCode)}</strong><small>Share this with golfers so they can join and score themselves.</small></div>`:'';
    return `<article class="event-card ${e.status==='live'?'live':''}"><div class="card-row"><span class="status-pill ${e.status==='draft'?'setup':''}"><i></i>${e.status==='complete'?'Complete':e.status==='draft'?'Setup':'Live'}</span><span class="eyebrow">${formatDate(e.date)}</span></div><h4>${escapeHtml(e.name)}</h4><p>${escapeHtml(e.course.name)} · ${escapeHtml(e.teeTime)}</p><div class="event-tags"><span>${escapeHtml(formatInfo(e.format).name)}</span><span>${e.players.length} players</span>${e.eventMode==='tournament'?`<span>${e.groups?.length||0} groups</span><span>Tournament</span>`:(eventUsesTeams(e)?'<span>Teams</span>':'')}${e.format==='custom'?`<span>${e.customSegments.length} segments</span>`:''}</div>${joinCode}<div class="event-actions"><button class="${e.status==='live'?'primary-btn gold':'secondary-btn'} small-btn" data-action="event-pass" data-event-id="${e.id}">${needsClaim?'Claim my player':'My Event'}</button><button class="secondary-btn small-btn" data-action="activate-event" data-event-id="${e.id}">${e.status==='live'?'Play':'Open'}</button>${canManage?`<button class="ghost-btn small-btn" data-action="event-edit" data-event-id="${e.id}">Edit</button>`:''}</div></article>`
  }).join('')}</div>`
}


function holeStatObject(event,type,id,holeNo){
  const root=type==='team'?(event.teamStats ||= {}):(event.playerStats ||= {});
  root[id] ||= {};
  root[id][holeNo] ||= {putts:null,sandShots:null,penaltyStrokes:null,fairwayResult:null,gir:null,upAndDown:null};
  const stat=root[id][holeNo];
  if(!('fairwayResult' in stat))stat.fairwayResult=null;if(!('gir' in stat))stat.gir=null;if(!('upAndDown' in stat))stat.upAndDown=null;
  return stat;
}
function statValue(v){return v==null?'—':String(v)}
function statChoice(label,value,current,attr,id,field,disabled=''){return `<button class="advanced-stat-choice ${current===value?'active':''}" ${attr}="${id}" data-stat-cycle="${field}" data-stat-value="${value}"${disabled}>${label}</button>`}
function renderStatControls(event,type,id,holeNo){
  if(!event.trackStats)return '';
  const playerStatusLocked=type==='player'&&((event.players||[]).find(p=>p.id===id)?.competitionStatus||'active')!=='active',stat=holeStatObject(event,type,id,holeNo),locked=!!event.scoringLocked||playerStatusLocked||scorecardEntryLocked(event,type,id),disabled=locked?' disabled':'',hole=event.course?.holes?.[holeNo-1];
  const attr=type==='team'?'data-team-stat':'data-player-stat';
  const advanced=event.advancedStats?`<div class="advanced-stat-grid">
    ${Number(hole?.par||4)>3?`<div class="advanced-stat-item"><span>Fairway</span><div>${statChoice('L','left',stat.fairwayResult,attr,id,'fairwayResult',disabled)}${statChoice('Hit','hit',stat.fairwayResult,attr,id,'fairwayResult',disabled)}${statChoice('R','right',stat.fairwayResult,attr,id,'fairwayResult',disabled)}</div></div>`:`<div class="advanced-stat-item muted"><span>Fairway</span><b>Par 3</b></div>`}
    <div class="advanced-stat-item"><span>GIR</span><div>${statChoice('Yes','true',String(stat.gir),attr,id,'gir',disabled)}${statChoice('No','false',String(stat.gir),attr,id,'gir',disabled)}</div></div>
    <div class="advanced-stat-item"><span>Up & down</span><div>${statChoice('Yes','true',String(stat.upAndDown),attr,id,'upAndDown',disabled)}${statChoice('No','false',String(stat.upAndDown),attr,id,'upAndDown',disabled)}</div></div>
  </div>`:'';
  return `<div class="hole-stat-controls ${locked?'locked':''}">
    <div class="hole-stat-item"><span>Putts</span><div><button ${attr}="${id}" data-stat-field="putts" data-stat-dir="-1"${disabled}>−</button><b>${statValue(stat.putts)}</b><button ${attr}="${id}" data-stat-field="putts" data-stat-dir="1"${disabled}>+</button></div></div>
    <div class="hole-stat-item"><span>Sand shots</span><div><button ${attr}="${id}" data-stat-field="sandShots" data-stat-dir="-1"${disabled}>−</button><b>${statValue(stat.sandShots)}</b><button ${attr}="${id}" data-stat-field="sandShots" data-stat-dir="1"${disabled}>+</button></div></div>
    <div class="hole-stat-item"><span>Penalties</span><div><button ${attr}="${id}" data-stat-field="penaltyStrokes" data-stat-dir="-1"${disabled}>−</button><b>${statValue(stat.penaltyStrokes)}</b><button ${attr}="${id}" data-stat-field="penaltyStrokes" data-stat-dir="1"${disabled}>+</button></div></div>
    ${advanced}<small class="hole-stat-note">${locked?'Digital card locked. The organiser must reopen it before corrections.':'Penalty strokes are tracked here for stats and should already be included in the gross score.'}</small>
  </div>`;
}
function statTotalsFor(root,id){
  const holes=Object.values(root?.[id]||{});
  const values=(field)=>holes.map(x=>x?.[field]).filter(v=>v!=null&&Number.isFinite(Number(v))).map(Number);
  const fairway=holes.map(x=>x?.fairwayResult).filter(v=>v==='left'||v==='hit'||v==='right'),gir=holes.map(x=>x?.gir).filter(v=>typeof v==='boolean'),upDown=holes.map(x=>x?.upAndDown).filter(v=>typeof v==='boolean');
  return {
    holesTracked:holes.filter(x=>['putts','sandShots','penaltyStrokes'].some(k=>x?.[k]!=null)||x?.fairwayResult!=null||x?.gir!=null||x?.upAndDown!=null).length,
    putts:values('putts').reduce((a,b)=>a+b,0),sandShots:values('sandShots').reduce((a,b)=>a+b,0),penaltyStrokes:values('penaltyStrokes').reduce((a,b)=>a+b,0),
    fairwaysTracked:fairway.length,fairwaysHit:fairway.filter(v=>v==='hit').length,girTracked:gir.length,gir:gir.filter(Boolean).length,upDownTracked:upDown.length,upDown:upDown.filter(Boolean).length
  };
}
function renderStatsBoard(event){
  const info=formatInfo(event.format);
  if(info.entry==='team'){
    const teams=cloud.session&&event.cloud?.synced?editableTeams(event,currentHoleNo(event)):activeTeams(event);
    return `<section class="stats-board"><div class="stats-head"><span>Team</span><span>Putts</span><span>Sand</span><span>Pen.</span></div>${teams.map(t=>{const s=statTotalsFor(event.teamStats,t.id);return `<div class="stats-row"><strong>${escapeHtml(t.name)}</strong><span>${s.putts}</span><span>${s.sandShots}</span><span>${s.penaltyStrokes}</span></div>${event.advancedStats?`<div class="advanced-summary-row"><span>Fairways ${s.fairwaysTracked?`${Math.round(s.fairwaysHit/s.fairwaysTracked*100)}%`:'—'}</span><span>GIR ${s.girTracked?`${Math.round(s.gir/s.girTracked*100)}%`:'—'}</span><span>Up & down ${s.upDownTracked?`${Math.round(s.upDown/s.upDownTracked*100)}%`:'—'}</span></div>`:''}`}).join('')}</section>`;
  }
  let players=(cloud.session&&event.cloud?.synced&&selfPlayer(event))?[selfPlayer(event)]:event.players;
  if(event.eventMode==='tournament')players=players.filter(p=>strokeStats(event,p).holes>0||statTotalsFor(event.playerStats,p.id).holesTracked>0);
  return `<section class="stats-board"><div class="stats-head"><span>Player</span><span>Putts</span><span>Sand</span><span>Pen.</span></div>${players.map(p=>{const s=statTotalsFor(event.playerStats,p.id);return `<div class="stats-row"><div><strong>${escapeHtml(p.name)}</strong><small>${s.holesTracked} hole${s.holesTracked===1?'':'s'} tracked</small></div><span>${s.putts}</span><span>${s.sandShots}</span><span>${s.penaltyStrokes}</span></div>${event.advancedStats?`<div class="advanced-summary-row"><span>Fairways ${s.fairwaysTracked?`${Math.round(s.fairwaysHit/s.fairwaysTracked*100)}%`:'—'}</span><span>GIR ${s.girTracked?`${Math.round(s.gir/s.girTracked*100)}%`:'—'}</span><span>Up & down ${s.upDownTracked?`${Math.round(s.upDown/s.upDownTracked*100)}%`:'—'}</span></div>`:''}`}).join('')}</section>`;
}

function individualScoreRows(event,holeNo,formatKey=formatKeyForHole(event,holeNo)){
  const hole=event.course.holes[holeNo-1],activeInfo=formatInfo(formatKey);
  return editableScoringPlayers(event,holeNo).map(p=>{
    const score=scoreFor(event,p.id,holeNo),net=holeNet(event,p,holeNo),pts=holeStableford(event,p,holeNo);
    const status=p.competitionStatus||'active',statusLocked=event.eventMode==='tournament'&&status!=='active',rel=score==null||isPickup(score)?null:score-hole.par,cls=rel==null?'empty':rel<0?'under':rel>0?'over':'',locked=!!event.scoringLocked||statusLocked||scorecardEntryLocked(event,'player',p.id),disabled=locked?' disabled':'',lockLabel=statusLocked?competitionStatusMeta(status).label:(event.scoringLocked?'Tournament scoring locked':'Digital card locked');
    return `<article class="score-row ${locked?'scorecard-locked':''}">${avatar(p)}<div class="player-copy"><strong>${escapeHtml(p.name)}</strong><span>HCP ${p.hcp} · ${handicapStrokes(p.hcp,hole.si,holeCount(event))} shot${handicapStrokes(p.hcp,hole.si,holeCount(event))===1?'':'s'} here${isPickup(score)?' · Wipe · 0 pts':net!=null?` · Net ${net} · ${pts} pts`:''}</span>${locked?`<small class="locked-card-label">🔒 ${escapeHtml(lockLabel)}</small>`:''}${activeInfo.team?`<small class="team-chip">${escapeHtml(event.teams.find(t=>t.id===p.teamId)?.name||'Team')}</small>`:''}</div><div class="score-control"><button data-score="minus" data-player="${p.id}"${disabled}>−</button><button class="score-value ${cls}" data-score="par" data-player="${p.id}"${disabled}><strong>${score==null?'—':isPickup(score)?'P/U':score}</strong><span>${locked?'Locked':isPickup(score)?'0 pts':score==null?'Tap':rel===0?'Par':rel>0?`+${rel}`:String(rel)}</span></button><button data-score="plus" data-player="${p.id}"${disabled}>+</button><button class="clear-score" data-score="clear" data-player="${p.id}"${disabled}>×</button>${supportsPickup(formatKey)?`<button class="pickup-score ${isPickup(score)?'selected':''}" data-score="pickup" data-player="${p.id}" aria-pressed="${isPickup(score)}"${disabled}>${isPickup(score)?'Picked up · 0 pts':'Pick Up / Wipe'}</button>`:''}</div>${renderStatControls(event,'player',p.id,holeNo)}</article>`;
  }).join('');
}
function teamScoreRows(event,holeNo,formatKey=formatKeyForHole(event,holeNo)){
  const activeInfo=formatInfo(formatKey);
  return editableTeams(event,holeNo).map(team=>{
    const score=teamScoreFor(event,team.id,holeNo),members=playersForTeam(event,team.id),locked=!!event.scoringLocked||scorecardEntryLocked(event,'team',team.id),disabled=locked?' disabled':'';
    const drive=activeInfo.tracksDrive?`<div class="drive-select"><label>Selected drive</label><select data-drive-team="${team.id}"${disabled}><option value="">Choose player</option>${members.map(p=>`<option value="${p.id}" ${event.driveSelections?.[team.id]?.[holeNo]===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}</select></div>`:'';
    return `<article class="team-score-card ${locked?'scorecard-locked':''}"><div class="team-score-top"><div><span class="eyebrow">${escapeHtml(team.name)}</span><h3>${members.map(p=>escapeHtml(p.name.split(' ')[0])).join(' · ')}</h3><small>Team HCP ${Number(team.teamHcp||0).toFixed(1)}${locked?' · 🔒 Card locked':''}</small></div><div class="score-control team-control"><button data-team-score="minus" data-team="${team.id}"${disabled}>−</button><button class="score-value" data-team-score="par" data-team="${team.id}"${disabled}><strong>${score==null?'—':isPickup(score)?'P/U':score}</strong><span>${locked?'Locked':'Team'}</span></button><button data-team-score="plus" data-team="${team.id}"${disabled}>+</button><button class="clear-score" data-team-score="clear" data-team="${team.id}"${disabled}>×</button></div></div>${drive}${renderStatControls(event,'team',team.id,holeNo)}${formatKey==='ambrose'?renderDriveRequirement(event,team):''}</article>`;
  }).join('');
}
function renderDriveRequirement(event,team){const counts=driveCounts(event,team);const req=Number(event.minDrives)||0;return `<div class="drive-counts">${playersForTeam(event,team.id).map(p=>`<span class="${req&&counts[p.id]>=req?'done':''}">${escapeHtml(p.name.split(' ')[0])}: ${counts[p.id]}/${req||'—'}</span>`).join('')}</div>`}

function renderTournamentScorebar(event){
  if(event?.eventMode!=='tournament')return '';
  ensureTournamentGroups(event);const g=currentGroup(event);
  const selector=event.cloud?.role==='admin'?`<select data-scoring-group aria-label="Scoring group">${event.groups.map(x=>`<option value="${x.id}" ${x.id===g?.id?'selected':''}>${escapeHtml(x.name)}</option>`).join('')}</select>`:`<span class="my-group-pill">My group</span>`;
  return `<section class="tournament-scorebar"><div><p class="eyebrow">TOURNAMENT SCORECARD</p><strong>${escapeHtml(g?.name||'Your group')}</strong><small>${g?`${g.playerIds.length} players · ${g.teeTime}${event.startType==='shotgun'?` · Start hole ${g.startingHole}`:''}`:''}</small></div><div class="tournament-scorebar-actions">${event.scoringLocked?'<span class="ops-state locked">SCORING LOCKED</span>':''}${selector}</div></section>`;
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
  const me=selfPlayer(event),myTeam=me?.teamId?(event.teams||[]).find(t=>t.id===me.teamId):null,cardLocked=!!event.scoringLocked||!!(event.cloud?.synced&&me&&(info.entry==='team'&&myTeam?scorecardEntryLocked(event,'team',myTeam.id):scorecardEntryLocked(event,'player',me.id)));
  const entry=needsClaim?claimPlayerPrompt(event):(info.entry==='team'?teamScoreRows(event,holeNo,formatKey):individualScoreRows(event,holeNo,formatKey));
  const heading=needsClaim?'Link your player':event.scoringLocked?'Tournament scoring locked':cardLocked?'Digital card locked':info.entry==='team'?(editableTeams(event,holeNo).length===1?'Enter your team score':'Enter team scores'):(cloudSelfMode(event,holeNo)?'Enter your score':'Enter player scores');
  const actions=needsClaim?'':cardLocked?`<div class="hole-actions locked-actions"><button class="secondary-btn" data-action="event-pass" data-event-id="${event.id}">Back to My Event</button><button class="primary-btn" disabled>${event.scoringLocked?'🔒 Scoring locked':'🔒 Card locked'}</button></div>`:`<div class="hole-actions"><button class="secondary-btn" data-action="save-only">Save</button><button class="primary-btn" data-action="confirm-hole">${confirmed?'Update & next hole':`Confirm hole ${holeNo}`}</button></div>`;
  return `<main class="screen play-screen-v5">${topbar('Live scoring',event.course.name)}${renderTournamentScorebar(event)}<section class="play-header"><div class="hole-nav"><button data-action="prev-hole">‹</button><div class="hole-centre"><span>Hole</span><strong>${holeNo}</strong></div><button data-action="next-hole">›</button></div><div class="hole-info"><div><span>Par</span><strong>${hole.par}</strong></div><div><span>SI</span><strong>${hole.si}</strong></div><div><span>Metres</span><strong>${hole.distance||'—'}</strong></div><div><span>Status</span><strong>${confirmed?'✓':'—'}</strong></div></div><div class="format-banner"><div>${segment?`<span>${escapeHtml(segment.name)} · ${escapeHtml(holesLabel(segment.holes))}</span>`:`<span>${escapeHtml(info.category)}</span>`}<strong>${escapeHtml(info.name)}</strong></div><button data-action="format-info">How it works</button></div></section>${renderHoleStrip(event)}${renderPersonalPulse(event)}${renderCourseMemory(event,holeNo)}<section class="score-section"><div class="score-head"><div><p class="eyebrow">${escapeHtml(event.name)}</p><h2>${heading}</h2></div><span class="sync-pill"><i></i> ${escapeHtml(cloudLabel())}</span></div><div class="score-list">${entry}</div>${!needsClaim&&info.tracksDrive&&info.entry==='individual'?renderDriveSelectors(event,holeNo):''}</section>${renderSideGames(event,holeNo)}${renderGroupRace(event)}${renderLiveImpact(event)}${actions}${event.format==='custom'?`<p class="muted-note">Custom round active. Fairway One is applying <strong>${escapeHtml(info.name)}</strong> to hole ${holeNo} from the segment you built.</p>`:''}</main>`;
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
function eventsScreen(){
  const viewed=ui.eventView?state.events.find(e=>e.id===ui.eventView):null;
  if(viewed)return renderMyEventScreen(viewed);
  return `<main class="screen">${topbar('Events','FAIRWAY ONE')}<section class="page-intro"><p class="eyebrow">COMPETITION BUILDER</p><h1 class="page-title">Play it your way.</h1><p class="body-copy">Start a social round, join your group, build a mixed-format competition, or run a tournament with up to 72 players.</p></section><div class="event-create-grid"><button class="primary-btn gold" data-action="create-event">+ New round</button><button class="secondary-btn" data-action="join-event">Join an event</button><button class="secondary-btn" data-action="create-custom-event">Build custom round</button><button class="secondary-btn tournament-launch" data-action="create-tournament">Run a tournament · up to 72</button></div>${renderEventList(state.events)}</main>`
}

function comparisonTabs(event){
  if(event?.format==='custom')return [['primary','Event'],...(event.trackStats?[['stats','Stats']]:[])];
  const info=formatInfo(event?.format||'stableford'),tabs=[['primary',info.short||info.name]];
  if(info.entry!=='team'&&!['stroke'].includes(event.format))tabs.push(['stroke','Strokes']);
  if(info.entry!=='team'&&!['stableford'].includes(event.format))tabs.push(['stableford','Points']);
  if(info.entry!=='team'&&(event.players||[]).length>=2&&!['match'].includes(event.format))tabs.push(['match','Match']);
  if(event.trackStats)tabs.push(['stats','Stats']);
  return tabs.slice(0,5);
}
function renderIndividualBoard(event,key){
  const rows=(event.players||[]).filter(player=>event.eventMode!=='tournament'||(player.competitionStatus||'active')==='active').map(player=>{let stats,value='—';if(key==='stroke'){stats=strokeStats(event,player);value=stats.pickups?'Incomplete':signed(stats.toPar)}else{stats=stablefordStats(event,player);value=`${stats.points} pts`}return{player,stats,value,sort:key==='stroke'?(stats.pickups?Infinity:stats.toPar):-stats.points}}).filter(x=>x.stats.holes>0||event.eventMode!=='tournament').sort((a,b)=>a.sort-b.sort);
  if(!rows.length)return '<div class="empty-card"><p>No confirmed scores yet.</p></div>';
  return `<section class="leaderboard"><div class="leader-head"><span>Pos</span><span>Player</span><span>Thru</span><span>${key==='stroke'?'Net':'Points'}</span></div>${rows.map((x,i)=>`<div class="leader-row"><span class="pos ${i===0?'first':''}">${i+1}</span><div class="leader-person">${avatar(x.player,true)}<div><strong>${escapeHtml(x.player.name)}</strong><span>HCP ${Number(x.player.hcp||0).toFixed(1)}${key==='stroke'&&x.stats.holes?` · ${x.stats.gross} gross`:''}</span></div></div><span class="leader-thru">${x.stats.holes||'—'}</span><strong class="leader-score">${escapeHtml(x.value)}</strong></div>`).join('')}</section>`;
}
function renderMatchBoard(event){
  const pairs=matchPairs(event);if(!pairs.length)return '<div class="empty-card"><p>Add at least two players for a match view.</p></div>';
  return `<div class="match-list">${pairs.map(([a,b])=>{const st=matchStatus(event,a,b);return `<article class="match-card"><div><span>Player</span><strong>${escapeHtml(a.name)}</strong></div><div class="match-result">${escapeHtml(st.label)}</div><div><span>Player</span><strong>${escapeHtml(b.name)}</strong></div></article>`}).join('')}</div>`;
}
function renderPrimaryLeaderboard(event){
  const board=scoredPrimaryLeaderboard(event);if(!board.length)return '<div class="empty-card"><p>No confirmed scores yet.</p></div>';
  if(board[0]?.type==='match'||board[0]?.type==='team_match')return renderMatchBoard(event);
  if(board[0]?.type==='player'){
    return `<section class="leaderboard"><div class="leader-head"><span>Pos</span><span>Player</span><span>Thru</span><span>Score</span></div>${board.map((x,i)=>{const metric=leaderboardMetric(event,x);return `<div class="leader-row"><span class="pos ${i===0?'first':''}">${i+1}</span><div class="leader-person">${avatar(x.player,true)}<div><strong>${escapeHtml(x.player.name)}</strong><span>HCP ${Number(x.player.hcp||0).toFixed(1)}</span></div></div><span class="leader-thru">${x.stats.holes||'—'}</span><strong class="leader-score">${escapeHtml(metric.value)}</strong></div>`}).join('')}</section>`;
  }
  return `<div class="team-board">${board.map((x,i)=>{const s=x.stats||{};const value=event.format==='fourball_stableford'?`${s.points||0} pts`:s.toPar!=null?signed(s.toPar):String(s.total??s.gross??'—');return `<article class="team-leader-card"><span class="team-rank">${i+1}</span><div><span class="eyebrow">${escapeHtml(formatInfo(event.format).short)}</span><h3>${escapeHtml(x.team.name)}</h3><p>${s.holes||0} holes · ${escapeHtml(value)}</p></div></article>`}).join('')}</div>`;
}
function renderCustomLeaderboard(event){
  ensureCustomSegments(event);const points=customEventPoints(event);
  const overall=points.length?`<section class="event-points-board"><div class="event-points-head"><div><p class="eyebrow">EVENT POINTS</p><h2>Overall</h2></div></div>${points.map((x,i)=>`<div class="event-points-row"><span>${i+1}</span><strong>${escapeHtml(x.name)}</strong><b>${eventPointsLabel(x.points)} pts</b></div>`).join('')}</section>`:`<section class="event-points-board empty"><p class="eyebrow">EVENT POINTS</p><h2>Waiting for a segment result</h2><p>Segment points will accumulate here as each section of the round is completed.</p></section>`;
  const segments=event.customSegments.map((seg,i)=>{const r=segmentResult(event,seg);return `<article class="custom-result-card ${segmentTone(i)}"><div class="custom-result-head"><div><span>${escapeHtml(holesLabel(seg.holes))}</span><strong>${escapeHtml(seg.name)}</strong><small>${escapeHtml(formatInfo(seg.format).name)} · ${eventPointsLabel(seg.points)} pts</small></div><b>${r.complete?'FINAL':r.status==='live'?'LIVE':'PENDING'}</b></div><div class="custom-result-leader"><span>${r.complete?'Result':'Current leader'}</span><strong>${escapeHtml(r.label)}</strong><small>${escapeHtml(r.detail||'')}</small></div></article>`}).join('');
  return `${overall}<div class="custom-segment-board">${segments}</div>`;
}

function leaderboardScreen(){
  const event=activeEvent();
  if(!event)return `<main class="screen">${topbar('Scores','FAIRWAY ONE')}<section class="page-intro"><h1 class="page-title">No active event.</h1></section></main>`;
  const centre=event.eventMode==='tournament'?renderTournamentCentre(event):'';const recap=renderRoundRecap(event);
  if(event.format==='custom'){
    ensureCustomSegments(event);const tabs=comparisonTabs(event);if(!tabs.some(t=>t[0]===ui.leaderboard))ui.leaderboard='primary';const body=ui.leaderboard==='stats'?renderStatsBoard(event):renderCustomLeaderboard(event);
    return `<main class="screen">${topbar('Live scores',event.name)}<section class="page-intro"><p class="eyebrow">${eventProgress(event)}/${holeCount(event)} COMPLETE</p><h1 class="page-title">${ui.leaderboard==='stats'?'Round stats':'Segment board'}</h1><p class="body-copy">${escapeHtml(event.course.name)} · Build Your Round</p></section>${recap}${centre}<div class="segment-tabs">${tabs.map(([k,l])=>`<button class="${ui.leaderboard===k?'active':''}" data-leader-tab="${k}">${escapeHtml(l)}</button>`).join('')}</div>${body}</main>`
  }
  const tabs=comparisonTabs(event);if(!tabs.some(t=>t[0]===ui.leaderboard))ui.leaderboard='primary';let body='';if(ui.leaderboard==='primary')body=renderPrimaryLeaderboard(event);if(ui.leaderboard==='stroke')body=renderIndividualBoard(event,'stroke');if(ui.leaderboard==='stableford')body=renderIndividualBoard(event,'stableford');if(ui.leaderboard==='match')body=renderMatchBoard(event);if(ui.leaderboard==='stats')body=renderStatsBoard(event);
  return `<main class="screen">${topbar(event.eventMode==='tournament'?'Tournament Centre':'Live scores',event.name)}<section class="page-intro"><p class="eyebrow">${event.eventMode==='tournament'?`${event.players.length} PLAYERS · ${event.groups?.length||0} GROUPS`:`${eventProgress(event)}/${holeCount(event)} COMPLETE`}</p><h1 class="page-title">${event.eventMode==='tournament'?'Live Tournament Centre':'Leaderboard'}</h1><p class="body-copy">${escapeHtml(event.course.name)} · ${escapeHtml(formatInfo(event.format).name)}</p></section>${recap}${centre}<div class="segment-tabs">${tabs.map(([k,l])=>`<button class="${ui.leaderboard===k?'active':''}" data-leader-tab="${k}">${escapeHtml(l)}</button>`).join('')}</div>${body}</main>`
}

function profileScreen(){const signed=!!cloud.session;const email=cloud.session?.user?.email||'';const provider=countryHandicapProvider(state.profile.countryCode);return `<main class="screen">${topbar('More','FAIRWAY ONE')}<section class="profile-hero"><div class="profile-avatar">${state.profile.avatarPath?`<img src="${escapeHtml(profilePhotoUrl(state.profile.avatarPath))}" alt="${escapeHtml(state.profile.name)}">`:escapeHtml(initials(state.profile.name))}</div><div><p class="eyebrow">FAIRWAY ONE PROFILE</p><h1>${escapeHtml(state.profile.name)}</h1><p>${state.profile.homeClub?`${escapeHtml(state.profile.homeClub)} · `:''}HCP ${Number(state.profile.hcp||0).toFixed(1)}</p></div></section><section class="stat-grid"><article class="stat-card"><span>Rounds</span><strong>${completedEvents().length}</strong></article><article class="stat-card"><span>Formats</span><strong>${STANDALONE_FORMAT_COUNT}</strong></article><article class="stat-card"><span>Handicap</span><strong>${Number(state.profile.hcp||0).toFixed(1)}</strong></article><article class="stat-card"><span>Cloud</span><strong>${signed?'On':'Off'}</strong></article></section>${renderProfilePerformance()}${renderCourseRecords()}${renderRivals()}<section class="section"><div class="section-head"><div><p class="eyebrow">HANDICAP</p><h3>${escapeHtml(provider.name)}</h3></div></div><div class="event-card handicap-profile-card"><p class="muted-note">Use your national handicap service to confirm your playing handicap for the course and tees you are playing.</p><a class="primary-btn small-btn handicap-link" href="${provider.url}" target="_blank" rel="noopener">${escapeHtml(provider.label)} ↗</a></div></section><section class="section"><div class="section-head"><div><p class="eyebrow">FAIRWAY ONE CLOUD</p><h3>${signed?'Connected':'Connect your account'}</h3></div><span class="status-pill"><i></i>${escapeHtml(cloudLabel())}</span></div><div class="event-card cloud-card">${signed?`<p><strong>${escapeHtml(email)}</strong></p><p class="muted-note">Keep your rounds and scores synced across your devices.</p><div class="event-actions"><button class="primary-btn small-btn" data-action="cloud-sync">Sync active round</button><button class="secondary-btn small-btn" data-action="cloud-refresh">Refresh</button><button class="ghost-btn small-btn" data-action="cloud-signout">Sign out</button></div>`:`<p class="muted-note">Create or sign into a Fairway One account to keep your rounds and scores available across devices.</p><div class="event-actions"><button class="primary-btn small-btn" data-action="cloud-auth">Sign in / create account</button></div>`}${cloud.lastError?`<p class="cloud-error">Cloud error: ${escapeHtml(cloud.lastError.message||'Unknown error')}</p>`:''}</div></section><section class="section"><div class="section-head"><div><p class="eyebrow">LEARNING CENTRE</p><h3>Formats & rules</h3></div></div><div class="learn-grid"><button class="learn-card" data-action="open-game-guide"><span class="learn-icon">${icon('target')}</span><strong>How to play</strong><small>Every format in the Fairway One engine.</small><b>View formats →</b></button><button class="learn-card" data-action="open-rules"><span class="learn-icon">${icon('shield')}</span><strong>Rules of Golf</strong><small>Quick guide plus official rules links.</small><b>View rules →</b></button></div></section><section class="section"><div class="section-head"><div><p class="eyebrow">SETTINGS</p><h3>Account & data</h3></div></div><div class="event-card"><div class="event-actions"><button class="secondary-btn small-btn" data-action="edit-profile">Edit profile</button><button class="ghost-btn small-btn" data-action="export-data">Export rounds</button></div></div></section></main>`}

function renderSpectatorScreen(event){
  if(event?.error)return `<main class="screen spectator-screen"><section class="spectator-brand">${homeBrand()}</section><section class="empty-card"><p class="eyebrow">LIVE TOURNAMENT</p><h2>Unable to open this spectator view.</h2><p>${escapeHtml(event.error)}</p><button class="secondary-btn" data-action="spectator-refresh">Try again</button></section></main>`;
  ensureTournamentGroups(event);const board=renderPrimaryLeaderboard(event),leader=formatHeroScore(event),updated=event.updatedAt?timeAgo(event.updatedAt):'just now';
  return `<main class="screen spectator-screen"><section class="spectator-brand">${homeBrand()}<span class="live-pill ${event.resultsPublished?'final':event.status==='draft'?'upcoming':''}"><i></i>${event.resultsPublished?'FINAL RESULTS':event.status==='draft'?'UPCOMING':'LIVE'}</span></section><section class="spectator-hero"><p class="eyebrow">FAIRWAY ONE LIVE</p><h1>${escapeHtml(event.name)}</h1><p>${escapeHtml(event.course.name)} · ${formatDate(event.date)} · ${escapeHtml(formatInfo(event.format).name)}</p><div class="spectator-hero-grid"><article><span>Leader</span><strong>${escapeHtml(leader)}</strong></article><article><span>Field</span><strong>${event.players.length}</strong></article><article><span>Groups</span><strong>${event.groups.length}</strong></article><article><span>Updated</span><strong>${escapeHtml(updated)}</strong></article></div><button class="ghost-btn spectator-refresh" data-action="spectator-refresh">Refresh live scores</button></section>${renderAnnouncements(event)}${renderTournamentCentre(event)}<section class="section spectator-leaderboard"><div class="section-head"><div><p class="eyebrow">LEADERBOARD</p><h3>${event.resultsPublished?'Final standings':'Live standings'}</h3></div></div>${board}</section><footer class="spectator-footer"><strong>Fairway One</strong><span>PLAY · SCORE · COMPETE</span><button data-action="spectator-exit">Open Fairway One</button></footer></main>`;
}
function render(){
  const bottomNav=document.getElementById('bottomNav');
  if(ui.spectatorEvent){if(bottomNav)bottomNav.hidden=true;app.innerHTML=renderSpectatorScreen(ui.spectatorEvent);bindActions();return}
  if(bottomNav)bottomNav.hidden=false;
  const screens={home:homeScreen,play:playScreen,events:eventsScreen,leaderboard:leaderboardScreen,profile:profileScreen};
  app.innerHTML=connectionBanner()+(screens[ui.tab]||homeScreen)();
  navButtons.forEach(b=>b.classList.toggle('active',b.dataset.tab===ui.tab));bindActions()
}
function switchTab(tab){ui.tab=tab;if(tab==='events')ui.eventView=null;app.scrollTop=0;render()}
function bindActions(){document.querySelectorAll('[data-action]').forEach(el=>el.addEventListener('click',handleAction));document.querySelectorAll('[data-score]').forEach(el=>el.addEventListener('click',handlePlayerScore));document.querySelectorAll('[data-team-score]').forEach(el=>el.addEventListener('click',handleTeamScore));document.querySelectorAll('[data-player-stat]').forEach(el=>el.addEventListener('click',handleStatAdjust));document.querySelectorAll('[data-team-stat]').forEach(el=>el.addEventListener('click',handleStatAdjust));document.querySelectorAll('[data-stat-cycle]').forEach(el=>el.addEventListener('click',handleStatCycle));document.querySelectorAll('[data-side-game]').forEach(el=>el.addEventListener('click',handleSideGameLeader));document.querySelectorAll('[data-drive-team]').forEach(el=>el.addEventListener('change',handleDriveSelection));document.querySelectorAll('[data-leader-tab]').forEach(el=>el.addEventListener('click',()=>{ui.leaderboard=el.dataset.leaderTab;render()}));document.querySelectorAll('[data-scoring-group]').forEach(el=>el.addEventListener('change',()=>{const evt=activeEvent();if(!evt)return;evt.activeGroupId=el.value;saveState();render()}))}
async function handleAction(e){
  const el=e.currentTarget,a=el.dataset.action;
  if(a==='resume'){await subscribeActiveRound();return switchTab('play')}
  if(a==='create-event')return openEventModal();
  if(a==='create-custom-event')return openEventModal(null,true);
  if(a==='create-tournament')return openTournamentModal();
  if(a==='join-event')return cloud.session?openJoinEventModal():openCloudAuthModal('Sign in first, then use Join an event.');
  if(a==='claim-player')return openClaimPlayerModal(el.dataset.eventId||activeEvent()?.id);
  if(a==='event-pass'){const evt=state.events.find(x=>x.id===el.dataset.eventId);if(!evt)return;state.activeEventId=evt.id;saveState();if(evt.cloud?.synced&&evt.cloud?.role==='player'&&!selfPlayer(evt))return openClaimPlayerModal(evt.id);ui.tab='events';ui.eventView=evt.id;app.scrollTop=0;return render()}
  if(a==='event-list'){ui.eventView=null;app.scrollTop=0;return render()}
  if(a==='event-centre'){const evt=state.events.find(x=>x.id===el.dataset.eventId)||activeEvent();if(!evt)return;state.activeEventId=evt.id;ui.eventView=null;saveState();return switchTab('leaderboard')}
  if(a==='share-event'){const evt=state.events.find(x=>x.id===el.dataset.eventId)||activeEvent();if(!evt)return;return openInviteModal(evt)}
  if(a==='share-spectator'){const evt=state.events.find(x=>x.id===el.dataset.eventId)||activeEvent();if(!evt)return;return openSpectatorInviteModal(evt)}
  if(a==='post-announcement'){const evt=state.events.find(x=>x.id===el.dataset.eventId)||activeEvent();if(!evt)return;return openAnnouncementModal(evt)}
  if(a==='score-override'){const evt=state.events.find(x=>x.id===el.dataset.eventId)||activeEvent();if(!evt)return;return openScoreOverrideModal(evt)}
  if(a==='toggle-registration'){
    const evt=state.events.find(x=>x.id===el.dataset.eventId)||activeEvent();if(!evt)return;
    try{return await runTournamentAdmin(evt,'set_registration',{open:el.dataset.open==='1'},el.dataset.open==='1'?'<strong>Player registration opened.</strong>':'<strong>Player registration closed.</strong>')}catch(err){return toast(`Tournament control failed: ${escapeHtml(err.message||'Unknown error')}`)}
  }
  if(a==='toggle-scoring'){
    const evt=state.events.find(x=>x.id===el.dataset.eventId)||activeEvent();if(!evt)return;const locked=el.dataset.locked==='1';
    if(locked&&!confirm('Lock tournament scoring? Players will no longer be able to change scores until you unlock it.'))return;
    try{return await runTournamentAdmin(evt,'set_scoring_lock',{locked},locked?'<strong>Tournament scoring locked.</strong>':'<strong>Tournament scoring unlocked.</strong>')}catch(err){return toast(`Tournament control failed: ${escapeHtml(err.message||'Unknown error')}`)}
  }
  if(a==='delete-announcement'){
    const evt=state.events.find(x=>x.id===el.dataset.eventId)||activeEvent();if(!evt||!confirm('Remove this tournament announcement?'))return;
    try{return await runTournamentAdmin(evt,'delete_announcement',{announcementId:el.dataset.announcementId},'Announcement removed.')}catch(err){return toast(`Could not remove announcement: ${escapeHtml(err.message||'Unknown error')}`)}
  }
  if(a==='release-claim'){
    const evt=state.events.find(x=>x.id===el.dataset.eventId)||activeEvent();if(!evt)return;const localId=el.dataset.playerId,player=(evt.players||[]).find(p=>p.id===localId);
    if(!confirm(`Release ${player?.name||'this player'} from their Fairway One account? They will need to claim the player entry again.`))return;
    try{return await runTournamentAdmin(evt,'release_claim',{playerId:cloudPlayerId(evt,localId)},'<strong>Player account link released.</strong>')}catch(err){return toast(`Could not release player: ${escapeHtml(err.message||'Unknown error')}`)}
  }
  if(a==='player-status'){const evt=state.events.find(x=>x.id===el.dataset.eventId)||activeEvent();if(!evt)return;return openPlayerStatusModal(evt,el.dataset.playerId)}
  if(a==='finalize-player-card'){const evt=state.events.find(x=>x.id===el.dataset.eventId)||activeEvent();if(!evt)return;return openAdminFinalizeCardModal(evt,el.dataset.playerId)}
  if(a==='export-tournament'){const evt=state.events.find(x=>x.id===el.dataset.eventId)||activeEvent();if(!evt)return;return exportTournamentCsv(evt)}
  if(a==='publish-results'){
    const evt=state.events.find(x=>x.id===el.dataset.eventId)||activeEvent();if(!evt||!confirm('Publish final tournament results? This will close registration and lock scoring.'))return;
    try{return await runTournamentAdmin(evt,'publish_results',{},'<strong>Final tournament results published.</strong>')}catch(err){return toast(`Cannot publish results: ${escapeHtml(err.message||'Unknown error')}`)}
  }
  if(a==='reopen-results'){
    const evt=state.events.find(x=>x.id===el.dataset.eventId)||activeEvent();if(!evt||!confirm('Reopen this tournament? Published results will be withdrawn and scoring will unlock.'))return;
    try{return await runTournamentAdmin(evt,'reopen_results',{},'<strong>Tournament reopened.</strong>')}catch(err){return toast(`Could not reopen tournament: ${escapeHtml(err.message||'Unknown error')}`)}
  }
  if(a==='spectator-refresh'){
    if(!pendingSpectatorCode)return;try{ui.spectatorEvent=await loadPublicTournament(pendingSpectatorCode);render();return toast('Live tournament refreshed.')}catch(err){return toast(`Could not refresh tournament: ${escapeHtml(err.message||'Unknown error')}`)}
  }
  if(a==='spectator-exit'){history.replaceState({},'',location.pathname);pendingSpectatorCode='';ui.spectatorEvent=null;return render()}
  if(a==='submit-card'){const evt=state.events.find(x=>x.id===el.dataset.eventId)||activeEvent();if(!evt)return;return openSubmitCardModal(evt)}
  if(a==='verify-card'){const evt=state.events.find(x=>x.id===el.dataset.eventId)||activeEvent();if(!evt)return;return openVerifyCardModal(evt,el.dataset.cardId)}
  if(a==='reopen-card'){
    const evt=state.events.find(x=>x.id===el.dataset.eventId)||activeEvent();if(!evt)return;
    if(evt.cloud?.role!=='admin')return toast('Only the event organiser can reopen a final card.');
    if(!confirm('Reopen this final scorecard? The player or team will be able to make corrections and submit it again.'))return;
    try{await reopenScorecard(el.dataset.cardId);await refreshCloud({silent:true});const refreshed=state.events.find(x=>x.cloud?.eventId===evt.cloud?.eventId||x.id===evt.id);ui.eventView=refreshed?.id||evt.id;render();return toast('<strong>Scorecard reopened.</strong> Corrections can now be made.')}catch(err){return toast(`Could not reopen card: ${escapeHtml(err.message||'Unknown error')}`)}
  }
  if(a==='event-edit'){
    const evt=state.events.find(x=>x.id===el.dataset.eventId);if(!evt)return;
    if(evt.cloud?.synced&&evt.cloud?.role!=='admin')return toast('Only the event organiser can edit this setup.');
    if(evt.eventMode==='tournament'&&evt.status!=='draft')return toast('Tournament field, groups and course setup are frozen once play starts. Use Tournament Control for withdrawals, corrections and event operations.');
    return evt.eventMode==='tournament'?openTournamentModal(el.dataset.eventId):openEventModal(el.dataset.eventId)
  }
  if(a==='activate-event'){
    const evt=state.events.find(x=>x.id===el.dataset.eventId);if(!evt)return;
    state.activeEventId=evt.id;if(evt.status!=='complete'&&evt.eventMode!=='tournament')evt.status='live';saveState();if(evt.cloud?.synced)queueCloudSync(evt,{immediate:true});await subscribeActiveRound();
    if(evt.cloud?.synced&&evt.cloud?.role==='player'&&!selfPlayer(evt))return openClaimPlayerModal(evt.id);
    return switchTab('play')
  }
  if(a==='view-result'){const evt=state.events.find(x=>x.id===el.dataset.eventId);if(!evt)return;state.activeEventId=evt.id;saveState();return switchTab('leaderboard')}
  if(a==='share-round-recap'){const evt=state.events.find(x=>x.id===el.dataset.eventId)||activeEvent();if(!evt)return;return shareRoundRecap(evt)}
  if(a==='jump-hole'){const evt=activeEvent();if(!evt)return;const hole=Math.max(1,Math.min(holeCount(evt),Number(el.dataset.hole||1))),me=selfPlayer(evt),info=formatInfo(formatKeyForHole(evt,hole));if(cloud.session&&evt.cloud?.synced&&me){evt.playerCurrentHoles ||= {};evt.playerCurrentHoles[me.id]=hole;if(info.entry==='team'&&me.teamId){evt.teamCurrentHoles ||= {};evt.teamCurrentHoles[me.teamId]=hole}}else if(evt.eventMode==='tournament'){const g=currentGroup(evt);if(g)evt.groupCurrentHoles[g.id]=hole}else evt.currentHole=hole;saveState();return render()}
  if(a==='prev-hole'||a==='next-hole'){
    const evt=activeEvent();if(!evt)return;const delta=a==='next-hole'?1:-1,h=currentHoleNo(evt),info=formatInfo(formatKeyForHole(evt,h)),me=selfPlayer(evt);
    if(cloud.session&&evt.cloud?.synced&&me){
      const next=evt.eventMode==='tournament'&&evt.startType==='shotgun'?rotateHole(h,delta):Math.min(holeCount(evt),Math.max(1,h+delta));
      evt.playerCurrentHoles ||= {};evt.playerCurrentHoles[me.id]=next;
      if(info.entry==='team'&&me.teamId){evt.teamCurrentHoles ||= {};evt.teamCurrentHoles[me.teamId]=next}
    }else if(evt.eventMode==='tournament'){
      const g=currentGroup(evt);if(!g)return;evt.groupCurrentHoles[g.id]=evt.startType==='shotgun'?rotateHole(h,delta):Math.min(18,Math.max(1,h+delta))
    }else evt.currentHole=Math.min(holeCount(evt),Math.max(1,(evt.currentHole||1)+delta));
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
    const activeIds=(g.playerIds||[]).filter(pid=>(event.players||[]).some(p=>p.id===pid&&(p.competitionStatus||'active')==='active')),all=activeIds.length>0&&activeIds.every(pid=>(event.playerConfirmedHoles?.[pid]||[]).includes(h));
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
  const evt=activeEvent();if(!evt)return;const pid=e.currentTarget.dataset.player,h=currentHoleNo(evt),action=e.currentTarget.dataset.score,player=(evt.players||[]).find(p=>p.id===pid);if(evt.scoringLocked)return toast('Tournament scoring is locked. The organiser can use Official score correction if needed.');if(evt.eventMode==='tournament'&&(player?.competitionStatus||'active')!=='active')return toast(`${escapeHtml(player?.name||'Player')} is ${competitionStatusMeta(player?.competitionStatus).label.toLowerCase()} and cannot be scored.`);if(scorecardEntryLocked(evt,'player',pid))return toast('This digital scorecard is locked. Ask the organiser to reopen it before making corrections.');const par=evt.course.holes[h-1].par;let v=scoreFor(evt,pid,h);
  if(action==='pickup'){if(!supportsPickup(formatKeyForHole(evt,h)))return;v=0;}else if(action==='clear')v=null;else if(action==='par')v=v==null||isPickup(v)?par:v;else if(action==='plus')v=(v==null||isPickup(v)?par:v)+1;else if(action==='minus')v=Math.max(1,(v==null||isPickup(v)?par:v)-1);
  evt.scores[pid] ||= {};if(v==null)delete evt.scores[pid][h];else evt.scores[pid][h]=v;markPlayerScoreDirty(evt,pid,h);
  if(cloudSelfMode(evt,h)){evt.playerConfirmedHoles ||= {};evt.playerConfirmedHoles[pid]=(evt.playerConfirmedHoles[pid]||[]).filter(x=>x!==h);recalcSharedConfirmation(evt,h)}
  else if(evt.eventMode==='tournament'){const g=currentGroup(evt);if(g)evt.groupConfirmedHoles[g.id]=(evt.groupConfirmedHoles[g.id]||[]).filter(x=>x!==h)}
  else evt.confirmedHoles=evt.confirmedHoles.filter(x=>x!==h);
  saveState();queueCloudSync(evt);render()
}
function handleTeamScore(e){
  const evt=activeEvent();if(!evt)return;const tid=e.currentTarget.dataset.team,h=currentHoleNo(evt),action=e.currentTarget.dataset.teamScore;if(evt.scoringLocked)return toast('Tournament scoring is locked.');if(scorecardEntryLocked(evt,'team',tid))return toast('This team card is locked. The organiser must reopen it before corrections.');const par=evt.course.holes[h-1].par;let v=teamScoreFor(evt,tid,h);
  if(action==='pickup'){if(!supportsPickup(formatKeyForHole(evt,h)))return;v=0;}else if(action==='clear')v=null;else if(action==='par')v=v==null||isPickup(v)?par:v;else if(action==='plus')v=(v==null||isPickup(v)?par:v)+1;else if(action==='minus')v=Math.max(1,(v==null||isPickup(v)?par:v)-1);
  evt.teamScores[tid] ||= {};if(v==null)delete evt.teamScores[tid][h];else evt.teamScores[tid][h]=v;
  if(cloudTeamMode(evt,h)){evt.teamConfirmedHoles ||= {};evt.teamConfirmedHoles[tid]=(evt.teamConfirmedHoles[tid]||[]).filter(x=>x!==h);recalcTeamSharedConfirmation(evt,h)}else evt.confirmedHoles=evt.confirmedHoles.filter(x=>x!==h);
  saveState();queueCloudSync(evt);render()
}
function handleStatAdjust(e){
  const evt=activeEvent();if(!evt)return;const h=currentHoleNo(evt),field=e.currentTarget.dataset.statField,dir=Number(e.currentTarget.dataset.statDir||0);const pid=e.currentTarget.dataset.playerStat,tid=e.currentTarget.dataset.teamStat;
  if(!field||(!pid&&!tid))return;if(evt.scoringLocked)return toast('Tournament scoring is locked.');if(scorecardEntryLocked(evt,tid?'team':'player',tid||pid))return toast('This digital scorecard is locked.');const stat=holeStatObject(evt,tid?'team':'player',tid||pid,h);const current=stat[field]==null?0:Number(stat[field]||0);stat[field]=Math.max(0,Math.min(20,current+dir));if(pid)markPlayerScoreDirty(evt,pid,h);saveState();queueCloudSync(evt);render()
}
function handleStatCycle(e){
  e.preventDefault();const evt=activeEvent();if(!evt)return;const h=currentHoleNo(evt),field=e.currentTarget.dataset.statCycle,value=e.currentTarget.dataset.statValue,pid=e.currentTarget.dataset.playerStat,tid=e.currentTarget.dataset.teamStat;if(!field||(!pid&&!tid))return;if(evt.scoringLocked)return toast('Tournament scoring is locked.');if(scorecardEntryLocked(evt,tid?'team':'player',tid||pid))return toast('This digital scorecard is locked.');const stat=holeStatObject(evt,tid?'team':'player',tid||pid,h);let next=value;if(field==='gir'||field==='upAndDown')next=value==='true';stat[field]=stat[field]===next?null:next;if(pid)markPlayerScoreDirty(evt,pid,h);saveState();queueCloudSync(evt);render()
}
function handleSideGameLeader(e){
  const evt=activeEvent();if(!evt)return;if(evt.cloud?.synced&&evt.cloud?.role!=='admin')return toast('The organiser controls side competition leaders.');const key=e.currentTarget.dataset.sideGame,pid=e.currentTarget.dataset.sidePlayer;if(!['ntp','ld'].includes(key)||!pid)return;evt.sideGames ||= {ntpHole:0,ntpPlayerId:null,ldHole:0,ldPlayerId:null};const prop=key==='ntp'?'ntpPlayerId':'ldPlayerId';evt.sideGames[prop]=evt.sideGames[prop]===pid?null:pid;saveState();queueCloudSync(evt,{structure:true,immediate:true});render()
}
function handleDriveSelection(e){const evt=activeEvent();if(!evt)return;const tid=e.currentTarget.dataset.driveTeam,h=currentHoleNo(evt);if(evt.scoringLocked)return toast('Tournament scoring is locked.');if(scorecardEntryLocked(evt,'team',tid))return toast('This team card is locked.');evt.driveSelections[tid] ||= {};if(e.currentTarget.value)evt.driveSelections[tid][h]=e.currentTarget.value;else delete evt.driveSelections[tid][h];saveState();queueCloudSync(evt);render()}
function confirmCurrentHole(){
  const evt=activeEvent();if(!evt)return;const h=currentHoleNo(evt),formatKey=formatKeyForHole(evt,h),info=formatInfo(formatKey),me=selfPlayer(evt);if(evt.scoringLocked)return toast('Tournament scoring is locked. The organiser must unlock scoring before play can continue.');if(evt.eventMode==='tournament'&&me&&(me.competitionStatus||'active')!=='active')return toast(`Your tournament status is ${competitionStatusMeta(me.competitionStatus).label}. Scoring is unavailable.`);
  if(evt.cloud?.synced&&evt.cloud?.role==='player'&&!me)return openClaimPlayerModal(evt.id);
  if(info.entry==='team'){
    const teams=editableTeams(evt,h);if(!teams.length)return toast('Your team is not linked to this event.');
    if(teams.some(t=>teamScoreFor(evt,t.id,h)==null))return toast('Enter your team score before confirming.');
    if(info.tracksDrive&&teams.some(t=>!evt.driveSelections?.[t.id]?.[h]))return toast('Select the chosen drive before confirming.');
    if(cloudTeamMode(evt,h)){
      evt.teamConfirmedHoles ||= {};evt.teamCurrentHoles ||= {};evt.playerCurrentHoles ||= {};
      teams.forEach(t=>{evt.teamConfirmedHoles[t.id] ||= [];if(!evt.teamConfirmedHoles[t.id].includes(h))evt.teamConfirmedHoles[t.id].push(h);evt.teamConfirmedHoles[t.id].sort((a,b)=>a-b);recalcTeamSharedConfirmation(evt,h);const start=teamStartHole(evt,t);evt.teamCurrentHoles[t.id]=nextUnconfirmedHole(start,evt.teamConfirmedHoles[t.id],holeCount(evt))});
      const mine=teams[0];if(me)evt.playerCurrentHoles[me.id]=nextUnconfirmedHole(playerStartHole(evt,me.id),selfConfirmedHoles(evt,me),holeCount(evt));
      const done=me?selfCardComplete(evt,me):(evt.teamConfirmedHoles[mine.id]||[]).length>=holeCount(evt),allDone=(evt.players||[]).filter(p=>p.userId||p.isSelf).length?(evt.players||[]).filter(p=>p.userId||p.isSelf).every(p=>selfCardComplete(evt,p)):activeTeams(evt).every(t=>(evt.teamConfirmedHoles?.[t.id]||[]).length>=holeCount(evt));
      if(allDone&&evt.cloud?.role==='admin'){evt.status='complete';evt.completedAt=new Date().toISOString()}
      saveState();queueCloudSync(evt,{immediate:true});if(done){toast('<strong>Your card is complete.</strong> Results saved.');ui.tab='events';ui.eventView=evt.id;app.scrollTop=0;return render()}render();return toast(`Hole ${h} confirmed for ${mine.name}.`)
    }
  }else if(cloudSelfMode(evt,h)){
    const players=editableScoringPlayers(evt,h);if(!players.length)return openClaimPlayerModal(evt.id);const p=players[0];if(scoreFor(evt,p.id,h)==null)return toast('Enter your score before confirming.');
    if(info.tracksDrive&&editableTeams(evt,h).some(t=>!evt.driveSelections?.[t.id]?.[h]))return toast('Select the chosen drive for your team before confirming.');
    evt.playerConfirmedHoles ||= {};evt.playerCurrentHoles ||= {};evt.playerConfirmedHoles[p.id] ||= [];if(!evt.playerConfirmedHoles[p.id].includes(h))evt.playerConfirmedHoles[p.id].push(h);evt.playerConfirmedHoles[p.id].sort((a,b)=>a-b);markPlayerScoreDirty(evt,p.id,h);recalcSharedConfirmation(evt,h);evt.playerCurrentHoles[p.id]=nextUnconfirmedHole(playerStartHole(evt,p.id),selfConfirmedHoles(evt,p),holeCount(evt));
    const done=selfCardComplete(evt,p),linked=(evt.players||[]).filter(x=>x.userId||x.isSelf),allDone=linked.length?linked.every(x=>selfCardComplete(evt,x)):(evt.players||[]).every(x=>(evt.playerConfirmedHoles?.[x.id]||[]).length>=holeCount(evt));
    if(allDone&&evt.cloud?.role==='admin'){evt.status='complete';evt.completedAt=new Date().toISOString()}
    saveState();queueCloudSync(evt,{immediate:true});if(done){toast('<strong>Your round is complete.</strong> Results saved.');ui.tab='events';ui.eventView=evt.id;app.scrollTop=0;return render()}render();return toast(`Hole ${h} confirmed.`)
  }
  let missing=false;if(info.entry==='team')missing=activeTeams(evt).some(t=>teamScoreFor(evt,t.id,h)==null);else missing=currentScoringPlayers(evt).some(p=>scoreFor(evt,p.id,h)==null);if(missing)return toast('Enter every required score before confirming.');
  if(info.tracksDrive){const teams=activeTeams(evt);if(teams.some(t=>!evt.driveSelections?.[t.id]?.[h]))return toast('Select the chosen drive for each team.')}
  if(evt.eventMode==='tournament'){
    const g=currentGroup(evt);if(!g)return;currentScoringPlayers(evt).forEach(p=>markPlayerScoreDirty(evt,p.id,h));evt.groupConfirmedHoles[g.id] ||= [];if(!evt.groupConfirmedHoles[g.id].includes(h))evt.groupConfirmedHoles[g.id].push(h);
    if(evt.groupConfirmedHoles[g.id].length>=18){if(tournamentComplete(evt)){evt.status='complete';evt.completedAt=new Date().toISOString();saveState();queueCloudSync(evt,{immediate:true});toast('<strong>Tournament complete.</strong> Results saved.');return switchTab('leaderboard')}saveState();queueCloudSync(evt,{immediate:true});render();return toast(`${g.name} complete. Select another group to continue.`)}
    evt.groupCurrentHoles[g.id]=evt.startType==='shotgun'?rotateHole(h,1):Math.min(18,h+1);saveState();queueCloudSync(evt,{immediate:true});render();return toast(`${g.name} · hole ${h} confirmed.`)
  }
  if(!evt.confirmedHoles.includes(h))evt.confirmedHoles.push(h);if(evt.confirmedHoles.length>=holeCount(evt)){evt.status='complete';evt.completedAt=new Date().toISOString();saveState();queueCloudSync(evt,{immediate:true});toast('<strong>Round complete.</strong> Results saved.');return switchTab('leaderboard')}evt.currentHole=Math.min(holeCount(evt),h+1);saveState();queueCloudSync(evt,{immediate:true});render();toast(`Hole ${h} confirmed.`)
}


async function ensureEventInviteCode(event){
  if(!cloud.session)throw new Error('Sign in to create a Fairway One invite.');
  if(event.cloud?.joinCode)return event;
  if(event.cloud?.synced&&event.cloud?.role!=='admin')throw new Error('Only the event organiser can share the event invite.');
  cloud.syncing=true;render();
  try{
    await syncEvent(event,state.profile,{structure:true});
    saveState();
    await refreshCloud({silent:true});
    return state.events.find(x=>x.cloud?.eventId===event.cloud?.eventId||x.id===event.id)||event;
  }finally{cloud.syncing=false;render()}
}
async function openInviteModal(event){
  if(!cloud.session)return openCloudAuthModal('Sign in to generate and share an event invite.');
  try{event=await ensureEventInviteCode(event)}catch(err){return toast(`Invite unavailable: ${escapeHtml(err.message||'Unknown error')}`)}
  const code=event.cloud?.joinCode;if(!code)return toast('Fairway One is still generating the event code. Try again in a moment.');
  const url=eventInviteUrl(event);
  modalRoot.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-sheet invite-sheet"><div class="modal-handle"></div><div class="modal-title-row"><div><p class="eyebrow">FAIRWAY ONE INVITE</p><h2>Get the field into the event.</h2><p class="body-copy">Players can scan the QR code, tap the link or enter the short code. Once signed in they claim their name and Fairway One loads their group automatically.</p></div><button class="modal-close" data-modal-close>×</button></div><div class="invite-qr-wrap"><div class="invite-qr"><img id="eventInviteQr" alt="Fairway One event QR code"></div><div class="invite-code"><span>JOIN CODE</span><strong>${escapeHtml(code)}</strong><small>${escapeHtml(event.name)}</small></div></div><div class="invite-link"><span>INVITE LINK</span><p>${escapeHtml(url)}</p></div><div class="modal-actions"><button class="secondary-btn" id="copyInviteLink">Copy link</button><button class="primary-btn gold" id="shareInviteLink">Share invite</button></div></section></div>`;
  bindInfoModal();
  try{const qr=await QRCode.toDataURL(url,{width:360,margin:2,errorCorrectionLevel:'M'});const img=modalRoot.querySelector('#eventInviteQr');if(img)img.src=qr}catch{}
  modalRoot.querySelector('#copyInviteLink')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(url);toast('Invite link copied.')}catch{toast(`Join code: <strong>${escapeHtml(code)}</strong>`)}});
  modalRoot.querySelector('#shareInviteLink')?.addEventListener('click',async()=>{const text=`Join ${event.name} on Fairway One. Code: ${code}`;if(navigator.share){try{await navigator.share({title:`Fairway One · ${event.name}`,text,url});return}catch{}}try{await navigator.clipboard.writeText(`${text}\n${url}`);toast('Invite copied and ready to share.')}catch{toast(`Join code: <strong>${escapeHtml(code)}</strong>`)}});
}
async function ensureSpectatorCode(event){
  if(!cloud.session)throw new Error('Sign in to manage the spectator view.');
  if(event.cloud?.synced&&event.cloud?.role!=='admin')throw new Error('Only the tournament organiser can share the spectator view.');
  if(!event.cloud?.spectatorCode){await refreshCloud({silent:true});event=state.events.find(x=>x.cloud?.eventId===event.cloud?.eventId||x.id===event.id)||event}
  if(!event.cloud?.spectatorCode){const result=await tournamentAdminAction(event.cloud?.eventId||event.id,'rotate_spectator_code');await refreshCloud({silent:true});event=state.events.find(x=>x.cloud?.eventId===event.cloud?.eventId||x.id===event.id)||event}
  return event;
}
async function runTournamentAdmin(event,action,payload={},success='Tournament updated.'){
  if(!event?.cloud?.eventId)throw new Error('Sync this tournament to Fairway One Cloud first.');
  if(hasPendingSync()){const ok=await flushPendingSyncs();if(!ok&&hasPendingSync())throw new Error('Fairway One still has local scores waiting to sync. Reconnect before changing tournament controls.')}
  await tournamentAdminAction(event.cloud.eventId,action,payload);
  await refreshCloud({silent:true});
  const refreshed=state.events.find(x=>x.cloud?.eventId===event.cloud?.eventId||x.id===event.id);if(refreshed){state.activeEventId=refreshed.id;if(ui.eventView)ui.eventView=refreshed.id;saveState()}
  render();if(success)toast(success);return refreshed||event;
}
async function openSpectatorInviteModal(event){
  if(!cloud.session)return openCloudAuthModal('Sign in to share the live spectator view.');
  try{event=await ensureSpectatorCode(event)}catch(err){return toast(`Spectator view unavailable: ${escapeHtml(err.message||'Unknown error')}`)}
  const code=event.cloud?.spectatorCode,url=spectatorInviteUrl(event);if(!code)return toast('Spectator link is still being generated.');
  modalRoot.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-sheet invite-sheet"><div class="modal-handle"></div><div class="modal-title-row"><div><p class="eyebrow">LIVE SPECTATOR VIEW</p><h2>Share the tournament, not the scoring controls.</h2><p class="body-copy">Anyone with this link can follow the live leaderboard, field status, groups, announcements and published results. They cannot join the event or enter scores.</p></div><button class="modal-close" data-modal-close>×</button></div><div class="invite-qr-wrap"><div class="invite-qr"><img id="spectatorQr" alt="Fairway One spectator QR code"></div><div class="invite-code"><span>VIEW STATUS</span><strong>${event.spectatorEnabled?'LIVE':'OFF'}</strong><small>${escapeHtml(event.name)}</small></div></div><div class="invite-link"><span>SPECTATOR LINK</span><p>${escapeHtml(url)}</p></div><div class="spectator-control-row"><button class="secondary-btn" id="toggleSpectator">${event.spectatorEnabled?'Disable view':'Enable view'}</button><button class="ghost-btn" id="rotateSpectator">Rotate link</button></div><div class="modal-actions"><button class="secondary-btn" id="copySpectatorLink">Copy link</button><button class="primary-btn gold" id="shareSpectatorLink">Share live scores</button></div></section></div>`;
  bindInfoModal();
  try{const qr=await QRCode.toDataURL(url,{width:360,margin:2,errorCorrectionLevel:'M'});const img=modalRoot.querySelector('#spectatorQr');if(img)img.src=qr}catch{}
  modalRoot.querySelector('#copySpectatorLink')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(url);toast('Spectator link copied.')}catch{toast('Copy the spectator link shown above.')}});
  modalRoot.querySelector('#shareSpectatorLink')?.addEventListener('click',async()=>{const text=`Follow ${event.name} live on Fairway One.`;if(navigator.share){try{await navigator.share({title:`Fairway One · ${event.name}`,text,url});return}catch{}}try{await navigator.clipboard.writeText(`${text}\n${url}`);toast('Spectator link copied.')}catch{}});
  modalRoot.querySelector('#toggleSpectator')?.addEventListener('click',async()=>{try{await runTournamentAdmin(event,'set_spectator',{enabled:!event.spectatorEnabled},`Spectator view ${event.spectatorEnabled?'disabled':'enabled'}.`);closeModal()}catch(err){toast(escapeHtml(err.message||'Could not update spectator view.'))}});
  modalRoot.querySelector('#rotateSpectator')?.addEventListener('click',async()=>{if(!confirm('Rotate the spectator link? The old link will stop working.'))return;try{await runTournamentAdmin(event,'rotate_spectator_code',{},'New spectator link created.');closeModal();const refreshed=state.events.find(x=>x.cloud?.eventId===event.cloud?.eventId)||event;openSpectatorInviteModal(refreshed)}catch(err){toast(escapeHtml(err.message||'Could not rotate link.'))}});
}
function openAnnouncementModal(event){
  modalRoot.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-sheet"><div class="modal-handle"></div><div class="modal-title-row"><div><p class="eyebrow">TOURNAMENT DESK</p><h2>Post an announcement</h2><p class="body-copy">The update appears immediately on player event passes and the public spectator view.</p></div><button class="modal-close" data-modal-close>×</button></div><div class="form-section"><div class="field full-span"><label>Message</label><textarea id="announcementMessage" rows="5" maxlength="500" placeholder="Play has resumed. Please keep pace with the group ahead."></textarea></div><label class="toggle-card"><input type="checkbox" id="announcementImportant"><span><strong>Important update</strong><span>Highlights the message for players and spectators.</span></span></label></div><div class="modal-actions"><button class="secondary-btn" data-modal-close>Cancel</button><button class="primary-btn gold" id="postAnnouncementNow">Post update</button></div></section></div>`;
  bindInfoModal();modalRoot.querySelector('#announcementMessage')?.focus();
  modalRoot.querySelector('#postAnnouncementNow')?.addEventListener('click',async()=>{const message=modalRoot.querySelector('#announcementMessage')?.value.trim();if(!message)return toast('Enter an announcement.');try{await runTournamentAdmin(event,'announce',{message,kind:modalRoot.querySelector('#announcementImportant')?.checked?'important':'info'},'Announcement posted.');closeModal()}catch(err){toast(`Could not post update: ${escapeHtml(err.message||'Unknown error')}`)}});
}
function openPlayerStatusModal(event,playerId){
  const player=(event.players||[]).find(p=>p.id===playerId);if(!player)return toast('Player not found.');
  const current=player.competitionStatus||'active';
  modalRoot.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-sheet"><div class="modal-handle"></div><div class="modal-title-row"><div><p class="eyebrow">FIELD CONTROL</p><h2>${escapeHtml(player.name)}</h2><p class="body-copy">Update the player’s tournament status. Withdrawn, disqualified and no-show players stop contributing to completion checks and cannot enter further scores.</p></div><button class="modal-close" data-modal-close>×</button></div><div class="form-section"><div class="form-grid"><div class="field full-span"><label>Tournament status</label><select id="playerCompetitionStatus"><option value="active" ${current==='active'?'selected':''}>Active</option><option value="withdrawn" ${current==='withdrawn'?'selected':''}>Withdrawn (WD)</option><option value="disqualified" ${current==='disqualified'?'selected':''}>Disqualified (DQ)</option><option value="no_show" ${current==='no_show'?'selected':''}>No show (NS)</option></select></div><div class="field full-span"><label>Reason / note</label><input id="playerStatusReason" maxlength="180" value="${escapeHtml(player.statusNote||'')}" placeholder="Required when removing a player from the active field"></div></div><p class="course-note">Returning the player to Active re-enables scoring. Every status change is recorded in the audit trail.</p></div><div class="modal-actions"><button class="secondary-btn" data-modal-close>Cancel</button><button class="primary-btn gold" id="applyPlayerStatus">Save status</button></div></section></div>`;
  bindInfoModal();
  modalRoot.querySelector('#applyPlayerStatus')?.addEventListener('click',async()=>{const status=modalRoot.querySelector('#playerCompetitionStatus')?.value||'active',reason=modalRoot.querySelector('#playerStatusReason')?.value.trim()||'';if(status!=='active'&&reason.length<3)return toast('Add a short reason for this status change.');if(status!==current&&!confirm(`Set ${player.name} to ${competitionStatusMeta(status).label}?`))return;try{await runTournamentAdmin(event,'set_player_status',{playerId:cloudPlayerId(event,player.id),status,reason},`${player.name} is now ${competitionStatusMeta(status).label.toLowerCase()}.`);closeModal()}catch(err){toast(`Status update failed: ${escapeHtml(err.message||'Unknown error')}`)}});
}
function openAdminFinalizeCardModal(event,playerId){
  const player=(event.players||[]).find(p=>p.id===playerId);if(!player)return toast('Player not found.');
  const progress=playerProgress(event,player);if(progress<18)return toast('Confirm all 18 holes before finalizing this card.');
  modalRoot.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-sheet"><div class="modal-handle"></div><div class="modal-title-row"><div><p class="eyebrow">OFFICIAL CARD CONTROL</p><h2>Finalize ${escapeHtml(player.name)}'s card</h2><p class="body-copy">Use this when the organiser has checked the completed card outside the normal player/marker flow. The action is recorded in the audit trail.</p></div><button class="modal-close" data-modal-close>×</button></div><div class="form-section"><div class="field full-span"><label>Verification note</label><input id="finalizeCardReason" maxlength="160" placeholder="Paper card checked against scorer"></div><p class="course-note">${progress}/18 holes confirmed. This card will become SIGNED · FINAL.</p></div><div class="modal-actions"><button class="secondary-btn" data-modal-close>Cancel</button><button class="primary-btn gold" id="finalizeCardNow">Finalize card</button></div></section></div>`;
  bindInfoModal();modalRoot.querySelector('#finalizeCardReason')?.focus();
  modalRoot.querySelector('#finalizeCardNow')?.addEventListener('click',async()=>{const reason=modalRoot.querySelector('#finalizeCardReason')?.value.trim();if(!reason)return toast('Add a verification note.');if(!confirm(`Finalize ${player.name}'s scorecard?`))return;try{await runTournamentAdmin(event,'finalize_player_card',{playerId:cloudPlayerId(event,player.id),reason},'<strong>Scorecard finalized.</strong>');closeModal()}catch(err){toast(`Could not finalize card: ${escapeHtml(err.message||'Unknown error')}`)}});
}
function openScoreOverrideModal(event){
  const players=event.players||[];if(!players.length)return toast('There are no players in this tournament.');
  modalRoot.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-sheet"><div class="modal-handle"></div><div class="modal-title-row"><div><p class="eyebrow">OFFICIAL CORRECTION</p><h2>Override a score</h2><p class="body-copy">Use this only for an organiser-approved correction. Every change is recorded in the tournament audit trail.</p></div><button class="modal-close" data-modal-close>×</button></div><div class="form-section"><div class="form-grid"><div class="field full-span"><label>Player</label><select id="overridePlayer">${players.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}</select></div><div class="field"><label>Hole</label><input id="overrideHole" type="number" min="1" max="18" value="1"></div><div class="field"><label>Gross score</label><input id="overrideGross" type="number" min="1" max="30" value="4"></div><div class="field full-span"><label>Reason</label><input id="overrideReason" maxlength="160" placeholder="Marker confirmed score was entered incorrectly"></div></div><p class="course-note" id="overrideCurrent"></p></div><div class="modal-actions"><button class="secondary-btn" data-modal-close>Cancel</button><button class="primary-btn gold" id="applyOverride">Apply official correction</button></div></section></div>`;
  bindInfoModal();const playerEl=modalRoot.querySelector('#overridePlayer'),holeEl=modalRoot.querySelector('#overrideHole'),grossEl=modalRoot.querySelector('#overrideGross'),current=modalRoot.querySelector('#overrideCurrent');
  const refresh=()=>{const p=players.find(x=>x.id===playerEl.value),h=Math.max(1,Math.min(18,Number(holeEl.value||1))),v=p?scoreFor(event,p.id,h):null;if(current)current.textContent=`Current score: ${v==null?'not entered':isPickup(v)?'Pick up / 0 pts':v} · Hole ${h}`;if(v!=null)grossEl.value=v};playerEl.addEventListener('change',refresh);holeEl.addEventListener('change',refresh);refresh();
  modalRoot.querySelector('#applyOverride')?.addEventListener('click',async()=>{const player=players.find(p=>p.id===playerEl.value),hole=Number(holeEl.value),gross=Number(grossEl.value),reason=modalRoot.querySelector('#overrideReason')?.value.trim();if(!player||!reason)return toast('Choose a player and add the correction reason.');if(!confirm(`Change ${player.name}'s score on hole ${hole} to ${gross}?`))return;try{await runTournamentAdmin(event,'override_score',{playerId:cloudPlayerId(event,player.id),hole,gross,reason},'Official score correction saved.');closeModal()}catch(err){toast(`Correction failed: ${escapeHtml(err.message||'Unknown error')}`)}});
}
function exportTournamentCsv(event){
  const q=v=>`"${String(v??'').replaceAll('"','""')}"`,headers=['Group','Tee time','Player','HCP',...Array.from({length:18},(_,i)=>`H${i+1}`),'Gross','Net','To Par','Stableford','Competition status','Card status'];
  const rows=(event.players||[]).map(p=>{const g=playerGroup(event,p.id),stroke=strokeStats(event,p),stable=stablefordStats(event,p),card=cardForPlayer(event,p),competition=competitionStatusMeta(p.competitionStatus||'active');return [g?.name||'',g?.teeTime||event.teeTime,p.name,Number(p.hcp||0).toFixed(1),...Array.from({length:18},(_,i)=>(isPickup(scoreFor(event,p.id,i+1))?'P/U':scoreFor(event,p.id,i+1)??'')),stroke.pickups?'N/A':stroke.gross||'',stroke.pickups?'N/A':stroke.net||'',stroke.pickups?'N/A':stroke.holes?signed(stroke.toPar):'',stable.points||0,competition.label,card?.status||((playerProgress(event,p)>=18)?'finished':'playing')]});
  const csv=[headers,...rows].map(r=>r.map(q).join(',')).join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${String(event.name||'fairway-one-tournament').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase()}-results.csv`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200);toast('Tournament results exported.');
}

function playerCardRows(event,player){
  return (event.course?.holes||[]).map(h=>{const gross=scoreFor(event,player.id,h.number),net=holeNet(event,player,h.number),pts=holeStableford(event,player,h.number);return `<div class="card-review-row"><span>${h.number}</span><span>Par ${h.par}</span><strong>${gross==null?'—':isPickup(gross)?'P/U':gross}</strong><span>${net==null?'—':`Net ${net}`}</span><span>${pts==null?'—':`${pts} pts`}</span></div>`}).join('')
}
function teamCardRows(event,team){
  return (event.course?.holes||[]).map(h=>{const gross=teamScoreFor(event,team.id,h.number);return `<div class="card-review-row team"><span>${h.number}</span><span>Par ${h.par}</span><strong>${gross==null?'—':isPickup(gross)?'P/U':gross}</strong><span>${gross==null?'—':signed(gross-h.par)}</span><span>Team</span></div>`}).join('')
}
function customPlayerCardRows(event,player){
  return (event.course?.holes||[]).map(h=>{const key=formatKeyForHole(event,h.number),info=formatInfo(key);if(info.entry==='team'&&player.teamId){const gross=teamScoreFor(event,player.teamId,h.number);return `<div class="card-review-row team"><span>${h.number}</span><span>Par ${h.par}</span><strong>${gross==null?'—':isPickup(gross)?'P/U':gross}</strong><span>${gross==null?'—':signed(gross-h.par)}</span><span>${escapeHtml(info.short)}</span></div>`}const gross=scoreFor(event,player.id,h.number),net=holeNet(event,player,h.number),pts=holeStableford(event,player,h.number);return `<div class="card-review-row"><span>${h.number}</span><span>Par ${h.par}</span><strong>${gross==null?'—':isPickup(gross)?'P/U':gross}</strong><span>${net==null?'—':`Net ${net}`}</span><span>${pts==null?escapeHtml(info.short):`${pts} pts`}</span></div>`}).join('')
}
function openSubmitCardModal(event){
  if(!cloud.session||!event.cloud?.synced)return toast('Cloud sync is required to submit and verify a scorecard.');
  const me=selfPlayer(event);if(!me)return openClaimPlayerModal(event.id);
  const info=formatInfo(event.format),team=me.teamId?(event.teams||[]).find(t=>t.id===me.teamId):null,isTeam=event.format!=='custom'&&info.entry==='team',isCustom=event.format==='custom';
  if(isTeam&&!team)return toast('Your team is not linked to this event.');
  const existing=isTeam?cardForTeam(event,team):cardForPlayer(event,me);if(existing?.status==='final')return toast('This scorecard is already signed and final.');if(existing?.status==='awaiting_verification')return toast('Your scorecard is already awaiting verification.');
  const complete=isTeam?(event.teamConfirmedHoles?.[team.id]||[]).length>=holeCount(event):selfCardComplete(event,me);if(!complete)return toast(`Confirm all ${holeCount(event)} holes before submitting your card.`);
  const rows=isTeam?teamCardRows(event,team):(isCustom?customPlayerCardRows(event,me):playerCardRows(event,me));const candidates=isTeam?[]:markerCandidates(event,me);
  const markerSelect=isTeam?'':`<div class="field full-span"><label>Your marker</label><select id="cardMarker"><option value="">Any joined golfer in my group</option>${candidates.map(p=>`<option value="${cloudPlayerId(event,p.id)}">${escapeHtml(p.name)}</option>`).join('')}</select><p class="course-note">Choose the golfer who checked your card. If you leave this open, another joined golfer in your group or the organiser can verify it.</p></div>`;
  modalRoot.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-sheet scorecard-sheet"><div class="modal-handle"></div><div class="modal-title-row"><div><p class="eyebrow">DIGITAL SCORECARD</p><h2>${isTeam?'Finalize team card':'Submit your scorecard'}</h2><p class="body-copy">Review the card before it is sent for verification. Once verified it becomes final.</p></div><button class="modal-close" data-modal-close>×</button></div><div class="scorecard-review-head"><strong>${escapeHtml(isTeam?team.name:me.name)}</strong><span>${escapeHtml(event.course.name)} · ${escapeHtml(formatInfo(event.format).name)}</span></div><div class="card-review-table"><div class="card-review-row head"><span>Hole</span><span>Par</span><strong>Score</strong><span>Net / +/-</span><span>Pts</span></div>${rows}</div>${markerSelect}<div class="scorecard-declaration"><strong>${isTeam?'Team declaration':'Player declaration'}</strong><p>${isTeam?'We confirm this shared team card reflects the scores entered for the round.':'I confirm the scores above are correct and ready for my marker to verify.'}</p></div><div class="modal-actions"><button class="secondary-btn" data-modal-close>Back</button><button class="primary-btn gold" id="submitScorecardNow">${isTeam?'Finalize card':'Submit for verification'}</button></div></section></div>`;
  bindInfoModal();
  modalRoot.querySelector('#submitScorecardNow')?.addEventListener('click',async()=>{const marker=isTeam?null:(modalRoot.querySelector('#cardMarker')?.value||null);try{await syncEvent(event,state.profile,{structure:false});await submitScorecard(event.cloud.eventId,isTeam?'team':'player',isTeam?cloudTeamId(event,team.id):cloudPlayerId(event,me.id),marker);closeModal();await refreshCloud({silent:true});const refreshed=state.events.find(x=>x.cloud?.eventId===event.cloud?.eventId||x.id===event.id);ui.tab='events';ui.eventView=refreshed?.id||event.id;render();toast(isTeam?'<strong>Team card final.</strong>':'<strong>Scorecard submitted.</strong> Awaiting marker verification.')}catch(err){toast(`Could not submit card: ${escapeHtml(err.message||'Unknown error')}`)}})
}
function openVerifyCardModal(event,cardId){
  const card=(event.scorecards||[]).find(c=>c.id===cardId);if(!card)return toast('That scorecard is no longer awaiting verification.');
  const player=playerForCloudId(event,card.playerId);if(!player)return toast('Player scorecard not found.');
  modalRoot.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-sheet scorecard-sheet"><div class="modal-handle"></div><div class="modal-title-row"><div><p class="eyebrow">MARKER VERIFICATION</p><h2>Check ${escapeHtml(player.name)}’s card.</h2><p class="body-copy">Review the hole-by-hole scores. Verifying signs the digital card and marks it final.</p></div><button class="modal-close" data-modal-close>×</button></div><div class="scorecard-review-head">${avatar(player)}<div><strong>${escapeHtml(player.name)}</strong><span>${escapeHtml(event.course.name)}</span></div></div><div class="card-review-table"><div class="card-review-row head"><span>Hole</span><span>Par</span><strong>Score</strong><span>Net</span><span>Pts</span></div>${event.format==='custom'?customPlayerCardRows(event,player):playerCardRows(event,player)}</div><div class="scorecard-declaration marker"><strong>Marker declaration</strong><p>By verifying, I confirm this card matches the scores I checked with the player.</p></div><div class="modal-actions"><button class="secondary-btn" data-modal-close>Not yet</button><button class="primary-btn gold" id="verifyScorecardNow">Verify & sign</button></div></section></div>`;
  bindInfoModal();
  modalRoot.querySelector('#verifyScorecardNow')?.addEventListener('click',async()=>{try{await verifyScorecard(card.id);closeModal();await refreshCloud({silent:true});const refreshed=state.events.find(x=>x.cloud?.eventId===event.cloud?.eventId||x.id===event.id);ui.tab='events';ui.eventView=refreshed?.id||event.id;render();toast('<strong>Scorecard verified.</strong> Card is now final.')}catch(err){toast(`Verification failed: ${escapeHtml(err.message||'Unknown error')}`)}})
}
async function autoClaimMatchingPlayer(event){
  if(!event||selfPlayer(event)||!cloud.session)return false;
  const wanted=(state.profile.name||'').trim().toLowerCase();if(!wanted)return false;
  const matches=(event.players||[]).filter(p=>!p.claimed&&!p.userId&&(p.competitionStatus||'active')==='active'&&(p.name||'').trim().toLowerCase()===wanted);
  if(matches.length!==1)return false;
  try{await claimEventPlayer(event.cloud?.eventId||event.id,matches[0].id);await refreshCloud({silent:true});return true}catch{return false}
}
async function completePendingJoin(){
  if(!pendingJoinCode)return;
  if(!cloud.session)return openCloudAuthModal('Sign in or create your Fairway One account to join this event.');
  const code=pendingJoinCode;
  try{
    const joined=await joinEventByCode(code);pendingJoinCode='';history.replaceState({},'',location.pathname);await refreshCloud({silent:true});let evt=state.events.find(x=>x.cloud?.eventId===joined.event?.id||x.id===joined.event?.id);if(!evt)return toast('Event joined. Open Events to continue.');state.activeEventId=evt.id;saveState();if(!selfPlayer(evt)){const linked=await autoClaimMatchingPlayer(evt);if(linked)evt=state.events.find(x=>x.cloud?.eventId===joined.event?.id||x.id===joined.event?.id)||evt}if(!selfPlayer(evt))return openClaimPlayerModal(evt.id);ui.tab='events';ui.eventView=evt.id;render();toast(`<strong>Joined ${escapeHtml(evt.name)}.</strong> Your player entry is linked.`)
  }catch(err){toast(`Could not join event: ${escapeHtml(err.message||'Unknown error')}`)}
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
      const joined=await joinEventByCode(code);closeModal();await refreshCloud({silent:true});let evt=state.events.find(x=>x.cloud?.eventId===joined.event?.id||x.id===joined.event?.id);if(!evt)return toast('Event joined. Refresh Events to continue.');state.activeEventId=evt.id;saveState();if(!selfPlayer(evt)){const linked=await autoClaimMatchingPlayer(evt);if(linked)evt=state.events.find(x=>x.cloud?.eventId===joined.event?.id||x.id===joined.event?.id)||evt}toast(`<strong>Joined ${escapeHtml(evt.name)}.</strong>`);if(!selfPlayer(evt))return openClaimPlayerModal(evt.id);ui.tab='events';ui.eventView=evt.id;return render()
    }catch(err){toast(`Could not join event: ${escapeHtml(err.message||'Unknown error')}`)}
  });
}
function openClaimPlayerModal(eventId){
  const evt=state.events.find(x=>x.id===eventId)||activeEvent();if(!evt)return;
  if(selfPlayer(evt)){closeModal();return switchTab('play')}
  if(!cloud.session)return openCloudAuthModal('Sign in to link your player entry.');
  const available=(evt.players||[]).filter(p=>!p.claimed&&!p.userId&&(p.competitionStatus||'active')==='active');
  const rows=available.length?available.map(p=>`<button class="claim-player-option" data-claim-player-id="${p.id}">${avatar(p)}<span><strong>${escapeHtml(p.name)}</strong><small>HCP ${Number(p.hcp||0).toFixed(1)}${playerGroup(evt,p.id)?` · ${escapeHtml(playerGroup(evt,p.id).name)}`:''}</small></span><b>Choose →</b></button>`).join(''):`<div class="empty-card"><h3>No unclaimed players.</h3><p>Ask the organiser to add you to the field or check that another account has not already claimed your name.</p></div>`;
  modalRoot.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-sheet"><div class="modal-handle"></div><div class="modal-title-row"><div><p class="eyebrow">YOUR SCORECARD</p><h2>Which player are you?</h2><p class="body-copy">This permanently links your Fairway One account to your player entry for this event. You will then score only yourself. Shared-ball team formats use your team's scorecard.</p></div><button class="modal-close" data-modal-close>×</button></div><div class="claim-player-list">${rows}</div><div class="modal-actions single"><button class="secondary-btn" data-modal-close>Cancel</button></div></section></div>`;
  bindInfoModal();
  modalRoot.querySelectorAll('[data-claim-player-id]').forEach(btn=>btn.addEventListener('click',async()=>{
    try{await claimEventPlayer(evt.cloud?.eventId||evt.id,btn.dataset.claimPlayerId);closeModal();await refreshCloud({silent:true});const refreshed=state.events.find(x=>x.cloud?.eventId===(evt.cloud?.eventId||evt.id)||x.id===evt.id);if(refreshed)state.activeEventId=refreshed.id;saveState();toast('<strong>Player linked.</strong> Your event pass is ready.');ui.tab='events';ui.eventView=refreshed?.id||evt.id;app.scrollTop=0;render()}catch(err){toast(`Could not link player: ${escapeHtml(err.message||'Unknown error')}`)}
  }));
}

function openEventModal(eventId=null,forceCustom=false){const source=eventId?state.events.find(e=>e.id===eventId):null;const draft=source?structuredClone(source):{id:uid('event'),name:'',date:isoDate(),teeTime:'07:00',status:'live',eventMode:'round',ambroseMode:'single',format:forceCustom?'custom':'stableford',course:{name:'',tee:'White',holes:defaultHoles(),saveToLibrary:false},players:[{id:uid('p'),name:state.profile.name||'Golfer',hcp:Number(state.profile.hcp||0),tone:1,teamId:'team_a',avatarPath:state.profile.avatarPath||'',isSelf:true}],teams:createTeams(),scores:{},teamScores:{team_a:{},team_b:{}},playerStats:{},playerConfirmedHoles:{},playerCurrentHoles:{},teamStats:{},teamConfirmedHoles:{},teamCurrentHoles:{},trackStats:false,advancedStats:false,sideGames:{ntpHole:0,ntpPlayerId:null,ldHole:0,ldPlayerId:null},driveSelections:{team_a:{},team_b:{}},customSegments:forceCustom?defaultCustomSegments():[],minDrives:3,currentHole:1,confirmedHoles:[],createdAt:new Date().toISOString()};draft.eventMode ||= 'round';draft.ambroseMode ||= 'single';draft.trackStats=!!draft.trackStats;draft.advancedStats=!!draft.advancedStats;draft.sideGames ||= {ntpHole:0,ntpPlayerId:null,ldHole:0,ldPlayerId:null};draft.playerStats ||= {};draft.teamStats ||= {};draft.course.saveToLibrary=!!draft.course.saveToLibrary;ensureTeams(draft);ensureCustomSegments(draft);ui.modal={type:'event',view:'setup',draft,editing:!!source};renderEventModal()}

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
function roundHasScores(event){
  return (event.confirmedHoles||[]).length>0||Object.values(event.scores||{}).some(scores=>Object.keys(scores).length)||Object.values(event.teamScores||{}).some(scores=>Object.keys(scores).length);
}
function setRoundHoleCount(d,count){
  if(count===holeCount(d))return;
  if(roundHasScores(d))return;
  const old=d.course.holes;
  if(count===9){
    d.course.holes=old.slice(0,9).map(h=>({...h}));
    const ranked=[...d.course.holes].sort((a,b)=>Number(a.si)-Number(b.si));
    ranked.forEach((h,i)=>h.si=i+1);
  }else{
    const defaults=defaultHoles();
    d.course.holes=[...old.map(h=>({...h})),...defaults.slice(9)];
    const ranked=[...d.course.holes].sort((a,b)=>Number(a.si)-Number(b.si)||a.number-b.number);
    ranked.forEach((h,i)=>h.si=i+1);
  }
  delete d.course.libraryCourseId;delete d.course.libraryTeeId;d.course.libraryVerified=false;
  if(d.cloud){d.cloud.courseId=null;d.cloud.teeId=null}
  d.currentHole=1;d.sideGames ||= {};if(d.sideGames.ntpHole>count){d.sideGames.ntpHole=0;d.sideGames.ntpPlayerId=null}if(d.sideGames.ldHole>count){d.sideGames.ldHole=0;d.sideGames.ldPlayerId=null}
  ensureCustomSegments(d);
  if(count===18&&d.format==='custom'&&d.customSegments.length){const assigned=new Set(customAssignedHoles(d));d.customSegments[0].holes.push(...defaultHoles().slice(9).map(h=>h.number).filter(h=>!assigned.has(h)));d.customSegments[0].holes.sort((a,b)=>a-b)}
}
function courseLibraryStatus(course){
  if(course?.libraryCourseId)return `<p class="course-library-note">${course.libraryVerified?'✓ Verified course':'Community course'} · Hole data is loaded from the Fairway One library for this round.</p>`;
  return `<label class="toggle-card course-share-toggle"><input type="checkbox" data-course-share ${course?.saveToLibrary?'checked':''}><span><strong>Share this course with Fairway One</strong><span>Once saved to cloud, other golfers can select this course and tee. You remain the owner of the course record.</span></span></label>`;
}

function tournamentFormatOptions(selected){const allowed=['stableford','stroke','par_bogey','modified_stableford'];return allowed.map(k=>`<option value="${k}" ${selected===k?'selected':''}>${escapeHtml(formatInfo(k).name)}</option>`).join('')}
function tournamentGroupPreview(d){const sizes=tournamentGroupSizes((d.players||[]).length,d.groupSize,d.startType),groups=[];let offset=0;sizes.forEach(size=>{groups.push(d.players.slice(offset,offset+size));offset+=size});return groups}

function openTournamentModal(eventId=null){
  const source=eventId?state.events.find(e=>e.id===eventId):null;
  const draft=source?structuredClone(source):{
    id:uid('event'),name:'',date:isoDate(),teeTime:'07:00',status:'draft',eventMode:'tournament',format:'stableford',
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
  <div class="form-section"><h3>Hole setup</h3><div class="course-grid">${d.course.holes.map(h=>`<div class="hole-edit"><strong>Hole ${h.number}</strong><div class="tiny-grid labeled-hole-grid"><label><span>Par</span><input type="number" min="3" max="6" value="${h.par}" data-t-hole-par="${h.number}"></label><label><span>Index</span><input type="number" min="1" max="18" value="${h.si}" data-t-hole-si="${h.number}"></label><label><span>Metres</span><input type="number" min="0" max="1000" step="1" value="${h.distance??''}" placeholder="—" data-t-hole-distance="${h.number}"></label></div></div>`).join('')}</div><p class="course-note">Enter the tee-to-green distance for each hole in metres. It appears on the live scorecard and is saved with the event.</p></div>
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
  modalRoot.querySelectorAll('[data-t-hole-si]').forEach(x=>x.addEventListener('input',()=>{const h=d.course.holes.find(h=>h.number===Number(x.dataset.tHoleSi));if(h)h.si=Math.max(1,Math.min(18,Number(x.value)||1))}));modalRoot.querySelectorAll('[data-t-hole-distance]').forEach(x=>x.addEventListener('input',()=>{const h=d.course.holes.find(h=>h.number===Number(x.dataset.tHoleDistance));if(h)h.distance=Math.max(0,Math.min(1000,Number(x.value)||0))}));
  modalRoot.querySelector('[data-t-save]')?.addEventListener('click',saveTournamentDraft);modalRoot.querySelector('[data-delete-event]')?.addEventListener('click',deleteEditingEvent);
}
function saveTournamentDraft(){
  const m=ui.modal,d=m.draft;
  if(!d.name.trim())return toast('Give the tournament a name.');
  if(!d.course.name.trim())return toast('Enter a course name.');
  if(d.players.length<2||d.players.length>MAX_TOURNAMENT_PLAYERS)return toast(`Tournament mode supports 2–${MAX_TOURNAMENT_PLAYERS} players.`);
  if(d.players.some(p=>!p.name.trim()))return toast('Every player needs a name.');
  const normalizedNames=d.players.map(p=>p.name.trim().toLowerCase());
  if(new Set(normalizedNames).size!==normalizedNames.length)return toast('Tournament player display names must be unique. Add an initial or other identifier to duplicate names.');
  const indexes=(d.course.holes||[]).map(h=>Number(h.si));
  if((d.course.holes||[]).length!==18||indexes.some(x=>!Number.isInteger(x)||x<1||x>18)||new Set(indexes).size!==18)return toast('Tournament stroke indexes must use every number from 1 to 18 exactly once.');
  const previewGroups=tournamentGroupPreview(d);
  if(!previewGroups.length)return toast(d.groupSize===2?'Two-player groups require an even number of golfers. Choose groups of 3 or 4, or add another player.':'The field cannot be split into valid scoring groups.');
  if(d.startType!=='shotgun'&&previewGroups.some(g=>g.length<2||g.length>4))return toast('Every tee-time group must contain 2–4 golfers.');
  if(d.startType==='shotgun'){
    d.groupSize=4;
    const groups=previewGroups;
    if(groups.length>18)return toast('A shotgun start supports a maximum of 18 scoring groups.');
    groups.forEach((_,i)=>{d.groupStartHoles ||= {};d.groupStartHoles[i+1]=Math.max(1,Math.min(18,Number(d.groupStartHoles[i+1]||((i%18)+1))))});
    const starts=groups.map((_,i)=>Number(d.groupStartHoles[i+1]));
    if(new Set(starts).size!==starts.length)return toast('Each shotgun group needs its own starting hole. Choose a unique hole for every group.');
  }
  d.eventMode='tournament';d.status=d.status==='complete'?'complete':(d.status==='live'?'live':'draft');d.trackStats=!!d.trackStats;
  d.players.forEach((p,i)=>{p.tone=(i%6)+1;p.teamId=null});d.scores ||= {};d.playerStats ||= {};d.playerConfirmedHoles ||= {};d.playerCurrentHoles ||= {};
  d.players.forEach(p=>{d.scores[p.id] ||= {};d.playerStats[p.id] ||= {};d.playerConfirmedHoles[p.id] ||= []});
  Object.keys(d.scores).forEach(pid=>{if(!d.players.some(p=>p.id===pid))delete d.scores[pid]});
  Object.keys(d.playerStats).forEach(pid=>{if(!d.players.some(p=>p.id===pid))delete d.playerStats[pid]});
  buildTournamentGroups(d);d.confirmedHoles=[];d.currentHole=1;
  const idx=state.events.findIndex(e=>e.id===d.id);if(idx>=0)state.events[idx]=d;else state.events.unshift(d);state.activeEventId=d.id;saveState();queueCloudSync(d,{structure:true,immediate:true});closeModal();switchTab('play');toast(m.editing?'Tournament updated.':'<strong>Tournament created.</strong> Group scorecards ready.');
}

function formatOptions(selected){const groups={};standaloneFormats().forEach(([k,v])=>(groups[v.category] ||= []).push([k,v]));return `<optgroup label="Fairway One"><option value="custom" ${selected==='custom'?'selected':''}>Build Your Round · Custom</option></optgroup>`+Object.entries(groups).map(([g,items])=>`<optgroup label="${escapeHtml(g)}">${items.map(([k,v])=>`<option value="${k}" ${selected===k?'selected':''}>${escapeHtml(v.name)}</option>`).join('')}</optgroup>`).join('')}
function segmentFormatOptions(selected){return standaloneFormats().map(([k,v])=>`<option value="${k}" ${selected===k?'selected':''}>${escapeHtml(v.name)}</option>`).join('')}

function sideGameHoleOptions(d,type){
  const selected=Number(type==='ntp'?d.sideGames?.ntpHole:d.sideGames?.ldHole)||0,holes=(d.course?.holes||[]).filter(h=>type==='ntp'?Number(h.par)===3:Number(h.par)>=4);
  return `<option value="0" ${selected===0?'selected':''}>Off</option>${holes.map(h=>`<option value="${h.number}" ${selected===Number(h.number)?'selected':''}>Hole ${h.number} · Par ${h.par}</option>`).join('')}`;
}
function renderSideGameSetup(d){
  d.sideGames ||= {ntpHole:0,ntpPlayerId:null,ldHole:0,ldPlayerId:null};
  return `<div class="form-section side-game-setup"><div class="section-head"><div><h3>Side competitions</h3><p class="muted-note">Optional extras for your group. Fairway One keeps them separate from the official format.</p></div><span class="elite-badge">ELITE</span></div><div class="form-grid"><div class="field"><label>Nearest the pin</label><select data-side-hole="ntpHole">${sideGameHoleOptions(d,'ntp')}</select></div><div class="field"><label>Longest drive</label><select data-side-hole="ldHole">${sideGameHoleOptions(d,'ld')}</select></div></div></div>`;
}

function renderEventModal(){
  const m=ui.modal;if(!m||m.type!=='event')return;if(m.view==='builder')return renderCustomBuilderModal();
  const d=m.draft;ensureCustomSegments(d);ensureTeams(d);d.ambroseMode ||= 'single';
  const info=formatInfo(d.format),teamMode=eventUsesTeams(d),ambroseSingle=d.format==='ambrose'&&d.ambroseMode==='single',showTeamSelect=teamMode&&!ambroseSingle;
  const minPlayers=d.format==='custom'?1:ambroseSingle?2:d.format==='ambrose'?4:info.minPlayers;
  const maxPlayers=d.format==='custom'?8:ambroseSingle?4:info.maxPlayers;
  if(ambroseSingle)d.players.forEach(p=>p.teamId='team_a');
  const players=d.players.map((p,i)=>`<div class="player-edit-row ${showTeamSelect?'with-team':''}"><input value="${escapeHtml(p.name)}" data-player-name="${p.id}" aria-label="Player name"><input type="number" min="0" max="54" value="${p.hcp}" data-player-hcp="${p.id}" aria-label="Handicap">${showTeamSelect?`<select data-player-team="${p.id}">${d.teams.map(t=>`<option value="${t.id}" ${p.teamId===t.id?'selected':''}>${escapeHtml(t.name)}</option>`).join('')}</select>`:''}<button data-remove-player="${p.id}" ${d.players.length<=minPlayers?'disabled':''}>×</button></div>`).join('');
  const holes=d.course.holes.map(h=>`<div class="hole-edit"><strong>Hole ${h.number}</strong><div class="tiny-grid labeled-hole-grid"><label><span>Par</span><input type="number" min="3" max="6" value="${h.par}" data-hole-par="${h.number}"></label><label><span>Index</span><input type="number" min="1" max="${holeCount(d)}" value="${h.si}" data-hole-si="${h.number}"></label><label><span>Metres</span><input type="number" min="0" max="1000" step="1" value="${h.distance??''}" placeholder="—" data-hole-distance="${h.number}"></label></div></div>`).join('');
  const anyAmbrose=d.format==='ambrose'||(d.format==='custom'&&d.customSegments.some(seg=>seg.format==='ambrose'));
  const teamsToShow=ambroseSingle?[d.teams[0]]:d.teams;
  const teamSettings=teamMode?`<div class="form-section"><h3>${ambroseSingle?'Team settings':'Teams'}</h3><div class="form-grid">${teamsToShow.map(t=>`<div class="field ${ambroseSingle?'full-span':''}"><label>${ambroseSingle?'Team handicap allowance':`${escapeHtml(t.name)} handicap allowance`}</label><input type="number" step="0.1" data-team-hcp="${t.id}" value="${Number(t.teamHcp||0)}"></div>`).join('')}${anyAmbrose?`<div class="field full-span"><label>Minimum selected drives per player</label><input type="number" min="0" max="${holeCount(d)}" data-min-drives value="${Number(d.minDrives||0)}"></div>`:''}</div><p class="course-note">Team handicap rules vary by competition. Enter the allowance being used for this event.</p></div>`:'';
  const formatBlock=d.format==='custom'?`<div class="custom-format-preview"><div><span class="guide-status build">CUSTOM BUILDER</span><strong>${d.customSegments.length} segment${d.customSegments.length===1?'':'s'} · ${customAssignedHoles(d).length}/${holeCount(d)} holes assigned</strong><p>Mix formats across any holes. The live scorecard will switch automatically when the format changes.</p></div><button class="primary-btn gold small-btn" data-open-custom-builder>Configure holes</button></div>`:`<div class="format-preview"><span class="guide-status live">Playable now</span><strong>${escapeHtml(info.name)}</strong><p>${escapeHtml(info.description)}</p></div>`;
  const ambroseSetup=d.format==='ambrose'?`<div class="form-section ambrose-mode-block"><h3>Ambrose scoring setup</h3><div class="field full-span"><label>Who are you scoring?</label><select data-ambrose-mode><option value="single" ${d.ambroseMode==='single'?'selected':''}>One team · score ourselves</option><option value="versus" ${d.ambroseMode==='versus'?'selected':''}>Two teams · head-to-head</option></select></div><p class="course-note">Choose one team for a social 2–4 player Ambrose. Choose two teams for a 4–8 player head-to-head Ambrose. Any linked team member can enter the shared team score.</p></div>`:'';
  modalRoot.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-sheet"><div class="modal-handle"></div><div class="modal-title-row"><div><p class="eyebrow">${m.editing?'EDIT EVENT':'NEW EVENT'}</p><h2>${m.editing?'Event setup':'Build your round'}</h2><p class="body-copy">Choose one complete format or build a custom 9- or 18-hole competition.</p></div><button class="modal-close" data-modal-close>×</button></div><div class="form-section"><h3>Event</h3><div class="form-grid"><div class="field full-span"><label>Event name</label><input data-draft="name" value="${escapeHtml(d.name)}" placeholder="Sunday Golf"></div><div class="field"><label>Date</label><input type="date" data-draft="date" value="${d.date}"></div><div class="field"><label>Tee time</label><input type="time" data-draft="teeTime" value="${d.teeTime}"></div></div></div><div class="form-section"><h3>Round format</h3><div class="field full-span"><label>How do you want to play?</label><select data-format>${formatOptions(d.format)}</select></div>${formatBlock}<label class="toggle-card stats-toggle"><input type="checkbox" data-track-stats ${d.trackStats?'checked':''}><span><strong>Track round stats</strong><span>For individual formats, each signed-in golfer records their own putts, sand shots and penalties. Shared-ball formats record team stats.</span></span></label><label class="toggle-card stats-toggle advanced-toggle"><input type="checkbox" data-advanced-stats ${d.advancedStats?'checked':''}><span><strong>Elite performance stats</strong><span>Add optional fairway direction, GIR and up-and-down tracking. Keep this off when you want the fastest possible score entry.</span></span></label></div>${ambroseSetup}${renderSideGameSetup(d)}<div class="form-section"><h3>Course</h3><div class="field full-span"><label>Fairway One course library</label><select data-course-library>${courseLibraryOptions(d.course)}</select></div><div class="form-grid"><div class="field full-span"><label>Course name</label><input data-course="name" value="${escapeHtml(d.course.name)}" placeholder="Course name" ${courseLibraryKey(d.course)?'readonly':''}></div><div class="field"><label>Tee</label><input data-course="tee" value="${escapeHtml(d.course.tee)}" ${courseLibraryKey(d.course)?'readonly':''}></div><div class="field"><label>Holes</label><select data-round-holes ${m.editing&&roundHasScores(d)?'disabled title="Hole count is fixed after scoring begins"':''}><option value="18" ${holeCount(d)===18?'selected':''}>18 holes</option><option value="9" ${holeCount(d)===9?'selected':''}>9 holes</option></select></div></div>${courseLibraryStatus(d.course)}</div><div class="form-section"><div class="section-head"><div><h3>Players</h3><p class="muted-note">${d.format==='custom'?'1–8 players. Each custom segment is checked against its selected format before saving.':ambroseSingle?'2–4 players in one Ambrose team.':d.format==='ambrose'?'4–8 players split across two Ambrose teams.':`${info.minPlayers}–${info.maxPlayers} players for ${escapeHtml(info.name)}.`}</p></div><button class="secondary-btn small-btn" data-add-player ${d.players.length>=maxPlayers?'disabled':''}>+ Player</button></div><div class="player-editor">${players}</div></div>${teamSettings}<div class="form-section"><h3>Hole setup</h3><div class="course-grid">${holes}</div><p class="course-note">Set each hole's par, stroke index and distance in metres. Use each index from 1 to ${holeCount(d)} once.</p></div>${m.editing?`<div class="form-section danger-zone"><h4>Danger zone</h4><p>Deletes this Fairway One event from this device and cloud if connected.</p><button class="danger-btn small-btn" data-delete-event>Delete event</button></div>`:''}<div class="modal-actions"><button class="secondary-btn" data-modal-close>Cancel</button><button class="primary-btn gold" data-save-event>${m.editing?'Save changes':'Create & start'}</button></div></section></div>`;
  bindEventModal();
}
function bindEventModal(){
  modalRoot.querySelectorAll('[data-modal-close]').forEach(x=>x.addEventListener('click',closeModal));modalRoot.querySelector('#modalBackdrop')?.addEventListener('click',e=>{if(e.target.id==='modalBackdrop')closeModal()});
  modalRoot.querySelector('[data-round-holes]')?.addEventListener('change',e=>{setRoundHoleCount(ui.modal.draft,Number(e.target.value));renderEventModal()});
  modalRoot.querySelectorAll('[data-draft]').forEach(x=>x.addEventListener('input',()=>ui.modal.draft[x.dataset.draft]=x.value));modalRoot.querySelectorAll('[data-course]').forEach(x=>x.addEventListener('input',()=>{const d=ui.modal.draft;d.course[x.dataset.course]=x.value;delete d.course.libraryCourseId;delete d.course.libraryTeeId;d.course.libraryVerified=false}));modalRoot.querySelector('[data-course-library]')?.addEventListener('change',e=>{applyCourseLibrarySelection(ui.modal.draft,e.target.value);renderEventModal()});modalRoot.querySelector('[data-course-share]')?.addEventListener('change',e=>ui.modal.draft.course.saveToLibrary=!!e.target.checked);modalRoot.querySelector('[data-track-stats]')?.addEventListener('change',e=>ui.modal.draft.trackStats=!!e.target.checked);modalRoot.querySelector('[data-advanced-stats]')?.addEventListener('change',e=>{ui.modal.draft.advancedStats=!!e.target.checked;if(e.target.checked)ui.modal.draft.trackStats=true});modalRoot.querySelectorAll('[data-side-hole]').forEach(x=>x.addEventListener('change',()=>{ui.modal.draft.sideGames ||= {ntpHole:0,ntpPlayerId:null,ldHole:0,ldPlayerId:null};ui.modal.draft.sideGames[x.dataset.sideHole]=Number(x.value)||0;if(x.dataset.sideHole==='ntpHole')ui.modal.draft.sideGames.ntpPlayerId=null;if(x.dataset.sideHole==='ldHole')ui.modal.draft.sideGames.ldPlayerId=null}));
  modalRoot.querySelector('[data-format]')?.addEventListener('change',e=>{const d=ui.modal.draft;d.format=e.target.value;ensureCustomSegments(d);if(d.format==='ambrose'){d.ambroseMode='single';d.players=d.players.slice(0,4);d.players.forEach(p=>p.teamId='team_a');while(d.players.length<2){const n=d.players.length+1;d.players.push({id:uid('p'),name:`Player ${n}`,hcp:18,tone:n,teamId:'team_a'})}}else if(d.format!=='custom'){const info=formatInfo(d.format);while(d.players.length>info.maxPlayers)d.players.pop();while(d.players.length<info.minPlayers){const n=d.players.length+1;d.players.push({id:uid('p'),name:`Player ${n}`,hcp:18,tone:n,teamId:n%2?'team_a':'team_b'})}}renderEventModal()});
  modalRoot.querySelector('[data-ambrose-mode]')?.addEventListener('change',e=>{const d=ui.modal.draft;d.ambroseMode=e.target.value;if(d.ambroseMode==='single'){d.players=d.players.slice(0,4);d.players.forEach(p=>p.teamId='team_a');while(d.players.length<2){const n=d.players.length+1;d.players.push({id:uid('p'),name:`Player ${n}`,hcp:18,tone:n,teamId:'team_a'})}}else{while(d.players.length<4){const n=d.players.length+1;d.players.push({id:uid('p'),name:`Player ${n}`,hcp:18,tone:n,teamId:n<=2?'team_a':'team_b'})}d.players=d.players.slice(0,8);const split=Math.ceil(d.players.length/2);d.players.forEach((p,i)=>p.teamId=i<split?'team_a':'team_b')}renderEventModal()});
  modalRoot.querySelector('[data-open-custom-builder]')?.addEventListener('click',()=>{ui.modal.view='builder';renderCustomBuilderModal()});
  modalRoot.querySelectorAll('[data-player-name]').forEach(x=>x.addEventListener('input',()=>{const p=ui.modal.draft.players.find(p=>p.id===x.dataset.playerName);if(p)p.name=x.value}));modalRoot.querySelectorAll('[data-player-hcp]').forEach(x=>x.addEventListener('input',()=>{const p=ui.modal.draft.players.find(p=>p.id===x.dataset.playerHcp);if(p)p.hcp=Math.max(0,Math.min(54,Number(x.value)||0))}));modalRoot.querySelectorAll('[data-player-team]').forEach(x=>x.addEventListener('change',()=>{const p=ui.modal.draft.players.find(p=>p.id===x.dataset.playerTeam);if(p)p.teamId=x.value}));modalRoot.querySelectorAll('[data-team-hcp]').forEach(x=>x.addEventListener('input',()=>{const t=ui.modal.draft.teams.find(t=>t.id===x.dataset.teamHcp);if(t)t.teamHcp=Number(x.value)||0}));modalRoot.querySelector('[data-min-drives]')?.addEventListener('input',e=>ui.modal.draft.minDrives=Math.max(0,Math.min(18,Number(e.target.value)||0)));
  modalRoot.querySelectorAll('[data-hole-par]').forEach(x=>x.addEventListener('input',()=>{const h=ui.modal.draft.course.holes.find(h=>h.number===Number(x.dataset.holePar));if(h)h.par=Math.max(3,Math.min(6,Number(x.value)||4))}));modalRoot.querySelectorAll('[data-hole-si]').forEach(x=>x.addEventListener('input',()=>{const h=ui.modal.draft.course.holes.find(h=>h.number===Number(x.dataset.holeSi));if(h)h.si=Math.max(1,Math.min(holeCount(ui.modal.draft),Number(x.value)||1))}));modalRoot.querySelectorAll('[data-hole-distance]').forEach(x=>x.addEventListener('input',()=>{const h=ui.modal.draft.course.holes.find(h=>h.number===Number(x.dataset.holeDistance));if(h)h.distance=Math.max(0,Math.min(1000,Number(x.value)||0))}));
  modalRoot.querySelector('[data-add-player]')?.addEventListener('click',()=>{const d=ui.modal.draft;const max=d.format==='custom'?8:d.format==='ambrose'&&d.ambroseMode==='single'?4:formatInfo(d.format).maxPlayers;if(d.players.length>=max)return;const n=d.players.length+1,ca=d.players.filter(p=>p.teamId==='team_a').length,cb=d.players.filter(p=>p.teamId==='team_b').length;d.players.push({id:uid('p'),name:`Player ${n}`,hcp:18,tone:n,teamId:d.format==='ambrose'&&d.ambroseMode==='single'?'team_a':ca<=cb?'team_a':'team_b'});renderEventModal()});
  modalRoot.querySelectorAll('[data-remove-player]').forEach(x=>x.addEventListener('click',()=>{const d=ui.modal.draft,min=d.format==='custom'?1:d.format==='ambrose'?(d.ambroseMode==='single'?2:4):formatInfo(d.format).minPlayers;if(d.players.length<=min)return;d.players=d.players.filter(p=>p.id!==x.dataset.removePlayer);renderEventModal()}));
  modalRoot.querySelector('[data-save-event]')?.addEventListener('click',saveEventDraft);modalRoot.querySelector('[data-delete-event]')?.addEventListener('click',deleteEditingEvent);
}
function saveEventDraft(){
  const m=ui.modal,d=m.draft;ensureCustomSegments(d);const info=formatInfo(d.format);if(!d.name.trim())return toast('Give the event a name.');if(!d.course.name.trim())return toast('Enter a course name.');
  const indexes=(d.course.holes||[]).map(h=>Number(h.si));if(![9,18].includes(d.course.holes?.length)||indexes.some(x=>!Number.isInteger(x)||x<1||x>holeCount(d))||new Set(indexes).size!==holeCount(d))return toast(`Use each stroke index from 1 to ${holeCount(d)} once.`);
  if(d.format==='custom'){const assigned=customAssignedHoles(d);if(assigned.length!==holeCount(d))return toast(`Assign all ${holeCount(d)} holes before starting a custom round.`);const bad=d.customSegments.find(seg=>{const f=formatInfo(seg.format);return d.players.length<f.minPlayers||d.players.length>f.maxPlayers});if(bad){const f=formatInfo(bad.format);return toast(`${escapeHtml(bad.name)} uses ${escapeHtml(f.name)}, which needs ${f.minPlayers}–${f.maxPlayers} players.`)}}
  else if(d.format==='ambrose'){if(d.ambroseMode==='single'){if(d.players.length<2||d.players.length>4)return toast('A single Ambrose team needs 2–4 players.');d.players.forEach(p=>p.teamId='team_a')}else{if(d.players.length<4||d.players.length>8)return toast('Head-to-head Ambrose needs 4–8 players.');const counts=d.teams.map(t=>d.players.filter(p=>p.teamId===t.id).length);if(counts.some(n=>n<2||n>4))return toast('Put 2–4 players in each Ambrose team.')}}
  else if(d.players.length<info.minPlayers||d.players.length>info.maxPlayers)return toast(`${info.name} needs ${info.minPlayers}–${info.maxPlayers} players here.`);
  if(d.players.some(p=>!p.name.trim()))return toast('Every player needs a name.');d.eventMode='round';d.trackStats=!!d.trackStats;d.advancedStats=!!d.advancedStats;d.sideGames ||= {ntpHole:0,ntpPlayerId:null,ldHole:0,ldPlayerId:null};if(d.sideGames.ntpPlayerId&&!d.players.some(p=>p.id===d.sideGames.ntpPlayerId))d.sideGames.ntpPlayerId=null;if(d.sideGames.ldPlayerId&&!d.players.some(p=>p.id===d.sideGames.ldPlayerId))d.sideGames.ldPlayerId=null;d.players.forEach((p,i)=>p.tone=(i%6)+1);ensureTeams(d);d.scores ||= {};d.teamScores ||= {};d.playerStats ||= {};d.playerConfirmedHoles ||= {};d.playerCurrentHoles ||= {};d.teamStats ||= {};d.teamConfirmedHoles ||= {};d.teamCurrentHoles ||= {};d.driveSelections ||= {};d.players.forEach(p=>{d.scores[p.id] ||= {};d.playerStats[p.id] ||= {};d.playerConfirmedHoles[p.id] ||= []});Object.keys(d.scores).forEach(pid=>{if(!d.players.some(p=>p.id===pid))delete d.scores[pid]});Object.keys(d.playerStats).forEach(pid=>{if(!d.players.some(p=>p.id===pid))delete d.playerStats[pid]});d.teams.forEach(t=>{d.teamScores[t.id] ||= {};d.teamStats[t.id] ||= {};d.teamConfirmedHoles[t.id] ||= [];d.driveSelections[t.id] ||= {}});const idx=state.events.findIndex(e=>e.id===d.id);if(idx>=0)state.events[idx]=d;else state.events.unshift(d);state.activeEventId=d.id;d.status=d.status==='complete'?'complete':'live';saveState();queueCloudSync(d,{structure:true,immediate:true});closeModal();switchTab('play');toast(m.editing?'Event updated.':'<strong>Event created.</strong> Scorecard ready.');
}
function renderCustomBuilderModal(){const m=ui.modal;if(!m?.draft)return;const d=m.draft;ensureCustomSegments(d);m.view='builder';const assigned=new Map();d.customSegments.forEach((seg,i)=>(seg.holes||[]).forEach(h=>assigned.set(h,i)));const holeMap=Array.from({length:holeCount(d)},(_,i)=>{const h=i+1,idx=assigned.get(h),seg=idx!=null?d.customSegments[idx]:null;return `<div class="builder-hole ${idx!=null?segmentTone(idx):'unassigned'}"><strong>${h}</strong><span>${seg?escapeHtml(formatInfo(seg.format).short):'—'}</span></div>`}).join('');const segments=d.customSegments.map((seg,i)=>`<article class="builder-segment ${segmentTone(i)}"><div class="builder-segment-head"><span class="segment-dot"></span><input data-segment-name="${seg.id}" value="${escapeHtml(seg.name)}" aria-label="Segment name"><button data-remove-segment="${seg.id}" ${d.customSegments.length===1?'disabled':''}>×</button></div><div class="builder-segment-grid"><div class="field"><label>Format</label><select data-segment-format="${seg.id}">${segmentFormatOptions(seg.format)}</select></div><div class="field"><label>Competition points</label><input type="number" min="0" step="0.5" data-segment-points="${seg.id}" value="${Number(seg.points||1)}"></div></div><div class="builder-hole-picker"><p>${escapeHtml(holesLabel(seg.holes))}</p><div>${Array.from({length:holeCount(d)},(_,x)=>x+1).map(h=>`<button class="${seg.holes.includes(h)?'active':''}" data-segment-hole="${seg.id}" data-hole="${h}">${h}</button>`).join('')}</div></div></article>`).join('');modalRoot.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-sheet builder-sheet"><div class="modal-handle"></div><div class="modal-title-row"><div><p class="eyebrow">CUSTOM COMPETITION</p><h2>Build Your Round</h2><p class="body-copy">Create segments, choose a format, then tap the holes that belong to it. A hole can belong to one segment at a time.</p></div><button class="modal-close" data-builder-done>×</button></div><div class="builder-map"><div class="section-head"><div><h3>${holeCount(d)}-hole map</h3><p class="muted-note">${customAssignedHoles(d).length}/${holeCount(d)} assigned</p></div><button class="secondary-btn small-btn" data-add-segment>+ Segment</button></div><div class="builder-hole-map">${holeMap}</div></div><div class="builder-segments">${segments}</div><div class="info-callout"><strong>How Fairway One scores it</strong><p>Fairway One keeps the raw hole scores underneath. When you reach a hole it applies the format assigned to that segment, including individual, team and shared-ball entry models.</p></div><div class="modal-actions"><button class="secondary-btn" data-builder-back>Back</button><button class="primary-btn gold" data-builder-done>Use this setup</button></div></section></div>`;bindCustomBuilder()}
function bindCustomBuilder(){const d=ui.modal.draft;const back=()=>{ui.modal.view='setup';renderEventModal()};modalRoot.querySelectorAll('[data-builder-back],[data-builder-done]').forEach(x=>x.addEventListener('click',back));modalRoot.querySelector('#modalBackdrop')?.addEventListener('click',e=>{if(e.target.id==='modalBackdrop')back()});modalRoot.querySelectorAll('[data-segment-name]').forEach(x=>x.addEventListener('input',()=>{const seg=d.customSegments.find(s=>s.id===x.dataset.segmentName);if(seg)seg.name=x.value}));modalRoot.querySelectorAll('[data-segment-format]').forEach(x=>x.addEventListener('change',()=>{const seg=d.customSegments.find(s=>s.id===x.dataset.segmentFormat);if(seg)seg.format=x.value;renderCustomBuilderModal()}));modalRoot.querySelectorAll('[data-segment-points]').forEach(x=>x.addEventListener('input',()=>{const seg=d.customSegments.find(s=>s.id===x.dataset.segmentPoints);if(seg)seg.points=Math.max(0,Number(x.value)||0)}));modalRoot.querySelectorAll('[data-segment-hole]').forEach(x=>x.addEventListener('click',()=>{const seg=d.customSegments.find(s=>s.id===x.dataset.segmentHole),hole=Number(x.dataset.hole);if(!seg)return;const active=seg.holes.includes(hole);d.customSegments.forEach(s=>s.holes=s.holes.filter(h=>h!==hole));if(!active)seg.holes.push(hole);d.customSegments.forEach(s=>s.holes.sort((a,b)=>a-b));renderCustomBuilderModal()}));modalRoot.querySelector('[data-add-segment]')?.addEventListener('click',()=>{if(d.customSegments.length>=holeCount(d))return toast(`A round can have up to ${holeCount(d)} segments.`);d.customSegments.push({id:uid('seg'),name:`Segment ${d.customSegments.length+1}`,format:'match',holes:[],points:1});renderCustomBuilderModal()});modalRoot.querySelectorAll('[data-remove-segment]').forEach(x=>x.addEventListener('click',()=>{if(d.customSegments.length===1)return;const idx=d.customSegments.findIndex(s=>s.id===x.dataset.removeSegment);if(idx<0)return;const removed=d.customSegments[idx],fallback=d.customSegments.find((_,i)=>i!==idx);fallback.holes=[...new Set([...fallback.holes,...removed.holes])].sort((a,b)=>a-b);d.customSegments.splice(idx,1);renderCustomBuilderModal()}))}

async function deleteEditingEvent(){const id=ui.modal?.draft?.id;if(!id)return;const evt=state.events.find(e=>e.id===id);if(!confirm(cloud.session&&evt?.cloud?.eventId?'Delete this event locally and from Fairway One cloud?':'Delete this Fairway One event from this browser?'))return;try{if(cloud.session&&evt?.cloud?.eventId)await deleteCloudEvent(evt)}catch(err){return toast(`Cloud delete failed: ${escapeHtml(err.message||'Unknown error')}`)}state.events=state.events.filter(e=>e.id!==id);if(state.activeEventId===id)state.activeEventId=state.events[0]?.id||null;saveState();closeModal();render();toast('Event deleted.')}

function openGameGuideModal(){const grouped={};standaloneFormats().forEach(([k,v])=>(grouped[v.category] ||= []).push([k,v]));modalRoot.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-sheet info-sheet"><div class="modal-handle"></div><div class="modal-title-row"><div><p class="eyebrow">FAIRWAY ONE GUIDE</p><h2>How to play</h2><p class="body-copy">Choose from ${STANDALONE_FORMAT_COUNT} standalone formats or create your own combination with Build Your Round.</p></div><button class="modal-close" data-modal-close>×</button></div><button class="custom-guide-hero" data-action="create-custom-event"><span>${icon('spark')}</span><div><small>FEATURED</small><strong>Build Your Round</strong><p>Assign different formats to any holes you choose.</p></div><b>→</b></button>${Object.entries(grouped).map(([cat,items])=>`<div class="guide-category"><p class="eyebrow">${escapeHtml(cat)}</p><div class="guide-stack">${items.map(([k,v],i)=>`<button class="guide-format guide-button" data-guide-format="${k}"><div class="guide-number">${String(i+1).padStart(2,'0')}</div><div><span class="guide-status live">Playable now</span><h3>${escapeHtml(v.name)}</h3><p>${escapeHtml(v.description)}</p><div class="guide-example"><strong>How it works</strong><span>${escapeHtml(v.how)}</span></div></div></button>`).join('')}</div></div>`).join('')}<div class="modal-actions single"><button class="primary-btn" data-modal-close>Done</button></div></section></div>`;bindInfoModal();modalRoot.querySelectorAll('[data-guide-format]').forEach(x=>x.addEventListener('click',()=>openSingleFormatModal(x.dataset.guideFormat)));modalRoot.querySelector('[data-action="create-custom-event"]')?.addEventListener('click',()=>{closeModal();openEventModal(null,true)})}
function openSingleFormatModal(key,backToEvent=false){const f=formatInfo(key);modalRoot.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-sheet info-sheet"><div class="modal-handle"></div><div class="modal-title-row"><div><p class="eyebrow">${escapeHtml(f.category)}</p><h2>${escapeHtml(f.name)}</h2><p class="body-copy">${escapeHtml(f.description)}</p></div><button class="modal-close" data-modal-close>×</button></div><article class="format-detail-card"><span class="guide-status live">Playable now</span><h3>How to play</h3><p>${escapeHtml(f.how)}</p><div class="format-facts"><span>Entry: <strong>${f.entry==='team'?'Team score':'Individual scores'}</strong></span><span>Players: <strong>${f.minPlayers}–${f.maxPlayers}</strong></span>${f.tracksDrive?'<span>Drive tracking: <strong>Yes</strong></span>':''}</div></article><div class="info-callout"><strong>Competition rules</strong><p>Clubs and organisers may use different handicap allowances or local conditions. Fairway One stores those event settings explicitly rather than treating one local convention as universal.</p></div><div class="modal-actions single"><button class="primary-btn" data-modal-close>${backToEvent?'Back':'Done'}</button></div></section></div>`;bindInfoModal()}
function openRulesModal(){modalRoot.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-sheet info-sheet"><div class="modal-handle"></div><div class="modal-title-row"><div><p class="eyebrow">ON-COURSE REFERENCE</p><h2>Rules of Golf</h2><p class="body-copy">A practical Fairway One summary. For a ruling, always use the official Rules and the course’s Local Rules.</p></div><button class="modal-close" data-modal-close>×</button></div><div class="rules-principles"><div><strong>1</strong><span>Play the course as you find it.</span></div><div><strong>2</strong><span>Play the ball as it lies unless a Rule allows relief.</span></div><div><strong>3</strong><span>Apply penalties honestly and protect the field.</span></div></div><div class="rules-list"><article><h3>Count every stroke</h3><p>A stroke made at the ball counts, together with any penalty strokes. Some formats alter when a player must hole out, so check the competition terms.</p></article><article><h3>Lost ball or out of bounds</h3><p>Stroke-and-distance relief is the standard procedure. If a ball may be lost outside a penalty area or out of bounds, a provisional ball can save time.</p></article><article><h3>Penalty areas</h3><p>Red and yellow penalty areas have different relief options. Relief normally adds one penalty stroke.</p></article><article><h3>Unplayable ball</h3><p>A player may declare a ball unplayable outside a penalty area and use an available relief option for one penalty stroke.</p></article><article><h3>Putting green</h3><p>You may mark, lift and clean your ball on the putting green and repair certain damage under the Rules.</p></article><article><h3>Local Rules matter</h3><p>Always check the host course’s Local Rules and Terms of Competition before play.</p></article></div><div class="official-rules-card"><span class="guide-status official">Official source</span><h3>Golf Australia</h3><p>Use Golf Australia’s current rules guidance for official information and the R&A/USGA Rules of Golf adopted for competition.</p><div class="official-links"><a href="https://www.golf.org.au/thebasicsofgolf" target="_blank" rel="noopener">Golf Australia beginner guide ↗</a><a href="https://www.golf.org.au/participationprograms" target="_blank" rel="noopener">Golf Australia rules & participation resources ↗</a></div></div><p class="rules-disclaimer">Fairway One’s quick guide is for convenience only and does not replace the official Rules, Local Rules or a Committee ruling.</p><div class="modal-actions single"><button class="primary-btn" data-modal-close>Done</button></div></section></div>`;bindInfoModal()}
function bindInfoModal(){modalRoot.querySelectorAll('[data-modal-close]').forEach(x=>x.addEventListener('click',closeModal));modalRoot.querySelector('#modalBackdrop')?.addEventListener('click',e=>{if(e.target.id==='modalBackdrop')closeModal()})}
function closeModal(){ui.modal=null;modalRoot.innerHTML=''}
function openCloudAuthModal(reason='Sign in to keep your rounds and scores synced across your devices.'){modalRoot.innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal-sheet"><div class="modal-handle"></div><div class="modal-title-row"><div><p class="eyebrow">FAIRWAY ONE CLOUD</p><h2>Sign in or create account</h2><p class="body-copy">${escapeHtml(reason)}</p></div><button class="modal-close" data-modal-close>×</button></div><div class="form-section"><div class="form-grid"><div class="field full-span"><label>Email</label><input id="cloudEmail" type="email" autocomplete="email" placeholder="you@example.com"></div><div class="field full-span"><label>Password</label><input id="cloudPassword" type="password" autocomplete="current-password" minlength="6" placeholder="At least 6 characters"></div></div><p class="course-note">New accounts may need email confirmation before the first sign-in, depending on the Supabase Auth setting.</p></div><div class="modal-actions"><button class="secondary-btn" id="cloudCreateAccount">Create account</button><button class="primary-btn" id="cloudSignIn">Sign in</button></div></section></div>`;bindInfoModal();
  const values=()=>({email:modalRoot.querySelector('#cloudEmail')?.value.trim(),password:modalRoot.querySelector('#cloudPassword')?.value||''});
  modalRoot.querySelector('#cloudSignIn')?.addEventListener('click',async()=>{const {email,password}=values();if(!email||password.length<6)return toast('Enter a valid email and password.');try{const data=await signIn(email,password);cloud.session=data.session;cloud.status='connected';closeModal();await syncProfile(state.profile);await refreshCloud({silent:true});toast('Signed in to Fairway One cloud.');if(pendingJoinCode)setTimeout(()=>completePendingJoin(),0)}catch(err){toast(`Sign in failed: ${escapeHtml(err.message||'Unknown error')}`)}});
  modalRoot.querySelector('#cloudCreateAccount')?.addEventListener('click',async()=>{const {email,password}=values();if(!email||password.length<6)return toast('Enter a valid email and password of at least 6 characters.');try{const data=await signUp(email,password);if(data.session){cloud.session=data.session;cloud.status='connected';await syncProfile(state.profile);closeModal();await refreshCloud({silent:true});toast('Fairway One account created.');if(pendingJoinCode)setTimeout(()=>completePendingJoin(),0)}else{toast('Account created. Check your email to confirm it, then sign in.')}}catch(err){toast(`Account creation failed: ${escapeHtml(err.message||'Unknown error')}`)}});
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
window.addEventListener('offline',()=>{cloud.status='reconnecting';render()});
window.addEventListener('online',async()=>{
  try{
    if(pendingSpectatorCode){ui.spectatorEvent=await loadPublicTournament(pendingSpectatorCode);return render()}
    cloud.status=cloud.session?'connected':'local';await flushPendingSyncs();if(cloud.session)await refreshCloud({silent:true});render()
  }catch(err){cloud.lastError=err;cloud.status='reconnecting';render()}
});
render();
bootCloud();
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
