import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';

const SUPABASE_URL = 'https://lqjpervpfgevycpxowgc.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_TN7GOLtgt3y3iBfV6vlX7Q_T9YeVqF-';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const LOCAL_TO_DB_FORMAT = {
  match: 'match_play',
  aggregate: 'team_aggregate',
  best_two: 'best_2_of_4'
};
const DB_TO_LOCAL_FORMAT = Object.fromEntries(Object.entries(LOCAL_TO_DB_FORMAT).map(([a,b])=>[b,a]));

function dbFormat(localKey){ return LOCAL_TO_DB_FORMAT[localKey] || localKey; }
function localFormat(dbKey){ return DB_TO_LOCAL_FORMAT[dbKey] || dbKey; }
function uuid(){ return crypto.randomUUID(); }
function statusToDb(status){ return status === 'complete' ? 'completed' : status === 'live' ? 'live' : 'draft'; }
function statusFromDb(status){ return status === 'completed' ? 'complete' : status === 'live' ? 'live' : 'draft'; }
function timeForDb(value){ return value ? `${value}:00`.slice(0,8) : null; }
function timeFromDb(value){ return value ? String(value).slice(0,5) : '07:00'; }
function formatInfoForSync(event){
  const teamFormats=new Set(['ambrose','foursomes','greensomes','chapman']);
  return teamFormats.has(event?.format)?'team':'individual';
}
function throwIf(error){ if(error) throw error; }

export async function initCloud(){
  const { data, error } = await supabase.auth.getSession();
  throwIf(error);
  return data.session || null;
}

export function onCloudAuthChange(callback){
  return supabase.auth.onAuthStateChange((_event, session)=>callback(session || null));
}

export async function signUp(email,password){
  const { data, error } = await supabase.auth.signUp({ email, password });
  throwIf(error);
  return data;
}

export async function signIn(email,password){
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  throwIf(error);
  return data;
}

export async function signOut(){
  const { error } = await supabase.auth.signOut();
  throwIf(error);
}

export async function joinEventByCode(code){
  const { data, error } = await supabase.functions.invoke('join-event',{body:{action:'join',code:String(code||'').trim().toUpperCase()}});
  if(error) throw error;
  if(data?.error) throw new Error(data.error);
  return data;
}

export async function claimEventPlayer(eventId,playerId){
  const { data, error } = await supabase.functions.invoke('join-event',{body:{action:'claim',eventId,playerId}});
  if(error) throw error;
  if(data?.error) throw new Error(data.error);
  return data;
}

export async function loadProfile(){
  const { data: { user } } = await supabase.auth.getUser();
  if(!user) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  throwIf(error);
  return data;
}

export async function syncProfile(profile){
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  throwIf(userError);
  if(!user) return null;
  const row = {
    id: user.id,
    display_name: profile.name || 'Golfer',
    home_club: profile.homeClub || null,
    handicap_index: Number(profile.hcp ?? 0),
    country_code: profile.countryCode || 'AU',
    avatar_path: profile.avatarPath || null
  };
  const { data, error } = await supabase.from('profiles').upsert(row).select().single();
  throwIf(error);
  const { error: publicError } = await supabase.from('public_profiles').upsert({
    id:user.id,
    display_name:row.display_name,
    avatar_path:row.avatar_path,
    updated_at:new Date().toISOString()
  });
  throwIf(publicError);
  return data;
}

export function profilePhotoUrl(path){
  if(!path) return '';
  const { data } = supabase.storage.from('profile-photos').getPublicUrl(path);
  return data?.publicUrl || '';
}

export async function uploadProfilePhoto(file){
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  throwIf(userError);
  if(!user) throw new Error('Sign in to upload a profile photo.');
  const ext=((file.name||'photo.jpg').split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
  const path=`${user.id}/avatar-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('profile-photos').upload(path,file,{contentType:file.type||'image/jpeg',cacheControl:'3600',upsert:false});
  throwIf(error);
  return { path, url: profilePhotoUrl(path) };
}

export async function loadCourseLibrary(){
  const { data, error } = await supabase
    .from('courses')
    .select('id,name,city,state_region,country,is_verified,source_type,course_tees(id,name,course_rating,slope_rating,par_total,holes(hole_number,par,stroke_index,distance_m))')
    .eq('is_public',true)
    .order('name');
  throwIf(error);
  return (data || []).map(course=>({
    id:course.id,
    name:course.name,
    city:course.city || '',
    stateRegion:course.state_region || '',
    country:course.country || '',
    verified:!!course.is_verified,
    sourceType:course.source_type || 'community',
    tees:(course.course_tees || []).map(tee=>({
      id:tee.id,
      name:tee.name,
      courseRating:tee.course_rating,
      slopeRating:tee.slope_rating,
      parTotal:tee.par_total,
      holes:(tee.holes || []).sort((a,b)=>a.hole_number-b.hole_number).map(h=>({
        number:h.hole_number,par:h.par,si:h.stroke_index,distance:h.distance_m||null
      }))
    }))
  })).filter(course=>course.tees.length);
}

function ensureCloudIds(event){
  event.cloud ||= {};
  event.cloud.eventId ||= uuid();
  if(event.course?.libraryCourseId) event.cloud.courseId=event.course.libraryCourseId;
  else event.cloud.courseId ||= uuid();
  if(event.course?.libraryTeeId) event.cloud.teeId=event.course.libraryTeeId;
  else event.cloud.teeId ||= uuid();
  event.cloud.roundId ||= uuid();
  event.cloud.playerIds ||= {};
  event.cloud.teamIds ||= {};
  event.cloud.segmentIds ||= {};
  event.cloud.groupIds ||= {};
  (event.players || []).forEach(p => event.cloud.playerIds[p.id] ||= uuid());
  (event.teams || []).forEach(t => event.cloud.teamIds[t.id] ||= uuid());
  (event.customSegments || []).forEach(seg => event.cloud.segmentIds[seg.id] ||= uuid());
  (event.groups || []).forEach(g => event.cloud.groupIds[g.id] ||= uuid());
  return event.cloud;
}

async function deleteStale(table, column, parentId, currentIds){
  const { data, error } = await supabase.from(table).select('id').eq(column, parentId);
  throwIf(error);
  const stale = (data || []).map(x=>x.id).filter(id => !currentIds.includes(id));
  if(stale.length){
    const { error: delError } = await supabase.from(table).delete().in('id', stale);
    throwIf(delError);
  }
}

export async function syncEvent(event, profile, { structure=true } = {}){
  if(!event.cloud?.synced) structure=true;
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  throwIf(userError);
  if(!user) throw new Error('Sign in to use cloud sync.');
  const cloud = ensureCloudIds(event);
  let role=cloud.role||null;
  if(cloud.eventId){
    const { data: member } = await supabase.from('event_members').select('role').eq('event_id',cloud.eventId).eq('user_id',user.id).maybeSingle();
    if(member?.role) role=member.role;
  }
  if(event.cloud?.synced && role && role!=='admin'){
    cloud.role=role;
    await syncScores(event,user.id,{role});
    await syncProfile(profile);
    return cloud;
  }

  if(structure){
    let res;
    const usingLibraryCourse=!!event.course?.libraryCourseId;
    if(!usingLibraryCourse){
      res = await supabase.from('courses').upsert({
        id: cloud.courseId,
        owner_id: user.id,
        name: event.course?.name || 'Course',
        country: ({AU:'Australia',NZ:'New Zealand',US:'United States',CA:'Canada',GB:'United Kingdom'})[profile?.countryCode] || 'Australia',
        is_public: !!event.course?.saveToLibrary,
        source_type: 'community'
      }); throwIf(res.error);

      res = await supabase.from('course_tees').upsert({
        id: cloud.teeId,
        course_id: cloud.courseId,
        name: event.course?.tee || 'White',
        par_total: (event.course?.holes || []).reduce((s,h)=>s+Number(h.par||0),0)
      }); throwIf(res.error);

      const courseHoles = (event.course?.holes || []).map(h=>({
        tee_id: cloud.teeId,
        hole_number: h.number,
        par: h.par,
        stroke_index: h.si,
        distance_m: h.distance || null
      }));
      if(courseHoles.length){
        res = await supabase.from('holes').upsert(courseHoles,{onConflict:'tee_id,hole_number'}); throwIf(res.error);
      }
    }

    res = await supabase.from('events').upsert({
      id: cloud.eventId,
      owner_id: user.id,
      name: event.name,
      event_date: event.date || null,
      tee_time: timeForDb(event.teeTime),
      course_id: cloud.courseId,
      status: statusToDb(event.status),
      hole_count: event.course?.holes?.length || 18,
      event_mode: event.eventMode || 'round'
    }).select('id,join_code').single(); throwIf(res.error);
    cloud.joinCode=res.data?.join_code||cloud.joinCode||null;
    cloud.role='admin';

    res = await supabase.from('event_members').upsert({
      event_id: cloud.eventId,
      user_id: user.id,
      role: 'admin'
    },{onConflict:'event_id,user_id'}); throwIf(res.error);

    const { data: existingPlayerLinks, error: existingPlayerLinksError } = await supabase.from('event_players').select('id,user_id').eq('event_id',cloud.eventId);
    throwIf(existingPlayerLinksError);
    const existingUserByPlayer=Object.fromEntries((existingPlayerLinks||[]).map(x=>[x.id,x.user_id]));
    const playerRows = (event.players || []).map((p,i)=>({
      id: cloud.playerIds[p.id],
      event_id: cloud.eventId,
      display_name: p.name,
      user_id: p.userId || existingUserByPlayer[cloud.playerIds[p.id]] || ((p.isSelf || String(p.name||'').trim().toLowerCase()===String(profile?.name||'').trim().toLowerCase()) ? user.id : null),
      handicap_index: Number(p.hcp || 0),
      playing_handicap: Math.round(Number(p.hcp || 0)),
      sort_order: i
    }));
    playerRows.forEach(row=>{if(row.user_id===user.id){const local=(event.players||[]).find(p=>cloud.playerIds[p.id]===row.id);if(local){local.userId=user.id;local.isSelf=true;local.claimed=true;local.avatarPath=profile?.avatarPath||local.avatarPath||''}}});
    if(playerRows.length){ res = await supabase.from('event_players').upsert(playerRows); throwIf(res.error); }
    await deleteStale('event_players','event_id',cloud.eventId,playerRows.map(x=>x.id));


    const groupRows = event.eventMode === 'tournament' ? (event.groups || []).map((g,i)=>({
      id: cloud.groupIds[g.id] || (cloud.groupIds[g.id]=uuid()),
      event_id: cloud.eventId,
      name: g.name || `Group ${i+1}`,
      sort_order: i,
      starting_hole: Number(g.startingHole || 1),
      tee_time: timeForDb(g.teeTime || event.teeTime),
      current_hole: Math.max(1,Math.min(36,Number(event.groupCurrentHoles?.[g.id] || 1))),
      status: (event.groupConfirmedHoles?.[g.id] || []).length >= 18 ? 'completed' : ((event.groupConfirmedHoles?.[g.id] || []).length ? 'live' : 'not_started')
    })) : [];
    if(groupRows.length){ res = await supabase.from('event_groups').upsert(groupRows); throwIf(res.error); }
    await deleteStale('event_groups','event_id',cloud.eventId,groupRows.map(x=>x.id));
    if(groupRows.length){
      const groupIds=groupRows.map(x=>x.id);
      res = await supabase.from('event_group_members').delete().in('group_id',groupIds); throwIf(res.error);
      const memberRows=[];
      (event.groups || []).forEach(g=>(g.playerIds||[]).forEach((pid,pos)=>{if(cloud.playerIds[pid]&&cloud.groupIds[g.id])memberRows.push({group_id:cloud.groupIds[g.id],event_player_id:cloud.playerIds[pid],position:pos+1})}));
      if(memberRows.length){ res=await supabase.from('event_group_members').insert(memberRows); throwIf(res.error); }
    }

    const activeTeams = event.eventMode==='tournament' ? [] : (event.teams || []).filter(t => (event.players || []).some(p=>p.teamId===t.id));
    const teamRows = activeTeams.map((t,i)=>({
      id: cloud.teamIds[t.id],
      event_id: cloud.eventId,
      name: t.name,
      handicap_allowance: Number(t.teamHcp || 0),
      sort_order: i
    }));
    if(teamRows.length){ res = await supabase.from('teams').upsert(teamRows); throwIf(res.error); }
    await deleteStale('teams','event_id',cloud.eventId,teamRows.map(x=>x.id));

    if(teamRows.length){
      const teamIds = teamRows.map(x=>x.id);
      res = await supabase.from('team_members').delete().in('team_id',teamIds); throwIf(res.error);
      const memberRows = (event.players || []).filter(p=>cloud.teamIds[p.teamId]).map((p,i)=>({
        team_id: cloud.teamIds[p.teamId],
        event_player_id: cloud.playerIds[p.id],
        position: i+1
      }));
      if(memberRows.length){ res = await supabase.from('team_members').insert(memberRows); throwIf(res.error); }
    }

    const completedAt = event.status === 'complete' ? (event.cloud.completedAt ||= new Date().toISOString()) : null;
    res = await supabase.from('rounds').upsert({
      id: cloud.roundId,
      event_id: cloud.eventId,
      round_number: 1,
      format_key: dbFormat(event.format),
      tee_id: cloud.teeId,
      format_settings: { min_drives: Number(event.minDrives || 0), ambrose_mode: event.ambroseMode || null, group_size: Number(event.groupSize || 0), start_type: event.startType || null, track_stats: !!event.trackStats },
      status: event.status === 'complete' ? 'completed' : 'live',
      current_hole: Math.max(1,Math.min(36,Number(event.currentHole || 1))),
      started_at: event.createdAt || new Date().toISOString(),
      completed_at: completedAt
    }); throwIf(res.error);

    const roundHoles = (event.course?.holes || []).map(h=>({
      round_id: cloud.roundId,
      hole_number: h.number,
      par: h.par,
      stroke_index: h.si,
      distance_m: h.distance || null
    }));
    if(roundHoles.length){ res = await supabase.from('round_holes').upsert(roundHoles,{onConflict:'round_id,hole_number'}); throwIf(res.error); }


    const segmentRows = event.format === 'custom' ? (event.customSegments || []).map((seg,i)=>({
      id: cloud.segmentIds[seg.id] || (cloud.segmentIds[seg.id]=uuid()),
      round_id: cloud.roundId,
      name: seg.name || `Segment ${i+1}`,
      format_key: dbFormat(seg.format || 'stableford'),
      holes: [...new Set((seg.holes || []).map(Number))].filter(h=>h>=1&&h<=36).sort((a,b)=>a-b),
      competition_points: Number(seg.points ?? 1),
      settings: seg.settings || {},
      sort_order: i
    })).filter(seg=>seg.holes.length) : [];
    if(segmentRows.length){ res = await supabase.from('round_segments').upsert(segmentRows); throwIf(res.error); }
    await deleteStale('round_segments','round_id',cloud.roundId,segmentRows.map(x=>x.id));
  } else {
    const completedAt = event.status === 'complete' ? (event.cloud.completedAt ||= new Date().toISOString()) : null;
    const { error } = await supabase.from('rounds').update({
      status: event.status === 'complete' ? 'completed' : 'live',
      current_hole: Math.max(1,Math.min(36,Number(event.currentHole || 1))),
      completed_at: completedAt
    }).eq('id',cloud.roundId);
    throwIf(error);
    if(event.eventMode==='tournament' && event.groups?.length){
      const rows=event.groups.map((g,i)=>({id:cloud.groupIds[g.id] || (cloud.groupIds[g.id]=uuid()),event_id:cloud.eventId,name:g.name||`Group ${i+1}`,sort_order:i,starting_hole:Number(g.startingHole||1),tee_time:timeForDb(g.teeTime||event.teeTime),current_hole:Math.max(1,Math.min(36,Number(event.groupCurrentHoles?.[g.id]||1))),status:(event.groupConfirmedHoles?.[g.id]||[]).length>=18?'completed':((event.groupConfirmedHoles?.[g.id]||[]).length?'live':'not_started')}));
      const groupRes=await supabase.from('event_groups').upsert(rows);throwIf(groupRes.error);
    }
  }

  await syncScores(event,user.id,{role:cloud.role||role||'admin'});
  await syncProfile(profile);
  cloud.synced=true;
  return cloud;
}

async function syncScores(event,userId,{role='admin'}={}){
  const cloud = ensureCloudIds(event);
  const confirmed = new Set(event.confirmedHoles || []);
  const playerGroup={};(event.groups||[]).forEach(g=>(g.playerIds||[]).forEach(pid=>playerGroup[pid]=g.id));
  const ownLocalIds=new Set((event.players||[]).filter(p=>p.isSelf||p.userId===userId).map(p=>p.id));
  if(role!=='admin'&&ownLocalIds.size===0)return;
  const selfMode=role!=='admin' && formatInfoForSync(event)!=='team';
  const isPlayerConfirmed=(pid,h)=>{
    const own=event.playerConfirmedHoles?.[pid]||[];
    if(own.length||selfMode)return own.includes(Number(h));
    return event.eventMode==='tournament'?new Set(event.groupConfirmedHoles?.[playerGroup[pid]]||[]).has(Number(h)):confirmed.has(Number(h));
  };

  const scoreRows=[];
  Object.entries(event.scores || {}).forEach(([localPlayerId,holes])=>{
    if(role!=='admin'&&!selfMode)return;
    if(selfMode&&!ownLocalIds.has(localPlayerId)) return;
    const playerId=cloud.playerIds[localPlayerId];
    if(!playerId) return;
    Object.entries(holes || {}).forEach(([hole,score])=>{
      if(score == null) return;
      const stat=event.playerStats?.[localPlayerId]?.[hole] || {};
      scoreRows.push({
        round_id: cloud.roundId,
        event_player_id: playerId,
        hole_number: Number(hole),
        gross_strokes: Number(score),
        penalty_strokes: Number(stat.penaltyStrokes || 0),
        putts: stat.putts == null ? null : Number(stat.putts),
        sand_shots: stat.sandShots == null ? null : Number(stat.sandShots),
        is_confirmed: isPlayerConfirmed(localPlayerId,hole),
        entered_by: userId
      });
    });
  });
  const ownCloudPlayerIds=[...ownLocalIds].map(id=>cloud.playerIds[id]).filter(Boolean);
  let existingScores=[];
  if(role==='admin'||selfMode){
    let existingScoresQuery=supabase.from('scores').select('id,event_player_id,hole_number').eq('round_id',cloud.roundId);
    if(selfMode&&ownCloudPlayerIds.length)existingScoresQuery=existingScoresQuery.in('event_player_id',ownCloudPlayerIds);
    const existingRes=await existingScoresQuery;throwIf(existingRes.error);existingScores=existingRes.data||[];
    const scoreKeys=new Set(scoreRows.map(x=>`${x.event_player_id}:${x.hole_number}`));
    const staleScores=existingScores.filter(x=>!scoreKeys.has(`${x.event_player_id}:${x.hole_number}`)).map(x=>x.id);
    if(staleScores.length){ const { error }=await supabase.from('scores').delete().in('id',staleScores); throwIf(error); }
    if(scoreRows.length){ const { error }=await supabase.from('scores').upsert(scoreRows,{onConflict:'round_id,event_player_id,hole_number'}); throwIf(error); }
  }

  const teamScoreRows=[];
  const ownTeamIds=new Set((event.players||[]).filter(p=>p.isSelf||p.userId===userId).map(p=>p.teamId).filter(Boolean));
  Object.entries(event.teamScores || {}).forEach(([localTeamId,holes])=>{
    if(role!=='admin'&&ownTeamIds.size&&!ownTeamIds.has(localTeamId))return;
    const teamId=cloud.teamIds[localTeamId];
    if(!teamId) return;
    Object.entries(holes || {}).forEach(([hole,score])=>{
      if(score == null) return;
      const stat=event.teamStats?.[localTeamId]?.[hole] || {};
      teamScoreRows.push({
        round_id: cloud.roundId,
        team_id: teamId,
        hole_number: Number(hole),
        gross_strokes: Number(score),
        penalty_strokes: Number(stat.penaltyStrokes || 0),
        putts: stat.putts == null ? null : Number(stat.putts),
        sand_shots: stat.sandShots == null ? null : Number(stat.sandShots),
        is_confirmed: (event.teamConfirmedHoles?.[localTeamId]||[]).length ? (event.teamConfirmedHoles[localTeamId]||[]).includes(Number(hole)) : confirmed.has(Number(hole)),
        entered_by: userId
      });
    });
  });
  let existingTeamQuery=supabase.from('team_scores').select('id,team_id,hole_number').eq('round_id',cloud.roundId);
  const ownCloudTeamIds=[...ownTeamIds].map(id=>cloud.teamIds[id]).filter(Boolean);
  if(role!=='admin'&&ownCloudTeamIds.length)existingTeamQuery=existingTeamQuery.in('team_id',ownCloudTeamIds);
  const { data: existingTeamScores, error: existingTeamError } = await existingTeamQuery;
  throwIf(existingTeamError);
  const teamScoreKeys=new Set(teamScoreRows.map(x=>`${x.team_id}:${x.hole_number}`));
  const staleTeamScores=(existingTeamScores||[]).filter(x=>!teamScoreKeys.has(`${x.team_id}:${x.hole_number}`)).map(x=>x.id);
  if(staleTeamScores.length){ const { error }=await supabase.from('team_scores').delete().in('id',staleTeamScores); throwIf(error); }
  if(teamScoreRows.length){ const { error }=await supabase.from('team_scores').upsert(teamScoreRows,{onConflict:'round_id,team_id,hole_number'}); throwIf(error); }

  const driveRows=[];
  Object.entries(event.driveSelections || {}).forEach(([localTeamId,holes])=>{
    if(role!=='admin'&&ownTeamIds.size&&!ownTeamIds.has(localTeamId))return;
    const teamId=cloud.teamIds[localTeamId];
    if(!teamId) return;
    Object.entries(holes || {}).forEach(([hole,localPlayerId])=>{
      const playerId=cloud.playerIds[localPlayerId];
      if(!playerId) return;
      driveRows.push({
        round_id: cloud.roundId,
        team_id: teamId,
        hole_number: Number(hole),
        selected_player_id: playerId,
        entered_by: userId
      });
    });
  });
  let existingDriveQuery=supabase.from('ambrose_drives').select('id,team_id,hole_number').eq('round_id',cloud.roundId);
  if(role!=='admin'&&ownCloudTeamIds.length)existingDriveQuery=existingDriveQuery.in('team_id',ownCloudTeamIds);
  const { data: existingDrives, error: existingDrivesError } = await existingDriveQuery;
  throwIf(existingDrivesError);
  const driveKeys=new Set(driveRows.map(x=>`${x.team_id}:${x.hole_number}`));
  const staleDrives=(existingDrives||[]).filter(x=>!driveKeys.has(`${x.team_id}:${x.hole_number}`)).map(x=>x.id);
  if(staleDrives.length){ const { error }=await supabase.from('ambrose_drives').delete().in('id',staleDrives); throwIf(error); }
  if(driveRows.length){ const { error }=await supabase.from('ambrose_drives').upsert(driveRows,{onConflict:'round_id,team_id,hole_number'}); throwIf(error); }
}

export async function deleteCloudEvent(event){
  if(!event?.cloud?.eventId) return;
  const { error } = await supabase.from('events').delete().eq('id',event.cloud.eventId);
  throwIf(error);
}

async function loadOneEvent(eventRow){
  const { data: round, error: roundError } = await supabase.from('rounds').select('*').eq('event_id',eventRow.id).order('round_number').limit(1).maybeSingle();
  throwIf(roundError);
  if(!round) return null;

  const [courseRes,teeRes,holesRes,playersRes,teamsRes,scoresRes,teamScoresRes,drivesRes,segmentsRes,groupsRes] = await Promise.all([
    eventRow.course_id ? supabase.from('courses').select('*').eq('id',eventRow.course_id).maybeSingle() : Promise.resolve({data:null,error:null}),
    round.tee_id ? supabase.from('course_tees').select('*').eq('id',round.tee_id).maybeSingle() : Promise.resolve({data:null,error:null}),
    supabase.from('round_holes').select('*').eq('round_id',round.id).order('hole_number'),
    supabase.from('event_players').select('*').eq('event_id',eventRow.id).order('sort_order'),
    supabase.from('teams').select('*').eq('event_id',eventRow.id).order('sort_order'),
    supabase.from('scores').select('*').eq('round_id',round.id),
    supabase.from('team_scores').select('*').eq('round_id',round.id),
    supabase.from('ambrose_drives').select('*').eq('round_id',round.id),
    supabase.from('round_segments').select('*').eq('round_id',round.id).order('sort_order'),
    supabase.from('event_groups').select('*').eq('event_id',eventRow.id).order('sort_order')
  ]);
  [courseRes,teeRes,holesRes,playersRes,teamsRes,scoresRes,teamScoresRes,drivesRes,segmentsRes,groupsRes].forEach(r=>throwIf(r.error));

  let membersRes={data:[],error:null};
  const loadedTeamIds=(teamsRes.data||[]).map(x=>x.id);
  if(loadedTeamIds.length){
    membersRes=await supabase.from('team_members').select('*').in('team_id',loadedTeamIds);
    throwIf(membersRes.error);
  }

  let groupMembersRes={data:[],error:null};
  const loadedGroupIds=(groupsRes.data||[]).map(x=>x.id);
  if(loadedGroupIds.length){groupMembersRes=await supabase.from('event_group_members').select('*').in('group_id',loadedGroupIds);throwIf(groupMembersRes.error);}

  const teamByPlayer={};
  (membersRes.data||[]).forEach(m=>teamByPlayer[m.event_player_id]=m.team_id);
  const { data: { user: currentUser } } = await supabase.auth.getUser();
  const linkedUserIds=[...new Set((playersRes.data||[]).map(p=>p.user_id).filter(Boolean))];
  let publicProfileByUser={};
  if(linkedUserIds.length){
    const { data: publicProfiles, error: publicProfilesError } = await supabase.from('public_profiles').select('id,display_name,avatar_path').in('id',linkedUserIds);
    throwIf(publicProfilesError);
    publicProfileByUser=Object.fromEntries((publicProfiles||[]).map(x=>[x.id,x]));
  }
  let memberRole=null;
  if(currentUser){const {data:member}=await supabase.from('event_members').select('role').eq('event_id',eventRow.id).eq('user_id',currentUser.id).maybeSingle();memberRole=member?.role||null;}
  const players=(playersRes.data||[]).map((p,i)=>({
    id:p.id,
    name:p.display_name,
    hcp:Number(p.playing_handicap ?? p.handicap_index ?? 0),
    tone:(i%6)+1,
    teamId:teamByPlayer[p.id] || null,
    userId:p.user_id||null,
    claimed:!!p.user_id,
    isSelf:!!(currentUser&&p.user_id===currentUser.id),
    avatarPath:p.user_id?(publicProfileByUser[p.user_id]?.avatar_path||''):''
  }));
  const teams=(teamsRes.data||[]).map(t=>({id:t.id,name:t.name,teamHcp:Number(t.handicap_allowance||0)}));
  const scores={}; players.forEach(p=>scores[p.id]={});
  const playerStats={}; players.forEach(p=>playerStats[p.id]={});
  (scoresRes.data||[]).forEach(s=>{
    scores[s.event_player_id] ||= {}; scores[s.event_player_id][s.hole_number]=s.gross_strokes;
    playerStats[s.event_player_id] ||= {};
    playerStats[s.event_player_id][s.hole_number]={putts:s.putts==null?null:Number(s.putts),sandShots:s.sand_shots==null?null:Number(s.sand_shots),penaltyStrokes:Number(s.penalty_strokes||0)};
  });
  const playerConfirmedHoles={}; players.forEach(p=>playerConfirmedHoles[p.id]=[]);
  (scoresRes.data||[]).filter(s=>s.is_confirmed).forEach(s=>{playerConfirmedHoles[s.event_player_id] ||= [];playerConfirmedHoles[s.event_player_id].push(Number(s.hole_number));});
  Object.values(playerConfirmedHoles).forEach(arr=>arr.sort((a,b)=>a-b));
  const teamScores={}; teams.forEach(t=>teamScores[t.id]={});
  const teamStats={}; teams.forEach(t=>teamStats[t.id]={});
  (teamScoresRes.data||[]).forEach(s=>{
    teamScores[s.team_id] ||= {}; teamScores[s.team_id][s.hole_number]=s.gross_strokes;
    teamStats[s.team_id] ||= {};
    teamStats[s.team_id][s.hole_number]={putts:s.putts==null?null:Number(s.putts),sandShots:s.sand_shots==null?null:Number(s.sand_shots),penaltyStrokes:Number(s.penalty_strokes||0)};
  });
  const teamConfirmedHoles={}; teams.forEach(t=>teamConfirmedHoles[t.id]=[]);
  (teamScoresRes.data||[]).filter(s=>s.is_confirmed).forEach(s=>{teamConfirmedHoles[s.team_id] ||= [];teamConfirmedHoles[s.team_id].push(Number(s.hole_number));});
  Object.values(teamConfirmedHoles).forEach(arr=>arr.sort((a,b)=>a-b));
  const driveSelections={}; teams.forEach(t=>driveSelections[t.id]={});
  (drivesRes.data||[]).forEach(d=>{ driveSelections[d.team_id] ||= {}; driveSelections[d.team_id][d.hole_number]=d.selected_player_id; });
  const confirmedHoles=[...new Set([...(scoresRes.data||[]),...(teamScoresRes.data||[])].filter(x=>x.is_confirmed).map(x=>x.hole_number))].sort((a,b)=>a-b);
  const holes=(holesRes.data||[]).map(h=>({number:h.hole_number,par:h.par,si:h.stroke_index,distance:h.distance_m||null}));
  const cloud={
    eventId:eventRow.id,
    joinCode:eventRow.join_code||null,
    role:memberRole||null,
    courseId:eventRow.course_id,
    teeId:round.tee_id,
    roundId:round.id,
    playerIds:Object.fromEntries(players.map(p=>[p.id,p.id])),
    teamIds:Object.fromEntries(teams.map(t=>[t.id,t.id])),
    segmentIds:Object.fromEntries((segmentsRes.data||[]).map(seg=>[seg.id,seg.id])),
    groupIds:Object.fromEntries((groupsRes.data||[]).map(g=>[g.id,g.id])),
    completedAt:round.completed_at || null,
    synced:true
  };

  const customSegments=(segmentsRes.data||[]).map((seg,i)=>({id:seg.id,name:seg.name,format:localFormat(seg.format_key),holes:(seg.holes||[]).map(Number).sort((a,b)=>a-b),points:Number(seg.competition_points||1),settings:seg.settings||{}}));
  const groupMembers={};(groupMembersRes.data||[]).forEach(m=>{groupMembers[m.group_id] ||= [];groupMembers[m.group_id].push(m)});Object.values(groupMembers).forEach(arr=>arr.sort((a,b)=>(a.position||0)-(b.position||0)));
  const groups=(groupsRes.data||[]).map(g=>({id:g.id,name:g.name,playerIds:(groupMembers[g.id]||[]).map(m=>m.event_player_id),startingHole:Number(g.starting_hole||1),teeTime:timeFromDb(g.tee_time)}));
  const groupConfirmedHoles={},groupCurrentHoles={};
  groups.forEach(g=>{groupCurrentHoles[g.id]=Number((groupsRes.data||[]).find(x=>x.id===g.id)?.current_hole||1);const pids=new Set(g.playerIds);groupConfirmedHoles[g.id]=(holesRes.data||[]).map(h=>h.hole_number).filter(h=>{const rows=(scoresRes.data||[]).filter(x=>x.hole_number===h&&pids.has(x.event_player_id));return rows.length===g.playerIds.length&&rows.every(x=>x.is_confirmed)})});

  return {
    id:eventRow.id,
    name:eventRow.name,
    date:eventRow.event_date,
    teeTime:timeFromDb(eventRow.tee_time),
    status:statusFromDb(eventRow.status),
    eventMode:eventRow.event_mode || 'round',
    format:localFormat(round.format_key),
    customSegments,
    course:{name:courseRes.data?.name || 'Course',tee:teeRes.data?.name || 'White',holes,libraryCourseId:courseRes.data?.is_public?eventRow.course_id:null,libraryTeeId:courseRes.data?.is_public?round.tee_id:null,saveToLibrary:!!courseRes.data?.is_public},
    players,
    teams,
    scores,
    teamScores,
    playerStats,
    playerConfirmedHoles,
    teamStats,
    teamConfirmedHoles,
    trackStats:!!round.format_settings?.track_stats,
    driveSelections,
    minDrives:Number(round.format_settings?.min_drives || 0),
    ambroseMode:round.format_settings?.ambrose_mode || 'single',
    groupSize:Number(round.format_settings?.group_size || 4),
    startType:round.format_settings?.start_type || 'tee_times',
    groups,
    activeGroupId:(groups.find(g=>g.playerIds.includes(players.find(p=>p.isSelf)?.id))?.id||groups[0]?.id||null),
    groupConfirmedHoles,
    groupCurrentHoles,
    currentHole:round.current_hole || 1,
    confirmedHoles,
    createdAt:eventRow.created_at,
    cloud
  };
}

export async function loadCloudEvents(){
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  throwIf(userError);
  if(!user) return [];
  const { data, error } = await supabase.from('events').select('*').order('created_at',{ascending:false});
  throwIf(error);
  const events=[];
  for(const row of data || []){
    const event=await loadOneEvent(row);
    if(event) events.push(event);
  }
  return events;
}

export function subscribeToRound(roundId,onChange){
  if(!roundId) return null;
  const channel=supabase.channel(`fairway-one-round-${roundId}`)
    .on('postgres_changes',{event:'*',schema:'public',table:'scores',filter:`round_id=eq.${roundId}`},onChange)
    .on('postgres_changes',{event:'*',schema:'public',table:'team_scores',filter:`round_id=eq.${roundId}`},onChange)
    .on('postgres_changes',{event:'*',schema:'public',table:'ambrose_drives',filter:`round_id=eq.${roundId}`},onChange)
    .on('postgres_changes',{event:'*',schema:'public',table:'round_segments',filter:`round_id=eq.${roundId}`},onChange)
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'rounds',filter:`id=eq.${roundId}`},onChange)
    .subscribe();
  return channel;
}

export async function unsubscribe(channel){
  if(channel) await supabase.removeChannel(channel);
}
