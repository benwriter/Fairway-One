const players = [
  { id: 'ben', name: 'Ben Writer', initials: 'BW', hcp: 23, tone: 'gold' },
  { id: 'joel', name: 'Joel Ryan', initials: 'JR', hcp: 16, tone: 'cream' },
  { id: 'dylan', name: 'Dylan Allen', initials: 'DA', hcp: 27, tone: 'sage' },
  { id: 'brent', name: 'Brent Rogers', initials: 'BR', hcp: 18, tone: 'copper' }
];

let activeTab = 'home';
let scores = { ben: 4, joel: 5, dylan: 5, brent: 4 };

const app = document.getElementById('appContent');
const navButtons = [...document.querySelectorAll('.nav-item')];

const icon = (name) => {
  const icons = {
    bell: '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>',
    flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4m0 0h11l-2 4 2 4H5"/></svg>',
    target: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v3m0 12v3m-9-9h3m12 0h3"/></svg>',
    medal: '<svg viewBox="0 0 24 24"><circle cx="12" cy="14" r="6"/><path d="m8 2 4 6 4-6M9.5 13l1.5 1.5 3-3"/></svg>',
    users: '<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8m7 8a3 3 0 1 0 0-6m2 10a4 4 0 0 1 4 4v2"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>',
    spark: '<svg viewBox="0 0 24 24"><path d="m12 3 1.4 4.2L18 9l-4.6 1.8L12 15l-1.4-4.2L6 9l4.6-1.8L12 3Zm6 11 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14Z"/></svg>',
    crown: '<svg viewBox="0 0 24 24"><path d="m3 7 4 4 5-7 5 7 4-4-2 11H5L3 7Z"/></svg>'
  };
  return `<span class="line-icon">${icons[name] || ''}</span>`;
};

function avatar(player, small = false) {
  return `<span class="player-avatar avatar-${player.tone} ${small ? 'avatar-small' : ''}">${player.initials}</span>`;
}

function topbar(title = '', eyebrow = '') {
  return `
    <header class="topbar">
      <div class="brand brand-compact">
        <span class="brand-mark"><span class="brand-flag"></span><span class="brand-pin"></span></span>
        <span class="brand-copy"><strong>FAIRWAY</strong><span>ONE</span></span>
      </div>
      ${title ? `<div class="topbar-title"><span>${eyebrow}</span><strong>${title}</strong></div>` : '<div></div>'}
      <button class="icon-button notification-button" aria-label="Notifications">${icon('bell')}<span class="notification-dot"></span></button>
    </header>`;
}

function homeScreen() {
  return `
    <main class="screen home-screen">
      ${topbar()}
      <section class="welcome-row">
        <div><p class="eyebrow">TUESDAY · 22 SEPTEMBER</p><h1>Good morning, Ben.</h1><p class="subtle">Your next round is already live.</p></div>
        <div class="profile-medallion">BW</div>
      </section>

      <section class="hero-round-card">
        <div class="hero-texture"></div>
        <div class="hero-round-top"><span class="live-badge"><i></i> LIVE ROUND</span><span class="round-id">ROUND 01</span></div>
        <div class="hero-round-main">
          <p class="eyebrow hero-eyebrow">THE COAST GOLF CLUB</p>
          <h2>Tuesday Four-Ball</h2>
          <div class="round-meta"><span>${icon('flag')} Hole 7 of 18</span><span>Par 4</span><span>White tees</span></div>
          <div class="player-stack">${players.map(p => avatar(p)).join('')}<span class="stack-label">4 playing</span></div>
        </div>
        <div class="hero-round-bottom">
          <div><span class="metric-label">Your Stableford</span><strong>13 <small>pts</small></strong></div>
          <div><span class="metric-label">Match</span><strong>1 UP</strong></div>
          <button class="primary-button light" data-action="resume">Resume round <span>›</span></button>
        </div>
      </section>

      <section class="section-block">
        <div class="section-heading"><div><p class="eyebrow">LIVE COMPETITIONS</p><h3>One score. Four games.</h3></div><button class="text-button" data-action="scores">View all</button></div>
        <div class="competition-grid">
          <article class="mini-card"><span class="mini-icon">${icon('medal')}</span><span class="metric-label">Net Stroke</span><strong>+3</strong><small>2nd · thru 6</small></article>
          <article class="mini-card"><span class="mini-icon">${icon('target')}</span><span class="metric-label">Stableford</span><strong>13</strong><small>1st · 1 pt clear</small></article>
          <article class="mini-card"><span class="mini-icon">${icon('shield')}</span><span class="metric-label">Match Play</span><strong>1 UP</strong><small>vs Dylan</small></article>
          <article class="mini-card"><span class="mini-icon">${icon('users')}</span><span class="metric-label">Team</span><strong>25</strong><small>Ben + Joel · 1st</small></article>
        </div>
      </section>

      <section class="section-block">
        <div class="section-heading"><div><p class="eyebrow">UP NEXT</p><h3>Upcoming events</h3></div><button class="round-add-button">+</button></div>
        <article class="event-card">
          <div class="event-date"><strong>24</strong><span>SEP</span></div>
          <div class="event-copy"><span class="event-type">TEAM EVENT · 4 PLAYERS</span><h4>Coastal Cup</h4><p>The Coast Golf Club · 7:00 AM</p></div>
          <span class="muted-chevron">›</span>
        </article>
      </section>

      <section class="insight-card"><span class="insight-icon">${icon('spark')}</span><div><span class="eyebrow">FAIRWAY ONE INSIGHT</span><p>You score best on par 4s when receiving a stroke. Today, holes 7 and 16 are your opportunities.</p></div></section>
    </main>`;
}

function stablefordFor(player) {
  const par = 4;
  const stroke = player.hcp >= 7 ? 1 : 0;
  const net = scores[player.id] - stroke;
  return Math.max(0, 2 + (par - net));
}

function playScreen() {
  const rows = players.map(player => {
    const score = scores[player.id];
    const diff = score - 4;
    const scoreClass = diff < 0 ? 'under' : diff > 0 ? 'over' : 'par';
    const label = diff === 0 ? 'PAR' : diff > 0 ? `+${diff}` : `${diff}`;
    return `
      <article class="score-row">
        ${avatar(player)}
        <div class="score-player-info"><strong>${player.name}</strong><span>HCP ${player.hcp} · ${stablefordFor(player)} Stableford pts</span></div>
        <div class="score-control">
          <button data-score-player="${player.id}" data-delta="-1" aria-label="Decrease ${player.name} score">−</button>
          <div class="score-value ${scoreClass}"><strong>${score}</strong><span>${label}</span></div>
          <button data-score-player="${player.id}" data-delta="1" aria-label="Increase ${player.name} score">+</button>
        </div>
      </article>`;
  }).join('');

  const benPts = 13 + stablefordFor(players[0]) - 2;
  const teamPts = 25 + stablefordFor(players[0]) + stablefordFor(players[1]) - 4;
  const match = scores.ben <= scores.dylan ? 'Ben 1 UP' : 'All square';

  return `
    <main class="screen play-screen">
      ${topbar('Live scoring', 'THE COAST GOLF CLUB')}
      <section class="hole-header-card">
        <div class="hole-nav"><button class="hole-arrow">‹</button><span>HOLE</span><button class="hole-arrow">›</button></div>
        <div class="hole-number">7</div>
        <div class="hole-specs"><div><span>PAR</span><strong>4</strong></div><div><span>INDEX</span><strong>7</strong></div><div><span>METRES</span><strong>352</strong></div></div>
        <div class="stroke-note"><span class="stroke-dot"></span> All four players receive one handicap stroke</div>
      </section>

      <section class="score-panel">
        <div class="score-panel-heading"><div><p class="eyebrow">GROUP 1</p><h2>Enter scores</h2></div><span class="sync-pill"><i></i> Live sync</span></div>
        <div class="score-list">${rows}</div>
      </section>

      <section class="live-impact-card">
        <div class="impact-heading"><span>◌ Live competition impact</span><span class="calculated-pill">AUTO</span></div>
        <div class="impact-grid">
          <div><span>Stroke</span><strong>Ben +3</strong><small>2nd overall</small></div>
          <div><span>Stableford</span><strong>Ben ${benPts} pts</strong><small>1st overall</small></div>
          <div><span>Match</span><strong>${match}</strong><small>vs Dylan</small></div>
          <div><span>Team</span><strong>${teamPts} pts</strong><small>Ben + Joel</small></div>
        </div>
      </section>
      <button class="primary-button full-button">Confirm hole 7 <span>›</span></button>
      <p class="helper-copy">Prototype mode · scores are stored on this device only.</p>
    </main>`;
}

function eventsScreen() {
  return `
    <main class="screen">
      ${topbar('Events', 'FAIRWAY ONE')}
      <section class="page-intro"><p class="eyebrow">YOUR GOLF CALENDAR</p><h1>Every event, one place.</h1><p>Create anything from a four-player social round to a full-field tournament.</p></section>
      <button class="primary-button full-button">+ Create new event</button>
      <section class="event-list">
        <article class="large-event-card featured"><span class="status-pill"><i></i> LIVE</span><h3>Tuesday Four-Ball</h3><p>The Coast Golf Club</p><div class="event-details"><span>4 players</span><span>4 competitions</span><span>Hole 7</span></div></article>
        <article class="large-event-card"><span class="eyebrow">THU · 24 SEP</span><h3>Coastal Cup</h3><p>The Coast Golf Club · 7:00 AM</p><div class="event-details"><span>Team event</span><span>4 players</span><span>Mixed format</span></div></article>
        <article class="large-event-card"><span class="eyebrow">SAT · 10 OCT</span><h3>Wyong Saturday</h3><p>Wyong Golf Club · 8:12 AM</p><div class="event-details"><span>Stableford</span><span>Open field</span></div></article>
      </section>
    </main>`;
}

function leaderboardScreen() {
  const ranking = [...players].sort((a, b) => scores[a.id] - scores[b.id]);
  const rows = ranking.map((p, i) => `
    <div class="leader-row">
      <span class="position ${i === 0 ? 'first' : ''}">${i + 1}</span>
      <div class="leader-player">${avatar(p, true)}<div><strong>${p.name}</strong><span>HCP ${p.hcp}</span></div></div>
      <span class="thru">6</span><strong class="leader-score">${14 - (scores[p.id] - 4)}</strong>
    </div>`).join('');

  return `
    <main class="screen">
      ${topbar('Live scores', 'TUESDAY FOUR-BALL')}
      <section class="page-intro compact-intro"><p class="eyebrow">MULTI-COMPETITION</p><h1>Leaderboard</h1></section>
      <div class="segment-tabs"><button class="selected">Stableford</button><button>Stroke</button><button>Match</button><button>Teams</button></div>
      <section class="leaderboard-card"><div class="leaderboard-head"><span>POS</span><span>PLAYER</span><span>THRU</span><span>SCORE</span></div>${rows}</section>
      <section class="match-centre"><div class="section-heading"><div><p class="eyebrow">MATCH CENTRE</p><h3>Head-to-head</h3></div></div><article class="match-card"><div><strong>Ben</strong><span>vs Dylan</span></div><div class="match-status">BEN 1 UP</div><div><strong>Joel</strong><span>vs Brent</span></div></article></section>
    </main>`;
}

function profileScreen() {
  return `
    <main class="screen">
      ${topbar('Profile', 'FAIRWAY ONE')}
      <section class="profile-hero"><div class="profile-big-avatar">BW</div><div><p class="eyebrow">PLAYER PROFILE</p><h1>Ben Writer</h1><p>Wyong Golf Club · GA 23</p></div></section>
      <section class="profile-stat-grid"><article><span>Rounds</span><strong>18</strong></article><article><span>Wins</span><strong>4</strong></article><article><span>Best Stableford</span><strong>39</strong></article><article><span>Match record</span><strong>8–5–1</strong></article></section>
      <section class="achievement-card"><span class="achievement-icon">${icon('crown')}</span><div><p class="eyebrow">LATEST ACHIEVEMENT</p><h3>Match Play Closer</h3><p>Won three consecutive head-to-head matches.</p></div></section>
      <section class="form-card"><div class="section-heading"><div><p class="eyebrow">CURRENT FORM</p><h3>Last five rounds</h3></div></div><div class="form-bars"><span style="height:44%"></span><span style="height:62%"></span><span style="height:52%"></span><span style="height:78%"></span><span class="best" style="height:92%"></span></div><div class="form-labels"><span>31</span><span>34</span><span>33</span><span>37</span><span>39</span></div></section>
    </main>`;
}

function render() {
  const screens = {
    home: homeScreen,
    play: playScreen,
    events: eventsScreen,
    leaderboard: leaderboardScreen,
    profile: profileScreen
  };
  app.innerHTML = screens[activeTab]();
  app.scrollTop = 0;

  navButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === activeTab));

  document.querySelector('[data-action="resume"]')?.addEventListener('click', () => switchTab('play'));
  document.querySelector('[data-action="scores"]')?.addEventListener('click', () => switchTab('leaderboard'));

  document.querySelectorAll('[data-score-player]').forEach(button => {
    button.addEventListener('click', () => {
      const player = button.dataset.scorePlayer;
      const delta = Number(button.dataset.delta);
      scores[player] = Math.max(1, Math.min(12, scores[player] + delta));
      render();
    });
  });
}

function switchTab(tab) {
  activeTab = tab;
  render();
}

navButtons.forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
render();
