// ---------- DOM helpers ----------
const $ = (id) => document.getElementById(id);
const qs = (sel) => document.querySelector(sel);

// ---------- Firebase ----------
const firebaseConfig = {
    apiKey: "AIzaSyApw-_f4nfbHwbZhe9-HB5oaA3CsBadWVs",
    authDomain: "mamoball-turkey-league.firebaseapp.com",
    databaseURL: "https://mamoball-turkey-league-default-rtdb.europe-west1.firebasedatabase.app/",
    projectId: "mamoball-turkey-league",
    storageBucket: "mamoball-turkey-league.firebasestorage.app",
    messagingSenderId: "648815784565",
    appId: "1:648815784565:web:5d82e86c1db870cd53fe3c"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

// ---------- State ----------
let newsData = [], leagues = {}, leaguesMeta = {}, fixtures = {};
let players = []; // registry: { id, playerId, name }
let matches = []; // { id, league, week, stage, t1Id,t2Id, s1,s2, createdAt, details:{ [teamInternalId]:[{playerId,g,a,cs}] } }
let isAdmin = false;

// ---------- Helpers ----------
function normalizeHashId(input) {
    if (!input) return null;
    let v = String(input).trim();
    if (!v.startsWith('#')) v = '#' + v;
    return v;
}
function isValidHashId(input) {
    const v = normalizeHashId(input);
    return !!v && /^#[A-Za-z0-9]+$/.test(v);
}
function makeId(prefix) {
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return '#' + prefix + Date.now().toString(36).toUpperCase().slice(-4) + rand;
}
function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function makeSafeKey(s) {
    return String(s || "").trim().replace(/[.#$\/\[\]]/g, " ").replace(/\s+/g, " ").trim();
}
function renderNewsContent(content) {
    let safe = esc(content || '');
    safe = safe.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
    safe = safe.replace(/\n/g, '<br>');
    return safe;
}

// ---------- Router / Pages ----------
const ROUTES = ["news", "standings", "fixture", "stats", "teams", "players", "admin"];

function setRoute(route) {
    const r = ROUTES.includes(route) ? route : "news";
    window.location.hash = "#" + r;
}
function getRoute() {
    const h = (window.location.hash || "#news").replace("#", "");
    return ROUTES.includes(h) ? h : "news";
}
function renderRoute() {
    const route = getRoute();

    ROUTES.forEach(r => {
        const sec = $("page-" + r);
        if (sec) sec.style.display = (r === route) ? "block" : "none";
    });

    // admin page switch: show auth or panel
    if (route === "admin") {
        if (isAdmin) {
            $("admin-panel") && ($("admin-panel").style.display = "block");
            $("admin-auth") && ($("admin-auth").style.display = "none");
        } else {
            $("admin-panel") && ($("admin-panel").style.display = "none");
            $("admin-auth") && ($("admin-auth").style.display = "block");
        }
    }

    // mobile menu close
    qs('.hamburger')?.classList.remove('active');
    $('nav-menu')?.classList.remove('active');
}

// ---------- Menu ----------
function toggleMenu() {
    qs('.hamburger')?.classList.toggle('active');
    $('nav-menu')?.classList.toggle('active');
}

// ---------- Admin Auth ----------
const AUTHORIZED_ADMINS = ["cgnk06@gmail.com", "scaevus.94@gmail.com"];

auth.onAuthStateChanged((user) => {
    if (user && AUTHORIZED_ADMINS.includes(user.email)) {
        isAdmin = true;
        console.log("Admin girişi:", user.email);
    } else {
        isAdmin = false;
        if (user) console.warn("Yetkisiz giriş:", user.email);
    }
    refreshAdminVisibility();
    renderAll();
    renderRoute();
    $('loader') && ($('loader').style.display = 'none');
});

function loginWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
        .then((result) => {
            if (!AUTHORIZED_ADMINS.includes(result.user.email)) {
                alert("Bu hesap yönetici yetkisine sahip değil!");
                logout();
            }
        })
        .catch((error) => {
            console.error("Giriş hatası:", error);
            alert("Giriş yapılamadı: " + error.message);
        });
}
function logout() {
    auth.signOut().then(() => {
        isAdmin = false;
        location.reload();
    });
}
function refreshAdminVisibility() {
    const show = isAdmin ? 'block' : 'none';
    $('admin-standings-tools') && ($('admin-standings-tools').style.display = show);
    $('admin-fixture-tools') && ($('admin-fixture-tools').style.display = show);
    $('admin-players-tools') && ($('admin-players-tools').style.display = show);
}

// ---------- Data normalize ----------
function normalizeData() {
    // leagues object->array fix
    Object.keys(leagues || {}).forEach(k => {
        if (Array.isArray(leagues[k])) return;
        if (leagues[k] && typeof leagues[k] === "object") {
            leagues[k] = Object.values(leagues[k]).filter(v => v && typeof v === "object" && !Array.isArray(v));
        }
    });

    // leaguesMeta fallback
    Object.keys(leagues || {}).forEach(k => { if (!leaguesMeta[k]) leaguesMeta[k] = k; });

    // teams normalize
    Object.keys(leagues || {}).forEach(l => {
        if (!Array.isArray(leagues[l])) return;
        leagues[l].forEach(t => {
            if (!t || t.id === "dummy") return;
            if (!t.teamId || !isValidHashId(t.teamId)) t.teamId = makeId('T');
            else t.teamId = normalizeHashId(t.teamId);
            if (!Array.isArray(t.roster)) t.roster = [];
            if (t.puan == null) t.puan = 0;
            if (t.averaj == null) t.averaj = 0;
        });
    });

    // players registry normalize
    players = Array.isArray(players) ? players : [];
    players.forEach(p => {
        if (!p.playerId || !isValidHashId(p.playerId)) p.playerId = makeId('P');
        else p.playerId = normalizeHashId(p.playerId);
        if (!p.name) p.name = "Oyuncu";
        if (!p.id) p.id = Date.now() + Math.floor(Math.random() * 9999);
    });

    // fixtures normalize
    fixtures = fixtures && typeof fixtures === "object" ? fixtures : {};
    Object.keys(fixtures || {}).forEach(l => {
        const v = fixtures[l];
        if (Array.isArray(v)) {
            fixtures[l] = { rounds: v, type: "legacy", playoff: null };
        } else if (v && typeof v === "object") {
            if (!Array.isArray(v.rounds)) v.rounds = [];
            if (!("playoff" in v)) v.playoff = null;
            if (!v.type) v.type = "league";
        } else {
            fixtures[l] = { rounds: [], type: "league", playoff: null };
        }
    });

    // matches normalize (+ stage)
    matches = Array.isArray(matches) ? matches : [];
    matches = matches.map(m => {
        const nm = Object.assign({}, m);
        if (!nm.id) nm.id = Date.now() + Math.floor(Math.random() * 9999);
        if (!nm.createdAt) nm.createdAt = Date.now();
        if (!nm.details || typeof nm.details !== "object") nm.details = {};
        nm.s1 = parseInt(nm.s1); nm.s2 = parseInt(nm.s2);
        if (Number.isNaN(nm.s1)) nm.s1 = 0;
        if (Number.isNaN(nm.s2)) nm.s2 = 0;

        const wk = String(nm.week ?? "0").toUpperCase();
        if (!nm.stage) {
            nm.stage = (wk.startsWith("SF") || wk === "FINAL") ? "playoff" : "league";
        }
        nm.week = wk;
        return nm;
    });

    // details migrate old format -> new array format
    matches = matches.map(m => {
        const nm = { ...m };
        const d = (nm.details && typeof nm.details === "object") ? nm.details : {};
        const migrated = {};
        Object.keys(d).forEach(teamInternalId => {
            const v = d[teamInternalId];

            if (Array.isArray(v)) {
                migrated[teamInternalId] = v.map(it => ({
                    playerId: normalizeHashId(it.playerId),
                    g: parseInt(it.g) || 0,
                    a: parseInt(it.a) || 0,
                    cs: parseInt(it.cs) || 0
                }));
                return;
            }

            if (v && typeof v === "object") {
                migrated[teamInternalId] = Object.keys(v).map(pidKey => {
                    const r = v[pidKey] || {};
                    return {
                        playerId: normalizeHashId(pidKey),
                        g: parseInt(r.g) || 0,
                        a: parseInt(r.a) || 0,
                        cs: parseInt(r.cs) || 0
                    };
                });
                return;
            }
            migrated[teamInternalId] = [];
        });
        nm.details = migrated;
        return nm;
    });
}

// ---------- Save / Load ----------
async function save() {
    try {
        await db.ref('/').set({
            news: newsData,
            leagues: leagues,
            leaguesMeta: leaguesMeta,
            matches: matches,
            players: players,
            fixtures: fixtures
        });
        renderAll();
        updateLeagueSelects();
        renderTeamsList();
        renderPlayersList();
    } catch (e) {
        console.error("Firebase write error:", e);
        alert("Kaydedilemedi! Firebase hatası: " + (e?.message || e));
    }
}

db.ref('/').on('value', (snapshot) => {
    const data = snapshot.val() || {};
    newsData = data.news || [];
    leagues = data.leagues || {};
    leaguesMeta = data.leaguesMeta || {};
    matches = data.matches || [];
    players = data.players || [];
    fixtures = data.fixtures || {};

    normalizeData();

    renderAll();
    updateLeagueSelects();
    renderTeamsList();
    renderPlayersList();
    refreshAdminVisibility();

    $('loader') && ($('loader').style.display = 'none');
});

// ---------- Utils (league/team/player) ----------
function getTeamById(leagueKey, internalTeamId) {
    const arr = leagues[leagueKey] || [];
    return arr.find(t => t && t.id !== "dummy" && t.id === internalTeamId) || null;
}
function getPlayerName(pid) {
    pid = normalizeHashId(pid);
    const p = (players || []).find(x => normalizeHashId(x.playerId) === pid);
    return p ? (p.name || "Oyuncu") : "Oyuncu";
}
function getTeamRosterPlayerIds(leagueKey, internalTeamId) {
    const t = getTeamById(leagueKey, internalTeamId);
    if (!t) return [];
    const roster = Array.isArray(t.roster) ? t.roster : [];
    return roster.map(normalizeHashId).filter(Boolean);
}

// ---------- Aggregates (Standings + Stats) ----------
function buildLeagueAggregates(leagueKey) {
    const teamStats = {};
    const playerStats = {};

    const lTeams = (leagues[leagueKey] || []).filter(t => t.id !== "dummy");
    lTeams.forEach(t => {
        teamStats[t.id] = { pts: 0, gd: 0, gf: 0, ga: 0, played: 0, w: 0, d: 0, l: 0 };
    });

    // standings only from league stage
    const lMatches = (matches || []).filter(m => m.league === leagueKey && (m.stage || "league") !== "playoff");

    lMatches.forEach(m => {
        const t1 = m.t1Id, t2 = m.t2Id;
        if (!teamStats[t1] || !teamStats[t2]) return;

        const s1 = parseInt(m.s1), s2 = parseInt(m.s2);
        if (Number.isNaN(s1) || Number.isNaN(s2)) return;

        teamStats[t1].played++; teamStats[t2].played++;
        teamStats[t1].gf += s1; teamStats[t1].ga += s2;
        teamStats[t2].gf += s2; teamStats[t2].ga += s1;
        teamStats[t1].gd += (s1 - s2);
        teamStats[t2].gd += (s2 - s1);

        if (s1 > s2) { teamStats[t1].pts += 3; teamStats[t1].w++; teamStats[t2].l++; }
        else if (s2 > s1) { teamStats[t2].pts += 3; teamStats[t2].w++; teamStats[t1].l++; }
        else { teamStats[t1].pts += 1; teamStats[t2].pts += 1; teamStats[t1].d++; teamStats[t2].d++; }
    });

    // player stats from ALL matches (league + playoff)
    const allMatches = (matches || []).filter(m => m.league === leagueKey);
    allMatches.forEach(m => {
        const t1 = m.t1Id, t2 = m.t2Id;
        const details = m.details || {};
        [t1, t2].forEach(teamId => {
            const list = Array.isArray(details[teamId]) ? details[teamId] : [];
            list.forEach(item => {
                const pid = normalizeHashId(item.playerId);
                const g = parseInt(item.g) || 0;
                const a = parseInt(item.a) || 0;
                const cs = parseInt(item.cs) || 0;

                const pName = getPlayerName(pid);
                if (!playerStats[pid]) playerStats[pid] = { playerId: pid, name: pName, goals: 0, assists: 0, cs: 0 };
                playerStats[pid].goals += g;
                playerStats[pid].assists += a;
                playerStats[pid].cs += cs;
                if (pName && pName !== "Oyuncu") playerStats[pid].name = pName;
            });
        });
    });

    return { teamStats, playerStats, lMatches };
}

// ---------- Head-to-head ----------
function computeH2H(leagueKey, teamAId, teamBId) {
    const out = { aPts: 0, bPts: 0, aGf: 0, bGf: 0, aGd: 0, bGd: 0 };
    const lMatches = (matches || []).filter(m => m.league === leagueKey && (m.stage || "league") !== "playoff");
    lMatches.forEach(m => {
        const isAB = (m.t1Id === teamAId && m.t2Id === teamBId) || (m.t1Id === teamBId && m.t2Id === teamAId);
        if (!isAB) return;

        const s1 = parseInt(m.s1), s2 = parseInt(m.s2);
        if (Number.isNaN(s1) || Number.isNaN(s2)) return;

        let aScore = 0, bScore = 0;
        if (m.t1Id === teamAId) { aScore = s1; bScore = s2; }
        else { aScore = s2; bScore = s1; }

        out.aGf += aScore; out.bGf += bScore;
        out.aGd += (aScore - bScore);
        out.bGd += (bScore - aScore);

        if (aScore > bScore) out.aPts += 3;
        else if (bScore > aScore) out.bPts += 3;
        else { out.aPts += 1; out.bPts += 1; }
    });
    return out;
}

function standingsComparator(leagueKey, teamStats) {
    return (A, B) => {
        const a = teamStats[A.id] || { pts: 0, gd: 0, gf: 0 };
        const b = teamStats[B.id] || { pts: 0, gd: 0, gf: 0 };

        if (b.pts !== a.pts) return b.pts - a.pts;
        if (b.gd !== a.gd) return b.gd - a.gd;

        const h = computeH2H(leagueKey, A.id, B.id);
        if (h.aPts !== h.bPts) return h.bPts - h.aPts;
        if (h.aGd !== h.bGd) return h.bGd - h.aGd;

        if (b.gf !== a.gf) return b.gf - a.gf;
        return String(A.name || "").localeCompare(String(B.name || ""), 'tr');
    };
}

// ---------- Render: News ----------
async function publishNews() {
    const t = ($('news-title')?.value || "").trim();
    const c = $('news-content')?.value || "";
    const img = ($('news-image-url')?.value || "").trim();

    if (!t || !c) return alert("Başlık ve içerik zorunlu!");
    if (img && !img.startsWith("https://")) return alert("Görsel linki https ile başlamalı!");

    const item = { id: Date.now(), title: t, content: c, image: img, date: new Date().toLocaleDateString('tr-TR') };
    newsData.push(item);

    $('news-title') && ($('news-title').value = "");
    $('news-content') && ($('news-content').value = "");
    $('news-image-url') && ($('news-image-url').value = "");

    await save();
}
function deleteNews(id) {
    if (confirm("Silinsin mi?")) {
        newsData = newsData.filter(n => n.id !== id);
        save();
    }
}
function renderNews() {
    const wrap = $('news-container');
    if (!wrap) return;
    wrap.innerHTML = newsData.slice().reverse().map(n => `
    <div class="news-card">
      ${isAdmin ? `<button class="btn-danger btn-small" onclick="deleteNews(${n.id})" style="float:right">Sil</button>` : ''}
      <h3>${esc(n.title)}</h3>
      ${n.image ? `
        <img src="${esc(n.image)}" class="news-img" loading="lazy" decoding="async" referrerpolicy="no-referrer"
             onerror="this.style.display='none'">` : ''}
      <p>${renderNewsContent(n.content)}</p>
      <small class="muted">${esc(n.date)}</small>
    </div>
  `).join('');
}

// ---------- League / Team Admin ----------
function addLeague() {
    const inp = $('league-name-input');
    const displayName = (inp?.value || "").trim();
    if (!displayName) return alert("Lig adı boş olamaz!");

    const key = makeSafeKey(displayName);
    if (!key) return alert("Lig adı geçersiz!");
    if (leagues[key]) return alert("Bu lig zaten var!");

    leagues[key] = [{
        id: "dummy", name: "Takım Ekleyin", logo: "", puan: 0, averaj: 0, teamId: "#DUMMY", roster: []
    }];
    leaguesMeta[key] = displayName;
    fixtures[key] = { rounds: [], type: "leagueSingle", playoff: null };

    if (inp) inp.value = "";
    save();
}

function addTeam() {
    const l = $('team-league-select')?.value || "";
    const n = ($('team-name')?.value || "").trim();
    const rawTeamId = ($('team-id-input')?.value || "").trim();
    const teamId = rawTeamId ? normalizeHashId(rawTeamId) : makeId('T');
    const logo = ($('team-logo-input')?.value || "").trim();

    if (!l || !n) return;
    if (rawTeamId && !isValidHashId(rawTeamId)) return alert("Takım ID geçersiz! (# ile başlayacak, sadece harf/rakam).");

    const allTeams = Object.values(leagues).flat().filter(x => x && x.id && x.id !== "dummy");
    if (allTeams.some(t => normalizeHashId(t.teamId) === normalizeHashId(teamId))) return alert("Bu takım ID zaten kullanılıyor!");

    leagues[l] = (leagues[l] || []).filter(x => x.id !== "dummy");
    leagues[l].push({
        id: "T" + Date.now(),
        teamId,
        name: n,
        logo: logo || 'https://via.placeholder.com/30?text=?',
        puan: 0,
        averaj: 0,
        roster: []
    });

    save();
    alert("Takım Eklendi!");
}

function deleteLeague() {
    const l = $('team-league-select')?.value || "";
    const dn = leaguesMeta[l] || l;
    if (l && confirm(`${dn} silinsin mi?`)) {
        delete leagues[l];
        delete leaguesMeta[l];
        if (fixtures[l]) delete fixtures[l];
        matches = (matches || []).filter(m => m.league !== l);
        save();
    }
}

// ---------- Standings Render ----------
function renderStandings() {
    const container = $('leagues-container');
    if (!container) return;
    container.innerHTML = "";

    Object.keys(leagues || {}).forEach(l => {
        if (!Array.isArray(leagues[l])) return;

        const displayName = leaguesMeta[l] || l;
        const teams = (leagues[l] || []).filter(t => t.id !== "dummy");

        const { teamStats } = buildLeagueAggregates(l);
        const sorted = teams.slice().sort(standingsComparator(l, teamStats));

        let html = `<div class="league-card"><h3>${esc(displayName)}</h3>
      <table>
        <tr>
          <th>#</th><th>Takım</th><th>O</th><th>G</th><th>B</th><th>M</th><th>AG</th><th>YG</th><th>AV</th><th>P</th>
        </tr>`;

        sorted.forEach((t, i) => {
            const st = teamStats[t.id] || { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
            html += `<tr>
        <td>${i + 1}</td>
        <td class="team-cell">
          <img src="${esc(t.logo)}" class="team-logo-small" loading="lazy" decoding="async" referrerpolicy="no-referrer"
               onerror="this.src='https://via.placeholder.com/30?text=?'">
          ${esc(t.name)} <span class="pill">${esc(t.teamId)}</span>
        </td>
        <td>${st.played}</td>
        <td>${st.w}</td>
        <td>${st.d}</td>
        <td>${st.l}</td>
        <td>${st.gf}</td>
        <td>${st.ga}</td>
        <td><b>${st.gd}</b></td>
        <td><b>${st.pts}</b></td>
      </tr>`;
        });

        container.innerHTML += html + `</table></div>`;
    });
}

// ---------- Fixture generation ----------
function generateRoundRobinNamesSingleLeg(names) {
    let teams = names.slice();
    if (teams.length < 2) return [];
    if (teams.length % 2 !== 0) teams.push("BAY");
    const totalRounds = teams.length - 1;
    const rounds = [];
    for (let r = 0; r < totalRounds; r++) {
        const roundMatches = [];
        for (let m = 0; m < teams.length / 2; m++) {
            const h = teams[m], a = teams[teams.length - 1 - m];
            if (h !== "BAY" && a !== "BAY") roundMatches.push({ home: h, away: a });
        }
        rounds.push(roundMatches);
        teams.splice(1, 0, teams.pop());
    }
    return rounds;
}
function generateFixtureSingleLeg() {
    const l = $('fixture-league-select')?.value || "";
    if (!l) return alert("Lig seçin!");

    const teams = (leagues[l] || []).filter(t => t.id !== "dummy").map(t => t.name);
    if (teams.length < 2) return alert("En az 2 takım olmalı.");

    const rr = generateRoundRobinNamesSingleLeg(teams);
    fixtures[l] = fixtures[l] && typeof fixtures[l] === "object" ? fixtures[l] : { rounds: [], type: "leagueSingle", playoff: null };
    fixtures[l].rounds = rr;
    fixtures[l].type = "leagueSingle";
    if (!fixtures[l].playoff) fixtures[l].playoff = null;

    save();
    alert("Rövanşsız fikstür hazır!");
}
function deleteFixture() {
    const l = $('fixture-league-select')?.value || "";
    if (l && confirm("Fikstür + playoff şablonu temizlensin mi?")) {
        fixtures[l] = { rounds: [], type: "leagueSingle", playoff: null };
        save();
    }
}

function getCurrentSortedTeamsForLeague(leagueKey) {
    const teams = (leagues[leagueKey] || []).filter(t => t.id !== "dummy");
    const { teamStats } = buildLeagueAggregates(leagueKey);
    return teams.slice().sort(standingsComparator(leagueKey, teamStats));
}

function createPlayoffTemplate() {
    const l = $('fixture-league-select')?.value || "";
    if (!l) return alert("Lig seçin!");

    const teams = (leagues[l] || []).filter(t => t.id !== "dummy");
    if (teams.length < 4) return alert("Playoff için en az 4 takım olmalı.");

    const sorted = getCurrentSortedTeamsForLeague(l);

    const s1v = $('seed1')?.value || "";
    const s2v = $('seed2')?.value || "";
    const s3v = $('seed3')?.value || "";
    const s4v = $('seed4')?.value || "";

    const auto1 = sorted[0]?.id, auto2 = sorted[1]?.id, auto3 = sorted[2]?.id, auto4 = sorted[3]?.id;

    const seed1 = s1v || auto1;
    const seed2 = s2v || auto2;
    const seed3 = s3v || auto3;
    const seed4 = s4v || auto4;

    const uniq = new Set([seed1, seed2, seed3, seed4].filter(Boolean));
    if (uniq.size !== 4) return alert("Seed seçimlerinde tekrar var (4 farklı takım olmalı).");

    fixtures[l] = fixtures[l] && typeof fixtures[l] === "object" ? fixtures[l] : { rounds: [], type: "leagueSingle", playoff: null };
    fixtures[l].playoff = {
        createdAt: Date.now(),
        seeds: { seed1, seed2, seed3, seed4 },
        semis: [
            { code: "SF1", homeSeed: "seed1", awaySeed: "seed4" },
            { code: "SF2", homeSeed: "seed2", awaySeed: "seed3" }
        ],
        final: { code: "FINAL", homeFrom: "W_SF1", awayFrom: "W_SF2" }
    };

    save();
    alert("Playoff şablonu oluşturuldu/güncellendi!");
}

// ---------- Match lookup for Fixture ----------
function findMatchByFixture(leagueKey, week, homeName, awayName) {
    const lTeams = leagues[leagueKey] || [];
    const home = lTeams.find(t => t.id !== "dummy" && t.name === homeName);
    const away = lTeams.find(t => t.id !== "dummy" && t.name === awayName);
    if (!home || !away) return null;

    const wk = String(week).toUpperCase();
    const direct = (matches || []).find(m =>
        m.league === leagueKey &&
        String(m.week).toUpperCase() === wk &&
        ((m.t1Id === home.id && m.t2Id === away.id) || (m.t1Id === away.id && m.t2Id === home.id))
    );

    return { home, away, match: direct || null };
}

// ---------- Modal (View/Edit from Fixture click) ----------
function openFixtureMatchModal(leagueKey, week, homeName, awayName) {
    const found = findMatchByFixture(leagueKey, week, homeName, awayName);
    if (!found) return;

    const { home, away, match } = found;
    const leagueName = leaguesMeta[leagueKey] || leagueKey;

    const title = `${home.name} vs ${away.name}`;
    $('match-modal-title').innerHTML = esc(title);
    $('match-modal-sub').innerHTML = `${esc(leagueName)} • Hafta ${esc(String(week))}`;

    const delBtn = $('btn-modal-delete');
    delBtn.style.display = (isAdmin && match) ? "inline-flex" : "none";
    delBtn.onclick = () => {
        if (!match) return;
        if (!confirm("Bu maçın sonucunu silmek istiyor musun?")) return;
        matches = (matches || []).filter(m => m.id !== match.id);
        save();
        closeMatchModal();
    };

    if (isAdmin) {
        renderAdminEditMatchBody(leagueKey, String(week), home, away, match);
    } else {
        renderPublicViewMatchBody(leagueKey, String(week), home, away, match);
    }

    $('match-modal-backdrop').style.display = 'flex';
}

function closeMatchModal() {
    $('match-modal-backdrop').style.display = 'none';
    $('match-modal-body').innerHTML = '';
}

function renderPublicViewMatchBody(leagueKey, week, home, away, match) {
    if (!match) {
        $('match-modal-body').innerHTML = `<div class="muted">Bu maç için henüz sonuç girilmemiş.</div>`;
        return;
    }

    const t1 = home;
    const t2 = away;
    const details = match.details || {};

    const renderTeamDetail = (team, teamId) => {
        const list = Array.isArray(details[teamId]) ? details[teamId] : [];
        const arr = list.map(item => ({
            pid: normalizeHashId(item.playerId),
            name: getPlayerName(item.playerId),
            g: parseInt(item.g) || 0,
            a: parseInt(item.a) || 0,
            cs: parseInt(item.cs) || 0
        })).sort((x, y) => (y.g - x.g) || (y.a - x.a) || (y.cs - x.cs) || String(x.name).localeCompare(String(y.name), 'tr'));

        return `
      <div class="roster-card">
        <div class="team-cell" style="margin-bottom:8px;">
          <img class="team-logo-small" src="${esc(team.logo || '')}" loading="lazy" decoding="async" referrerpolicy="no-referrer"
               onerror="this.src='https://via.placeholder.com/30?text=?'">
          <div style="font-weight:1000">${esc(team.name || 'Takım')}</div>
          <span class="pill">${esc(team.teamId || '')}</span>
        </div>

        <div class="muted" style="margin-bottom:8px">Skor: <b>${esc(match.s1)}</b> - <b>${esc(match.s2)}</b></div>

        <table>
          <tr><th>Oyuncu</th><th>Gol</th><th>Asist</th><th>CS</th></tr>
          ${arr.length ? arr.map(p => `
            <tr>
              <td>${esc(p.name)} <span class="pill">${esc(p.pid)}</span></td>
              <td><b>${p.g}</b></td>
              <td><b>${p.a}</b></td>
              <td><b>${p.cs}</b></td>
            </tr>
          `).join('') : `<tr><td colspan="4" class="muted">Detay yok.</td></tr>`}
        </table>
      </div>
    `;
    };

    $('match-modal-body').innerHTML = `
    <div class="grid-2">
      ${renderTeamDetail(t1, t1.id)}
      ${renderTeamDetail(t2, t2.id)}
    </div>
  `;
}

function renderAdminEditMatchBody(leagueKey, week, home, away, match) {
    const existing = match ? { s1: match.s1, s2: match.s2, details: match.details || {} } : { s1: 0, s2: 0, details: {} };

    const r1 = getTeamRosterPlayerIds(leagueKey, home.id);
    const r2 = getTeamRosterPlayerIds(leagueKey, away.id);

    const getExistingVal = (teamId, pid, field) => {
        const list = Array.isArray(existing.details?.[teamId]) ? existing.details[teamId] : [];
        const it = list.find(x => normalizeHashId(x.playerId) === normalizeHashId(pid));
        return it ? (parseInt(it[field]) || 0) : 0;
    };

    const renderRosterTable = (team, roster, side) => {
        const rows = roster.length ? roster.map(pid => {
            const safePid = esc(pid);
            const nm = esc(getPlayerName(pid));
            const teamId = team.id;

            return `
        <tr>
          <td>${nm} <span class="pill">${safePid}</span></td>
          <td style="width:80px"><input class="tiny-input" type="number" min="0" value="${getExistingVal(teamId, pid, "g")}" data-team="${esc(teamId)}" data-pid="${safePid}" data-field="g"></td>
          <td style="width:80px"><input class="tiny-input" type="number" min="0" value="${getExistingVal(teamId, pid, "a")}" data-team="${esc(teamId)}" data-pid="${safePid}" data-field="a"></td>
          <td style="width:80px"><input class="tiny-input" type="number" min="0" value="${getExistingVal(teamId, pid, "cs")}" data-team="${esc(teamId)}" data-pid="${safePid}" data-field="cs"></td>
        </tr>`;
        }).join('') : `<tr><td colspan="4" class="muted">Kadro boş.</td></tr>`;

        return `
      <div class="roster-card">
        <div class="team-cell" style="margin-bottom:8px;">
          <img class="team-logo-small" src="${esc(team?.logo || '')}" loading="lazy" decoding="async" referrerpolicy="no-referrer"
               onerror="this.src='https://via.placeholder.com/30?text=?'">
          <div style="font-weight:1000">${esc(team?.name || 'Takım')}</div>
        </div>
        <table>
          <tr><th>Oyuncu</th><th>Gol</th><th>Asist</th><th>CS</th></tr>
          ${rows}
        </table>
      </div>
    `;
    };

    $('match-modal-body').innerHTML = `
    <div class="league-card" style="margin-top:0">
      <h3>Skor</h3>
      <div style="display:flex;gap:8px;align-items:center;">
        <input id="modal-score-1" type="number" placeholder="0" value="${esc(existing.s1)}">
        <input id="modal-score-2" type="number" placeholder="0" value="${esc(existing.s2)}">
      </div>

      <div class="muted">Bu maç kaydedilince Puan Durumu ve Krallık otomatik güncellenir.</div>

      <button id="btn-modal-save"
        style="margin-top:10px;background:linear-gradient(180deg, rgba(0,200,81,1), rgba(0,150,61,1));box-shadow:0 12px 26px rgba(0,200,81,.12);">
        Skor + İstatistikleri Kaydet
      </button>
    </div>

    <div class="grid-2" style="margin-top:12px">
      ${renderRosterTable(home, r1, "home")}
      ${renderRosterTable(away, r2, "away")}
    </div>
  `;

    $('btn-modal-save').onclick = async () => {
        const s1 = parseInt($('modal-score-1')?.value);
        const s2 = parseInt($('modal-score-2')?.value);
        if (Number.isNaN(s1) || Number.isNaN(s2)) return alert("Skor gir!");

        // collect details
        const details = {};
        details[home.id] = [];
        details[away.id] = [];

        const inputs = Array.from(document.querySelectorAll('#match-modal-body input[data-pid][data-field][data-team]'));
        const tmp = { [home.id]: {}, [away.id]: {} };

        inputs.forEach(inp => {
            const pid = normalizeHashId(inp.getAttribute('data-pid'));
            const field = inp.getAttribute('data-field');
            const teamId = inp.getAttribute('data-team');
            const val = parseInt(inp.value) || 0;

            if (!tmp[teamId]) tmp[teamId] = {};
            if (!tmp[teamId][pid]) tmp[teamId][pid] = { g: 0, a: 0, cs: 0 };
            tmp[teamId][pid][field] = val;
        });

        [home.id, away.id].forEach(teamId => {
            details[teamId] = Object.keys(tmp[teamId] || {}).map(pid => ({
                playerId: pid,
                g: tmp[teamId][pid].g || 0,
                a: tmp[teamId][pid].a || 0,
                cs: tmp[teamId][pid].cs || 0
            }));
        });

        const wk = String(week).toUpperCase();
        const stage = (wk.startsWith("SF") || wk === "FINAL") ? "playoff" : "league";

        if (match) {
            // update existing
            match.s1 = s1;
            match.s2 = s2;
            match.details = details;
            match.week = wk;
            match.stage = stage;
            match.createdAt = match.createdAt || Date.now();
        } else {
            matches.push({
                id: Date.now(),
                createdAt: Date.now(),
                league: leagueKey,
                week: wk,
                stage,
                t1Id: home.id,
                t2Id: away.id,
                s1, s2,
                details
            });
        }

        await save();
        alert("Kaydedildi!");
        closeMatchModal();
    };
}

// ---------- Fixture Render (clickable matches) ----------
function renderFixture() {
    const container = $('fixture-display-container');
    if (!container) return;
    container.innerHTML = "";

    Object.keys(fixtures || {}).forEach(l => {
        const fx = fixtures[l];
        if (!fx || typeof fx !== "object") return;

        const display = leaguesMeta[l] || l;
        let html = `<div class="league-card"><h3>${esc(display)} Fikstürü</h3>`;

        // League stage rounds
        const rounds = Array.isArray(fx.rounds) ? fx.rounds : [];
        if (rounds.length) {
            html += `<div class="muted" style="margin-bottom:8px"><b>Lig Süreci</b></div>`;
            rounds.forEach((round, i) => {
                const weekNo = i + 1;
                html += `<div class="week-title" style="margin-top:10px">${weekNo}. Hafta</div>`;

                (round || []).forEach(m => {
                    const lData = leagues[l] || [];
                    const t1 = lData.find(x => x.name === m.home) || {};
                    const t2 = lData.find(x => x.name === m.away) || {};

                    const found = findMatchByFixture(l, String(weekNo), m.home, m.away);
                    const match = found?.match || null;

                    const scoreMid = match
                        ? `<div class="score-container"><div class="score-box">${esc(match.s1)}</div><span>-</span><div class="score-box">${esc(match.s2)}</div></div>`
                        : `<div class="tire-container">-</div>`;

                    html += `
            <div class="fixture-item" onclick="openFixtureMatchModal('${esc(l)}','${esc(String(weekNo))}','${esc(m.home)}','${esc(m.away)}')">
              <div></div>
              <div class="team-home">
                <img src="${esc(t1.logo || '')}" class="team-logo-small" loading="lazy" decoding="async" referrerpolicy="no-referrer"
                     onerror="this.src='https://via.placeholder.com/30?text=?'">
                <span>${esc(m.home)}</span>
              </div>
              ${scoreMid}
              <div class="team-away">
                <span>${esc(m.away)}</span>
                <img src="${esc(t2.logo || '')}" class="team-logo-small" loading="lazy" decoding="async" referrerpolicy="no-referrer"
                     onerror="this.src='https://via.placeholder.com/30?text=?'">
              </div>
              <div></div>
            </div>
          `;
                });
            });
        } else {
            html += `<div class="muted">Lig süreci fikstürü yok.</div>`;
        }

        // Playoff section (template)
        if (fx.playoff) {
            const p = fx.playoff;
            const seeds = p.seeds || {};
            const t1 = getTeamById(l, seeds.seed1) || {};
            const t2 = getTeamById(l, seeds.seed2) || {};
            const t3 = getTeamById(l, seeds.seed3) || {};
            const t4 = getTeamById(l, seeds.seed4) || {};

            html += `<div class="week-title" style="margin-top:18px">Playoff (Top 4)</div>
        <div class="muted" style="margin-bottom:10px">
          Eşleşmeler: <b>1-4</b> ve <b>2-3</b> • Kazananlar Final oynar.
          <br>Sonuç girişi için playoff eşleşmesine tıkla (SF1 / SF2 / FINAL).
        </div>

        <div class="bracket">
          <div class="pair">
            <div class="title">SF1 (1 - 4)</div>
            <div class="teamline"><span>${esc(t1.name || '1.')}</span><span class="pill">Seed 1</span></div>
            <div class="teamline" style="margin-top:8px"><span>${esc(t4.name || '4.')}</span><span class="pill">Seed 4</span></div>
            <div style="margin-top:10px">
              <button class="linkbtn" onclick="openFixtureMatchModal('${esc(l)}','SF1','${esc(t1.name || '')}','${esc(t4.name || '')}')">SF1 Sonuç / Detay</button>
            </div>
          </div>

          <div class="pair">
            <div class="title">SF2 (2 - 3)</div>
            <div class="teamline"><span>${esc(t2.name || '2.')}</span><span class="pill">Seed 2</span></div>
            <div class="teamline" style="margin-top:8px"><span>${esc(t3.name || '3.')}</span><span class="pill">Seed 3</span></div>
            <div style="margin-top:10px">
              <button class="linkbtn" onclick="openFixtureMatchModal('${esc(l)}','SF2','${esc(t2.name || '')}','${esc(t3.name || '')}')">SF2 Sonuç / Detay</button>
            </div>
          </div>

          <div class="pair">
            <div class="title">FINAL</div>
            <div class="muted">SF1 kazananı vs SF2 kazananı (takımları manuel seçip sonuç girebilirsin)</div>
            <div class="muted" style="margin-top:8px">
              Final için: Admin olarak “Sonuç girişi” yaparken iki takımı seçebilmek adına final eşleşmesini ligde iki takıma bağlamadık.
              <br>Pratik: Final oynayacak iki takım belli olunca seed seçimlerini güncelle veya finali ligde iki takıma “fixture” gibi ekle.
            </div>
          </div>
        </div>
      `;
        }

        container.innerHTML += html + `</div>`;
    });
}

// ---------- Players ----------
function getAllUniquePlayersIndex() {
    const map = new Map();
    (players || []).forEach(p => {
        const pid = normalizeHashId(p.playerId);
        if (!pid) return;
        if (!map.has(pid)) map.set(pid, { playerId: pid, name: p.name || "Oyuncu" });
        else if (p.name) map.get(pid).name = p.name;
    });
    return Array.from(map.values());
}

function computePlayerTotalsForId(playerId) {
    const pid = normalizeHashId(playerId);
    const totalsByLeague = {};

    (matches || []).forEach(m => {
        const details = m.details || {};
        const l = m.league;
        const t1 = getTeamById(l, m.t1Id);
        const t2 = getTeamById(l, m.t2Id);

        function add(teamInternalId, teamObj) {
            const list = Array.isArray(details[teamInternalId]) ? details[teamInternalId] : [];
            const item = list.find(x => normalizeHashId(x.playerId) === pid);
            if (!item) return;

            if (!totalsByLeague[l]) totalsByLeague[l] = { league: l, team: "", goals: 0, assists: 0, cs: 0 };
            totalsByLeague[l].goals += (parseInt(item.g) || 0);
            totalsByLeague[l].assists += (parseInt(item.a) || 0);
            totalsByLeague[l].cs += (parseInt(item.cs) || 0);
            if (teamObj && teamObj.name) totalsByLeague[l].team = teamObj.name;
        }

        add(m.t1Id, t1);
        add(m.t2Id, t2);
    });

    Object.keys(leagues || {}).forEach(l => {
        (leagues[l] || []).filter(t => t.id !== "dummy").forEach(t => {
            if (Array.isArray(t.roster) && t.roster.map(normalizeHashId).includes(pid)) {
                if (!totalsByLeague[l]) totalsByLeague[l] = { league: l, team: t.name, goals: 0, assists: 0, cs: 0 };
                if (!totalsByLeague[l].team) totalsByLeague[l].team = t.name;
            }
        });
    });

    return Object.values(totalsByLeague).sort((a, b) => String(a.league).localeCompare(String(b.league)));
}

function renderPlayersList() {
    const wrap = $('players-list');
    if (!wrap) return;

    const uniq = getAllUniquePlayersIndex();
    wrap.innerHTML = uniq.map(p => `
    <div class="mini-card" onclick="showPlayersDetail('${esc(p.playerId)}')">
      <div class="row">
        <div style="font-weight:900">${esc(p.name)} <span class="pill">${esc(p.playerId)}</span></div>
        ${isAdmin ? `<button class="btn-danger btn-small" onclick="event.stopPropagation(); deletePlayerById('${esc(p.playerId)}')">Sil</button>` : ``}
      </div>
      <div class="muted">Detay için tıkla</div>
    </div>
  `).join('') || `<div class="muted">Oyuncu bulunamadı.</div>`;
}

function showPlayersDetail(playerId) {
    const box = $('players-detail');
    if (!box) return;

    const pid = normalizeHashId(playerId);
    const name = getPlayerName(pid);
    const leaguesList = computePlayerTotalsForId(pid);

    box.style.display = 'block';
    box.innerHTML = `
    <div class="row" style="margin-bottom:10px">
      <div>
        <div style="font-size:1.12rem;font-weight:1000">${esc(name)} <span class="pill">${esc(pid)}</span></div>
        <div class="muted"></div>
      </div>
      <div class="row">
        <button class="linkbtn" onclick="$('players-detail').style.display='none'">Kapat</button>
        ${isAdmin ? `<button class="btn-danger btn-small" onclick="deletePlayerById('${esc(pid)}')">Oyuncuyu Sil</button>` : ``}
      </div>
    </div>

    <h3>Lig Bazlı İstatistik</h3>
    <table>
      <tr><th>Lig</th><th>Takım</th><th>Gol</th><th>Asist</th><th>CS</th></tr>
      ${leaguesList.map(x => `
        <tr>
          <td>${esc(leaguesMeta[x.league] || x.league)}</td>
          <td>${esc(x.team || '—')}</td>
          <td><b>${x.goals}</b></td>
          <td><b>${x.assists}</b></td>
          <td><b>${x.cs}</b></td>
        </tr>
      `).join('')}
    </table>
  `;
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function deletePlayerById(playerId) {
    const pid = normalizeHashId(playerId);
    if (!confirm("Bu oyuncu silinsin mi? (Kadro listelerinden kaldırılır. Maç geçmişindeki istatistikler korunur.)")) return;

    players = (players || []).filter(p => normalizeHashId(p.playerId) !== pid);

    Object.keys(leagues || {}).forEach(l => {
        (leagues[l] || []).forEach(t => {
            if (t && t.id !== "dummy" && Array.isArray(t.roster)) {
                t.roster = t.roster.map(normalizeHashId).filter(x => x && x !== pid);
            }
        });
    });

    save();
    alert("Oyuncu silindi!");
    $('players-detail') && ($('players-detail').style.display = 'none');
    renderPlayersList();
    renderTeamsList();
    renderStats();
}

function createOrOverwritePlayer() {
    const l = $('player-create-league')?.value || "";
    const rawId = ($('player-id-input')?.value || "").trim();
    const name = ($('player-name-input')?.value || "").trim();

    if (!l) return alert("Lig seçin!");
    if (!rawId || !isValidHashId(rawId)) return alert("Oyuncu ID geçersiz! (# ile başlayacak, sadece harf/rakam).");
    if (!name) return alert("Oyuncu adı girin!");

    const pid = normalizeHashId(rawId);
    const ex = (players || []).find(p => normalizeHashId(p.playerId) === pid);
    if (ex) ex.name = name;
    else players.push({ id: Date.now(), playerId: pid, name });

    $('player-id-input') && ($('player-id-input').value = "");
    $('player-name-input') && ($('player-name-input').value = "");

    save();
    alert("Oyuncu kaydedildi!");
}

function updateAssignTeams() {
    const l = $('player-assign-league')?.value || "";
    const s = $('player-assign-team');
    if (!s) return;
    const prev = s.value;

    s.innerHTML = '<option value="">Takım Seçin</option>';
    (leagues[l] || []).forEach(t => {
        if (t.id !== "dummy") s.innerHTML += `<option value="${esc(t.id)}">${esc(t.name)}</option>`;
    });
    s.value = prev;
}

function assignPlayerToTeam() {
    const l = $('player-assign-league')?.value || "";
    const teamInternalId = $('player-assign-team')?.value || "";
    const rawPid = ($('player-assign-id')?.value || "").trim();

    if (!l || !teamInternalId) return alert("Lig ve takım seçin!");
    if (!rawPid || !isValidHashId(rawPid)) return alert("Oyuncu ID geçersiz!");

    const pid = normalizeHashId(rawPid);
    const team = getTeamById(l, teamInternalId);
    if (!team) return alert("Takım bulunamadı!");

    if (!(players || []).some(p => normalizeHashId(p.playerId) === pid)) {
        players.push({ id: Date.now(), playerId: pid, name: "Oyuncu" });
    }

    (leagues[l] || []).forEach(t => {
        if (t.id !== "dummy" && Array.isArray(t.roster)) {
            t.roster = t.roster.map(normalizeHashId).filter(x => x && x !== pid);
        }
    });

    if (!Array.isArray(team.roster)) team.roster = [];
    if (!team.roster.map(normalizeHashId).includes(pid)) team.roster.push(pid);

    save();
    alert("Oyuncu takıma eklendi!");
    $('player-assign-id') && ($('player-assign-id').value = "");
    renderPlayersList();
    renderTeamsList();
}

// ---------- Teams ----------
function findTeamByTeamId(teamId) {
    const tid = normalizeHashId(teamId);
    for (const l of Object.keys(leagues || {})) {
        if (!Array.isArray(leagues[l])) continue;
        const t = (leagues[l] || []).find(x => x && x.id !== "dummy" && normalizeHashId(x.teamId) === tid);
        if (t) return { leagueKey: l, leagueName: leaguesMeta[l] || l, team: t };
    }
    return null;
}

function renderTeamsList() {
    const wrap = $('teams-list');
    if (!wrap) return;

    let all = [];
    Object.keys(leagues || {}).forEach(l => {
        if (!Array.isArray(leagues[l])) return;
        leagues[l].filter(t => t.id !== "dummy").forEach(t => all.push({ leagueKey: l, leagueName: leaguesMeta[l] || l, team: t }));
    });

    const leagueAgg = {};
    Object.keys(leagues || {}).forEach(l => {
        if (Array.isArray(leagues[l])) leagueAgg[l] = buildLeagueAggregates(l).teamStats;
    });

    wrap.innerHTML = all.map(x => {
        const st = (leagueAgg[x.leagueKey] || {})[x.team.id] || { pts: 0, gd: 0 };
        return `
      <div class="mini-card" onclick="showTeamDetail('${esc(x.team.teamId)}')">
        <div class="row">
          <div class="team-cell">
            <img class="team-logo-small" src="${esc(x.team.logo || '')}" loading="lazy" decoding="async" referrerpolicy="no-referrer"
                 onerror="this.src='https://via.placeholder.com/30?text=?'">
            <div>
              <div style="font-weight:900">${esc(x.team.name)}</div>
              <div class="muted">${esc(x.leagueName)} • <span class="pill">${esc(x.team.teamId)}</span></div>
            </div>
          </div>
          <div class="pill">P: ${st.pts} • AV: ${st.gd}</div>
        </div>
        <div class="muted" style="margin-top:6px">Kadro için tıkla</div>
      </div>
    `;
    }).join('') || `<div class="muted">Takım bulunamadı.</div>`;
}

function showTeamDetail(teamId) {
    const box = $('teams-detail');
    if (!box) return;

    const found = findTeamByTeamId(teamId);
    if (!found) {
        box.style.display = 'block';
        box.innerHTML = `<h3>Takım bulunamadı</h3><div class="muted">Bu ID ile takım yok.</div>`;
        return;
    }

    const { leagueKey, leagueName, team } = found;
    const roster = Array.isArray(team.roster) ? team.roster.map(normalizeHashId).filter(Boolean) : [];

    const { teamStats } = buildLeagueAggregates(leagueKey);
    const st = teamStats[team.id] || { pts: 0, gd: 0, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };

    const rosterRows = roster.map(pid => {
        const totals = computePlayerTotalsForId(pid).find(x => x.league === leagueKey) || { goals: 0, assists: 0, cs: 0 };
        return { pid, nm: getPlayerName(pid), g: totals.goals || 0, a: totals.assists || 0, cs: totals.cs || 0 };
    }).sort((x, y) => (y.g - x.g) || (y.a - x.a) || (y.cs - x.cs) || String(x.nm).localeCompare(String(y.nm), 'tr'));

    box.style.display = 'block';
    box.innerHTML = `
    <div class="row" style="margin-bottom:10px">
      <div class="team-cell">
        <img class="team-logo-small" src="${esc(team.logo || '')}" loading="lazy" decoding="async" referrerpolicy="no-referrer"
             onerror="this.src='https://via.placeholder.com/30?text=?'">
        <div>
          <div style="font-size:1.12rem;font-weight:1000">${esc(team.name)} <span class="pill">${esc(team.teamId)}</span></div>
          <div class="muted">${esc(leagueName)} • P: <b>${st.pts}</b> • AV: <b>${st.gd}</b> • O: ${st.played}</div>
        </div>
      </div>
      <div class="row">
        <button class="linkbtn" onclick="$('teams-detail').style.display='none'">Kapat</button>
        ${isAdmin ? `<button class="btn-danger btn-small" onclick="deleteTeamById('${esc(team.teamId)}')">Takımı Sil</button>` : ``}
      </div>
    </div>

    <h3>Kadro</h3>
    ${rosterRows.length ? `
      <table>
        <tr><th>Oyuncu</th><th>Gol</th><th>Asist</th><th>CS</th></tr>
        ${rosterRows.map(r => `
          <tr style="cursor:pointer" onclick="setRoute('players'); showPlayersDetail('${esc(r.pid)}')">
            <td>${esc(r.nm)} <span class="pill">${esc(r.pid)}</span></td>
            <td><b>${r.g}</b></td>
            <td><b>${r.a}</b></td>
            <td><b>${r.cs}</b></td>
          </tr>
        `).join('')}
      </table>
    ` : `<div class="muted">Kadro boş.</div>`}
  `;
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function deleteTeamById(teamId) {
    const found = findTeamByTeamId(teamId);
    if (!found) return alert("Takım bulunamadı!");
    const { leagueKey, team } = found;

    if (!confirm(`${team.name} takımı tamamen silinsin mi? (Kadro temizlenir, maç geçmişi korunur.)`)) return;

    leagues[leagueKey] = (leagues[leagueKey] || []).filter(t => t.id !== team.id);
    save();
    alert("Takım silindi!");
    renderTeamsList();
    $('teams-detail') && ($('teams-detail').style.display = 'none');
}

// ---------- Stats (Krallık) ----------
function renderStats() {
    const container = $('stats-display-container');
    if (!container) return;
    container.innerHTML = "";

    Object.keys(leagues || {}).forEach(l => {
        if (!Array.isArray(leagues[l])) return;

        const { playerStats } = buildLeagueAggregates(l);
        const list = Object.values(playerStats || {});
        if (!list.length) return;

        const dn = leaguesMeta[l] || l;
        let html = `<h2>${esc(dn)} - İstatistikler</h2><div class="stats-grid">`;

        const goals = list.filter(p => p.goals > 0).sort((a, b) => b.goals - a.goals).slice(0, 5);
        html += `<div class="stats-card"><h3>Gol Krallığı</h3><table>`;
        goals.forEach(p => {
            html += `<tr style="cursor:pointer" onclick="setRoute('players'); showPlayersDetail('${esc(p.playerId)}')">
        <td>${esc(p.name)} <span class="pill">${esc(p.playerId)}</span></td>
        <td style="text-align:right"><b>${p.goals}</b></td>
      </tr>`;
        });
        html += `</table></div>`;

        const assists = list.filter(p => p.assists > 0).sort((a, b) => b.assists - a.assists).slice(0, 5);
        html += `<div class="stats-card"><h3>Asist Krallığı</h3><table>`;
        assists.forEach(p => {
            html += `<tr style="cursor:pointer" onclick="setRoute('players'); showPlayersDetail('${esc(p.playerId)}')">
        <td>${esc(p.name)} <span class="pill">${esc(p.playerId)}</span></td>
        <td style="text-align:right"><b>${p.assists}</b></td>
      </tr>`;
        });
        html += `</table></div>`;

        const clean = list.filter(p => p.cs > 0).sort((a, b) => b.cs - a.cs).slice(0, 5);
        html += `<div class="stats-card"><h3>CS Krallığı</h3><table>`;
        clean.forEach(p => {
            html += `<tr style="cursor:pointer" onclick="setRoute('players'); showPlayersDetail('${esc(p.playerId)}')">
        <td>${esc(p.name)} <span class="pill">${esc(p.playerId)}</span></td>
        <td style="text-align:right"><b>${p.cs}</b></td>
      </tr>`;
        });
        html += `</table></div>`;

        html += `</div>`;
        container.innerHTML += html;
    });
}

// ---------- Select updates ----------
function updateSeedSelects() {
    const l = $('fixture-league-select')?.value || "";
    const seedIds = ['seed1', 'seed2', 'seed3', 'seed4'];
    seedIds.forEach(id => {
        const s = $(id);
        if (!s) return;
        const prev = s.value;
        s.innerHTML = `<option value="">(Otomatik)</option>`;
        (leagues[l] || []).filter(t => t.id !== "dummy").forEach(t => {
            s.innerHTML += `<option value="${esc(t.id)}">${esc(t.name)}</option>`;
        });
        s.value = prev;
    });
}

function updateLeagueSelects() {
    const leagueKeys = Object.keys(leagues || {}).filter(k => Array.isArray(leagues[k]));
    const ids = ['team-league-select', 'fixture-league-select', 'player-create-league', 'player-assign-league'];
    ids.forEach(id => {
        const s = $(id);
        if (!s) return;
        const val = s.value;
        s.innerHTML = '<option value="">Lig Seçin</option>' + leagueKeys.map(l => {
            const dn = leaguesMeta[l] || l;
            return `<option value="${esc(l)}">${esc(dn)}</option>`;
        }).join('');
        s.value = val;
    });

    updateSeedSelects();

    if ($('player-assign-league') && $('player-assign-league').value) {
        updateAssignTeams();
    }
}

// ---------- Render all ----------
function renderAll() {
    renderNews();
    renderStandings();
    renderFixture();
    renderStats();
    renderTeamsList();
    renderPlayersList();
}

// ---------- Wire up events ----------
document.addEventListener('DOMContentLoaded', () => {
    // hamburger
    $('hamburger')?.addEventListener('click', toggleMenu);

    // nav links -> route
    Array.from(document.querySelectorAll('nav a[data-route]')).forEach(a => {
        a.addEventListener('click', () => setRoute(a.getAttribute('data-route')));
    });

    // hash route changes
    window.addEventListener('hashchange', renderRoute);
    renderRoute(); // initial

    // admin
    $('btn-login-google')?.addEventListener('click', loginWithGoogle);
    $('btn-logout')?.addEventListener('click', logout);

    // modal close
    $('btn-modal-close')?.addEventListener('click', closeMatchModal);
    $('match-modal-backdrop')?.addEventListener('click', (e) => {
        if (e.target && e.target.id === "match-modal-backdrop") closeMatchModal();
    });

    // news
    $('btn-publish-news')?.addEventListener('click', publishNews);

    // standings admin tools
    $('btn-add-league')?.addEventListener('click', addLeague);
    $('btn-add-team')?.addEventListener('click', addTeam);
    $('btn-delete-league')?.addEventListener('click', deleteLeague);

    // fixture admin tools
    $('btn-generate-fixture')?.addEventListener('click', generateFixtureSingleLeg);
    $('btn-delete-fixture')?.addEventListener('click', deleteFixture);
    $('btn-create-playoff')?.addEventListener('click', createPlayoffTemplate);

    $('fixture-league-select')?.addEventListener('change', updateSeedSelects);

    // players admin tools
    $('btn-create-player')?.addEventListener('click', createOrOverwritePlayer);
    $('player-assign-league')?.addEventListener('change', updateAssignTeams);
    $('btn-assign-player')?.addEventListener('click', assignPlayerToTeam);

    // default route
    if (!window.location.hash) setRoute('news');
});
