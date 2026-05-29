'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const HOUR_START = 9;
const HOUR_END   = 21;
const SLOT_PX    = 60; // px per hour

const COLORS = [
  '#E85D9A','#F4845F','#F7C244','#6DBF82','#5BB8D4',
  '#7B6FD4','#D46FA8','#4BA896','#D46F6F','#5A87C8',
];

const DAY_NAMES = ['日','月','火','水','木','金','土'];

// ─── Business Hours ────────────────────────────────────────────────────────────
// Index: 0=日 1=月 2=火 3=水 4=木 5=金 6=土   null = 定休日
const BUSINESS_HOURS = [
  null,                               // 日 定休日
  { open: '17:00', close: '19:30' }, // 月 夕方のみ
  { open: '10:00', close: '19:30' }, // 火
  { open: '17:00', close: '19:30' }, // 水 夕方のみ
  { open: '17:00', close: '19:30' }, // 木 夕方のみ
  null,                               // 金 定休日
  null,                               // 土 定休日
];

function getBusinessHours(ds) {
  const dow = new Date(ds + 'T00:00:00').getDay();
  return BUSINESS_HOURS[dow] ?? null;
}

function isOpenSlot(ds, hourStr) {
  const bh = getBusinessHours(ds);
  if (!bh) return false;
  const t = timeToMin(hourStr);
  return t >= timeToMin(bh.open) && t < timeToMin(bh.close);
}

// ─── SalonBoard Integration ────────────────────────────────────────────────────

const SB_KEY      = 'salonboard_sync_v1';
const SB_TIME_KEY = 'salonboard_sync_time';
const SB_DEFAULT_DURATION = 60; // fallback duration (min) for SB reservations

function getSBReservations() {
  const raw = localStorage.getItem(SB_KEY);
  return raw ? JSON.parse(raw) : [];
}

function saveSBReservations(list) {
  localStorage.setItem(SB_KEY, JSON.stringify(list));
  localStorage.setItem(SB_TIME_KEY, new Date().toISOString());
  updateSyncBadge();
}

// sb-sync.json をリポジトリから取得して localStorage を更新（常にファイルを優先）
async function fetchSBSync() {
  try {
    const res = await fetch('./sb-sync.json?t=' + Date.now());
    if (!res.ok) return;
    const json = await res.json();
    // { syncTime, reservations } 形式
    const list = Array.isArray(json) ? json : (json.reservations || []);
    const syncTime = json.syncTime || new Date().toISOString();
    if (!list.length) return;
    localStorage.setItem(SB_KEY, JSON.stringify(list));
    localStorage.setItem(SB_TIME_KEY, syncTime);
    updateSyncBadge();
  } catch(e) { /* ネットワークエラーは無視 */ }
}

function updateSyncBadge() {
  const dot   = document.getElementById('sb-dot');
  const label = document.getElementById('sb-sync-label');
  const t     = localStorage.getItem(SB_TIME_KEY);
  const list  = getSBReservations();
  if (!t || !list.length) {
    dot.className = 'sb-dot'; label.textContent = 'SB未同期';
  } else {
    const d = new Date(t);
    const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    dot.className = 'sb-dot synced';
    label.textContent = `SB同期済 ${d.getMonth()+1}/${d.getDate()} ${hhmm} (${list.length}件)`;
  }
}

// ─── Conflict Detection ───────────────────────────────────────────────────────

function timeToMin(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function checkConflicts(newRes) {
  const menu = getMenu(newRes.menuId);
  if (!menu) return { local: [], sb: [] };

  const nStart = timeToMin(newRes.time);
  const nEnd   = nStart + menu.duration;

  // ─ local reservations (same staff, same date)
  const local = db.reservations.filter(r => {
    if (r.id === newRes.id)          return false;
    if (r.date    !== newRes.date)   return false;
    if (+r.staffId !== +newRes.staffId) return false;
    const m2 = getMenu(r.menuId);
    if (!m2) return false;
    const rStart = timeToMin(r.time);
    return overlaps(nStart, nEnd, rStart, rStart + m2.duration);
  });

  // ─ SalonBoard reservations (same date, any stylist → soft warning)
  const sb = getSBReservations().filter(r => {
    if (r.date !== newRes.date) return false;
    const rStart = timeToMin(r.time);
    const rEnd   = rStart + (r.duration || SB_DEFAULT_DURATION);
    return overlaps(nStart, nEnd, rStart, rEnd);
  });

  return { local, sb };
}

// ─── Data ─────────────────────────────────────────────────────────────────────

let db = { staff: [], menus: [], reservations: [] };

function loadDB() {
  const raw = localStorage.getItem('salonboard_v3');
  if (raw) { db = JSON.parse(raw); return; }

  // seed data
  db.staff = [
    { id: 1, name: '山田 花子', color: '#E85D9A' },
    { id: 2, name: '鈴木 さくら', color: '#5BB8D4' },
    { id: 3, name: '田中 美咲', color: '#6DBF82' },
  ];
  db.menus = [
    { id: 1, name: 'カット',              duration: 30,  price: 0 },
    { id: 2, name: 'カットカラー',        duration: 90,  price: 0 },
    { id: 3, name: '縮毛矯正',            duration: 120, price: 0 },
    { id: 4, name: 'リタッチのみ',        duration: 60,  price: 0 },
    { id: 5, name: 'カット＋シャンプー',  duration: 30,  price: 0 },
    { id: 6, name: 'カット＋ブロー',      duration: 30,  price: 0 },
    { id: 7, name: '相談したい',          duration: 90,  price: 0 },
    { id: 8, name: 'ヘナ＋カット',        duration: 90,  price: 0 },
  ];
  const today = dateStr(new Date());
  db.reservations = [
    { id:1, date:today, time:'10:00', customerName:'佐藤 由美',   phone:'090-1234-5678', staffId:1, menuId:1, notes:'' },
    { id:2, date:today, time:'10:30', customerName:'伊藤 めぐみ', phone:'080-9876-5432', staffId:2, menuId:2, notes:'' },
    { id:3, date:today, time:'13:00', customerName:'渡辺 あおい', phone:'',              staffId:1, menuId:3, notes:'' },
    { id:4, date:today, time:'11:00', customerName:'小林 はな',   phone:'090-3333-4444', staffId:2, menuId:4, notes:'' },
  ];
  saveDB();

  // Seed SalonBoard sync data if none exists
  if (!localStorage.getItem(SB_KEY)) {
    const today = dateStr(new Date());
    // Calculate next weekday dates for demo SB reservations
    const d1 = nextWeekday(3); // Wednesday-ish
    const d2 = nextWeekday(4); // Thursday-ish
    saveSBReservations([
      { date: d1, time: '11:00', customerName: '文 明姫',   reservationNo: 'BF02753038', stylist: '指名なし', menu: 'シルエットカット',          duration: 60, source: 'salonboard' },
      { date: d1, time: '11:30', customerName: '梅本 友希', reservationNo: 'BF03417081', stylist: '指名なし', menu: 'レディースシルエットカット', duration: 60, source: 'salonboard' },
      { date: d2, time: '18:30', customerName: '赤津 未来', reservationNo: 'BF03085526', stylist: '指名なし', menu: 'シルエットカット',          duration: 60, source: 'salonboard' },
    ]);
  }
}

// ─── Menu Migration ───────────────────────────────────────────────────────────
// 新しいメニューが既存データに未登録なら追加する
const BUILTIN_MENUS = [
  { id: 1, name: 'カット',              duration: 30,  price: 0 },
  { id: 2, name: 'カットカラー',        duration: 90,  price: 0 },
  { id: 3, name: '縮毛矯正',            duration: 120, price: 0 },
  { id: 4, name: 'リタッチのみ',        duration: 60,  price: 0 },
  { id: 5, name: 'カット＋シャンプー',  duration: 30,  price: 0 },
  { id: 6, name: 'カット＋ブロー',      duration: 30,  price: 0 },
  { id: 7, name: '相談したい',          duration: 90,  price: 0 },
  { id: 8, name: 'ヘナ＋カット',        duration: 90,  price: 0 },
];

function migrateMenus() {
  let changed = false;
  BUILTIN_MENUS.forEach(bm => {
    const exists = db.menus.some(m => m.name === bm.name);
    if (!exists) {
      // IDが衝突しないよう安全なIDを割り当て
      const newId = Math.max(0, ...db.menus.map(m => m.id)) + 1;
      db.menus.push({ ...bm, id: newId });
      changed = true;
    }
  });
  if (changed) saveDB();
}

// Returns a date string N days from today (to make demo SB data visible in calendar)
function nextWeekday(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return dateStr(d);
}

function saveDB() {
  localStorage.setItem('salonboard_v3', JSON.stringify(db));
}

function nextId(arr) {
  return arr.length ? Math.max(...arr.map(x => x.id)) + 1 : 1;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function pad(n) { return String(n).padStart(2,'0'); }

function displayDate(str) {
  const [y,m,d] = str.split('-');
  return `${y}年${parseInt(m)}月${parseInt(d)}日`;
}

function getStaff(id) { return db.staff.find(s => s.id === +id); }
function getMenu(id)  { return db.menus.find(m => m.id === +id); }

function addMinutes(timeStr, mins) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + mins;
  return `${pad(Math.floor(total/60))}:${pad(total%60)}`;
}

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.replace('#',''), 16);
  return `rgba(${n>>16},${(n>>8)&0xff},${n&0xff},${alpha})`;
}

function darken(hex, amt) {
  const n = parseInt(hex.replace('#',''),16);
  const r = Math.max(0,(n>>16)-amt);
  const g = Math.max(0,((n>>8)&0xff)-amt);
  const b = Math.max(0,(n&0xff)-amt);
  return `#${((r<<16)|(g<<8)|b).toString(16).padStart(6,'0')}`;
}

// generate time options every 30 min — filtered to business hours if dateStr given
function buildTimeOptions(dateStr) {
  const bh = dateStr ? getBusinessHours(dateStr) : null;
  const openMin  = bh ? timeToMin(bh.open)  : HOUR_START * 60;
  const closeMin = bh ? timeToMin(bh.close) : HOUR_END   * 60;
  const opts = [];
  for (let h = HOUR_START; h < HOUR_END; h++) {
    for (const m of [0, 30]) {
      const tMin = h * 60 + m;
      if (tMin >= openMin && tMin < closeMin) opts.push(`${pad(h)}:${pad(m)}`);
    }
  }
  return opts;
}

// ─── State ────────────────────────────────────────────────────────────────────

let currentView   = 'calendar';
let calView       = 'week';      // 'week' | 'day'
let cursorDate    = new Date();
let editResId     = null;
let editStaffId   = null;
let editMenuId    = null;

// ─── View switching ───────────────────────────────────────────────────────────

function switchView(name) {
  currentView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
  document.querySelector(`.nav-tab[data-view="${name}"]`).classList.add('active');
  render();
}

function render() {
  switch(currentView) {
    case 'calendar':     renderCalendar();     break;
    case 'reservations': renderResList();      break;
    case 'staff':        renderStaffGrid();    break;
    case 'menu':         renderMenuGrid();     break;
  }
}

// ─── Calendar ─────────────────────────────────────────────────────────────────

function weekDates(base) {
  const d = new Date(base);
  const dow = d.getDay();
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1)); // Monday
  return Array.from({length:7}, (_,i) => { const x=new Date(d); x.setDate(d.getDate()+i); return x; });
}

function renderCalendar() {
  const grid   = document.getElementById('calendar-grid');
  const timeCol = document.getElementById('time-column');
  const title  = document.getElementById('period-title');
  const todayS = dateStr(new Date());

  // Build time labels (only once if already built)
  if (!timeCol.querySelector('.time-label')) {
    for (let h = HOUR_START; h < HOUR_END; h++) {
      const el = document.createElement('div');
      el.className = 'time-label';
      el.textContent = `${h}:00`;
      timeCol.appendChild(el);
    }
  }

  const dates = calView === 'week' ? weekDates(cursorDate) : [cursorDate];

  // Title
  if (calView === 'week') {
    const s = dates[0], e = dates[6];
    title.textContent = `${s.getFullYear()}年${s.getMonth()+1}月${s.getDate()}日 〜 ${e.getMonth()+1}月${e.getDate()}日`;
  } else {
    const d = cursorDate;
    title.textContent = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${DAY_NAMES[d.getDay()]}）`;
  }

  grid.innerHTML = '';

  dates.forEach(date => {
    const ds  = dateStr(date);
    const col = document.createElement('div');
    col.className = 'day-col';

    // Business hours for this day
    const bh = getBusinessHours(ds);

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'day-col-header'
      + (ds === todayS ? ' is-today' : '')
      + (!bh ? ' is-closed' : '');

    const wn = document.createElement('div');
    const dow = date.getDay();
    wn.className = 'day-weekname' + (dow === 0 ? ' sun' : dow === 6 ? ' sat' : '');
    wn.textContent = DAY_NAMES[dow];

    const dn = document.createElement('div');
    dn.className = 'day-daynum';
    dn.textContent = date.getDate();

    hdr.append(wn, dn);
    col.appendChild(hdr);

    // Slots container
    const slots = document.createElement('div');
    slots.className = 'day-slots';
    const hours = HOUR_END - HOUR_START;
    slots.style.height = `${hours * SLOT_PX}px`;
    slots.style.position = 'relative';

    // 定休日オーバーレイ
    if (!bh) {
      const overlay = document.createElement('div');
      overlay.className = 'holiday-overlay';
      overlay.innerHTML = '<span>休業日</span>';
      slots.appendChild(overlay);
    }

    // Background hour cells
    for (let h = HOUR_START; h < HOUR_END; h++) {
      const cell = document.createElement('div');
      const timeVal = `${pad(h)}:00`;
      const open = isOpenSlot(ds, timeVal);
      cell.className = 'hour-slot' + (open ? '' : ' closed');
      cell.style.cssText = `position:absolute;top:${(h-HOUR_START)*SLOT_PX}px;left:0;right:0;height:${SLOT_PX}px`;
      if (open) cell.addEventListener('click', () => openNewRes(ds, timeVal));
      slots.appendChild(cell);
    }

    // Lay out reservations (handle overlap with column splitting)
    const dayRes = db.reservations
      .filter(r => r.date === ds)
      .map(r => {
        const [h,m] = r.time.split(':').map(Number);
        const menu = getMenu(r.menuId);
        return { ...r, startMin: h*60+m, endMin: h*60+m+(menu?.duration||60) };
      })
      .sort((a,b) => a.startMin - b.startMin);

    // Assign columns to overlapping blocks
    const cols = []; // each element is array of reservations in that "lane"
    dayRes.forEach(res => {
      let placed = false;
      for (let c = 0; c < cols.length; c++) {
        const last = cols[c][cols[c].length-1];
        if (last.endMin <= res.startMin) {
          cols[c].push(res);
          res._lane = c;
          placed = true;
          break;
        }
      }
      if (!placed) { res._lane = cols.length; cols.push([res]); }
    });
    const numLanes = cols.length || 1;

    dayRes.forEach(res => {
      const staff = getStaff(res.staffId);
      const menu  = getMenu(res.menuId);
      if (!staff || !menu) return;

      const topPx    = ((res.startMin - HOUR_START*60) / 60) * SLOT_PX;
      const heightPx = Math.max((menu.duration / 60) * SLOT_PX - 2, 22);
      const laneW    = 100 / numLanes;
      const laneL    = res._lane * laneW;

      const block = document.createElement('div');
      block.className = 'res-block';
      block.style.cssText = `
        top:${topPx}px; height:${heightPx}px;
        left:calc(${laneL}% + 3px); width:calc(${laneW}% - 6px);
        background:${hexToRgba(staff.color, .22)};
        border-left-color:${staff.color};
        color:${darken(staff.color, 50)};
      `;

      const endT = addMinutes(res.time, menu.duration);
      block.innerHTML = `
        <div class="rb-name">${res.customerName}</div>
        <div class="rb-menu">${menu.name}</div>
        ${heightPx > 44 ? `<div class="rb-time">${res.time}〜${endT}</div>` : ''}
      `;
      block.addEventListener('click', e => { e.stopPropagation(); openEditRes(res.id); });
      slots.appendChild(block);
    });

    // ── SalonBoard reservation blocks (read-only, gray striped)
    const sbRes = getSBReservations().filter(r => r.date === ds);
    sbRes.forEach(res => {
      const [h, m] = res.time.split(':').map(Number);
      const startMin = h * 60 + m;
      const dur      = res.duration || SB_DEFAULT_DURATION;
      const topPx    = ((startMin - HOUR_START * 60) / 60) * SLOT_PX;
      const heightPx = Math.max((dur / 60) * SLOT_PX - 2, 22);

      const block = document.createElement('div');
      block.className = 'sb-block';
      block.style.cssText = `top:${topPx}px; height:${heightPx}px;`;
      block.title = `[SalonBoard] ${res.customerName} ${res.time}〜 ${res.menu || ''}`;
      block.innerHTML = `
        <span class="sb-tag">SB</span>
        <div class="sb-name">${res.customerName}</div>
        ${heightPx > 40 ? `<div class="sb-menu">${res.menu || ''}</div>` : ''}
      `;
      slots.appendChild(block);
    });

    col.appendChild(slots);
    grid.appendChild(col);
  });
}

// ─── Reservations List ────────────────────────────────────────────────────────

function renderResList(q = '') {
  const container = document.getElementById('reservations-list');
  let list = [...db.reservations];

  if (q) {
    const lq = q.toLowerCase();
    list = list.filter(r =>
      r.customerName.toLowerCase().includes(lq) ||
      r.phone?.includes(lq) ||
      (getMenu(r.menuId)?.name||'').includes(lq) ||
      (getStaff(r.staffId)?.name||'').includes(lq)
    );
  }

  list.sort((a,b) => (b.date+b.time).localeCompare(a.date+a.time));

  if (!list.length) {
    container.innerHTML = `<div class="empty-state"><div class="es-icon">📋</div>予約がありません</div>`;
    return;
  }

  container.innerHTML = list.map(r => {
    const staff = getStaff(r.staffId);
    const menu  = getMenu(r.menuId);
    const endT  = menu ? addMinutes(r.time, menu.duration) : '?';
    return `
      <div class="res-card" onclick="openEditRes(${r.id})">
        <div class="rc-dot" style="background:${staff?.color||'#ccc'}"></div>
        <div class="rc-body">
          <div class="rc-name">${r.customerName}</div>
          <div class="rc-sub">
            ${menu?.name||'—'} &nbsp;·&nbsp; ${staff?.name||'—'}
            ${r.phone ? `&nbsp;·&nbsp; ${r.phone}` : ''}
          </div>
        </div>
        <div class="rc-time">
          <div class="rc-date">${displayDate(r.date)}</div>
          <div class="rc-dur">${r.time}〜${endT}（${menu?.duration||'?'}分）</div>
        </div>
      </div>`;
  }).join('');
}

// ─── Staff Grid ───────────────────────────────────────────────────────────────

function renderStaffGrid() {
  const grid = document.getElementById('staff-grid');
  if (!db.staff.length) {
    grid.innerHTML = `<div class="empty-state"><div class="es-icon">👥</div>スタッフがいません</div>`;
    return;
  }
  grid.innerHTML = db.staff.map(s => {
    const cnt = db.reservations.filter(r => r.staffId === s.id).length;
    return `
      <div class="staff-card" onclick="openEditStaff(${s.id})">
        <div class="sc-bar" style="background:${s.color}"></div>
        <div class="sc-name">${s.name}</div>
        <div class="sc-count">予約 ${cnt} 件</div>
      </div>`;
  }).join('');
}

// ─── Menu Grid ────────────────────────────────────────────────────────────────

function renderMenuGrid() {
  const grid = document.getElementById('menu-grid');
  if (!db.menus.length) {
    grid.innerHTML = `<div class="empty-state"><div class="es-icon">✂️</div>メニューがありません</div>`;
    return;
  }
  grid.innerHTML = db.menus.map(m => {
    const cnt = db.reservations.filter(r => r.menuId === m.id).length;
    return `
      <div class="menu-card" onclick="openEditMenu(${m.id})">
        <div class="mc-name">${m.name}</div>
        <div class="mc-price">¥${m.price.toLocaleString()}</div>
        <div class="mc-meta">${m.duration}分 &nbsp;·&nbsp; 予約 ${cnt} 件</div>
      </div>`;
  }).join('');
}

// ─── Reservation Modal ────────────────────────────────────────────────────────

function populateTimeSelect(selected, dateStr) {
  const sel = document.getElementById('res-time');
  const bh  = dateStr ? getBusinessHours(dateStr) : null;

  // 定休日の場合
  if (dateStr && bh === null) {
    sel.innerHTML = '<option value="">— 定休日 —</option>';
    return;
  }

  const opts = buildTimeOptions(dateStr);
  const best = opts.includes(selected) ? selected : (opts[0] || '');
  sel.innerHTML = opts.map(t =>
    `<option value="${t}" ${t === best ? 'selected' : ''}>${t}</option>`
  ).join('');
}

function populateStaffSelect(selected) {
  const sel = document.getElementById('res-staff');
  sel.innerHTML = `<option value="">選択してください</option>` +
    db.staff.map(s => `<option value="${s.id}" ${s.id===+selected?'selected':''}>${s.name}</option>`).join('');
}

function populateMenuSelect(selected) {
  const sel = document.getElementById('res-menu');
  sel.innerHTML = `<option value="">選択してください</option>` +
    db.menus.map(m =>
      `<option value="${m.id}" ${m.id===+selected?'selected':''}>${m.name}（${m.duration}分 / ¥${m.price.toLocaleString()}）</option>`
    ).join('');
}

function updateEndTimeHint() {
  const timeVal  = document.getElementById('res-time').value;
  const menuId   = document.getElementById('res-menu').value;
  const staffId  = document.getElementById('res-staff').value;
  const dateVal  = document.getElementById('res-date').value;
  const hint     = document.getElementById('res-endtime-display');
  const warn     = document.getElementById('conflict-warning');

  if (timeVal && menuId) {
    const menu = getMenu(menuId);
    if (menu) {
      hint.textContent = `終了予定 ${addMinutes(timeVal, menu.duration)}（${menu.duration}分）`;
    }
  } else {
    hint.textContent = '';
  }

  // Live conflict check whenever form values change
  if (dateVal && timeVal && menuId && staffId) {
    const draft = { id: editResId, date: dateVal, time: timeVal,
                    menuId: +menuId, staffId: +staffId };
    showConflictWarning(checkConflicts(draft));
  } else {
    warn.style.display = 'none';
  }
}

function showConflictWarning({ local, sb }) {
  const warn = document.getElementById('conflict-warning');
  if (!local.length && !sb.length) { warn.style.display = 'none'; return; }

  const isHard = local.length > 0;
  warn.className = `conflict-warning${isHard ? ' hard' : ''}`;
  warn.style.display = 'block';

  let html = `<div class="cw-title">${isHard ? '🚫' : '⚠️'} ${isHard ? '予約が重複しています' : 'サロンボードに近い時間帯の予約があります'}</div>`;

  local.forEach(r => {
    const menu = getMenu(r.menuId);
    const endT = addMinutes(r.time, menu?.duration || 60);
    html += `<div class="cw-item">● [このアプリ] ${r.customerName} ${r.time}〜${endT}（${menu?.name || ''}）</div>`;
  });
  sb.forEach(r => {
    const endT = addMinutes(r.time, r.duration || SB_DEFAULT_DURATION);
    html += `<div class="cw-item">● [SalonBoard] ${r.customerName} ${r.time}〜${endT}（${r.menu || ''}）</div>`;
  });

  warn.innerHTML = html;
}

function openNewRes(date, time) {
  editResId = null;
  const dateVal = date || dateStr(new Date());
  document.getElementById('res-modal-title').textContent = '新規予約';
  document.getElementById('res-id').value = '';
  document.getElementById('res-customer').value = '';
  document.getElementById('res-phone').value    = '';
  document.getElementById('res-date').value     = dateVal;
  document.getElementById('res-notes').value    = '';
  document.getElementById('res-delete-btn').style.display = 'none';
  const bh = getBusinessHours(dateVal);
  populateTimeSelect(time || (bh ? bh.open : '10:00'), dateVal);
  populateStaffSelect('');
  populateMenuSelect('');
  updateEndTimeHint();
  openModal('reservation-modal');
}

function openEditRes(id) {
  const r = db.reservations.find(x => x.id === id);
  if (!r) return;
  editResId = id;
  document.getElementById('res-modal-title').textContent = '予約を編集';
  document.getElementById('res-id').value       = id;
  document.getElementById('res-customer').value = r.customerName;
  document.getElementById('res-phone').value    = r.phone || '';
  document.getElementById('res-date').value     = r.date;
  document.getElementById('res-notes').value    = r.notes || '';
  document.getElementById('res-delete-btn').style.display = 'inline-flex';
  populateTimeSelect(r.time, r.date);
  populateStaffSelect(r.staffId);
  populateMenuSelect(r.menuId);
  updateEndTimeHint();
  openModal('reservation-modal');
}

function saveRes(e) {
  e.preventDefault();
  const r = {
    id:           editResId || nextId(db.reservations),
    customerName: document.getElementById('res-customer').value.trim(),
    phone:        document.getElementById('res-phone').value.trim(),
    date:         document.getElementById('res-date').value,
    time:         document.getElementById('res-time').value,
    staffId:      +document.getElementById('res-staff').value,
    menuId:       +document.getElementById('res-menu').value,
    notes:        document.getElementById('res-notes').value.trim(),
  };
  if (!r.staffId || !r.menuId) { alert('スタッフとメニューを選択してください'); return; }

  // Business hours validation
  const bhCheck = getBusinessHours(r.date);
  if (!bhCheck) {
    alert('この日は定休日です。別の日程でお願いします。');
    return;
  }
  const sMin = timeToMin(r.time);
  const menuForCheck = getMenu(r.menuId);
  if (menuForCheck) {
    const eMin = sMin + menuForCheck.duration;
    if (sMin < timeToMin(bhCheck.open) || eMin > timeToMin(bhCheck.close)) {
      if (!confirm(`この時間は営業時間（${bhCheck.open}〜${bhCheck.close}）外です。\n保存しますか？`)) return;
    }
  }

  // Conflict check before saving
  const conflicts = checkConflicts(r);
  if (conflicts.local.length > 0) {
    alert('同じスタッフに重複する予約があります。時間またはスタッフを変更してください。');
    return;
  }
  if (conflicts.sb.length > 0) {
    const names = conflicts.sb.map(x => `${x.customerName} ${x.time}`).join('、');
    const ok = confirm(`サロンボードに同時間帯の予約があります：\n${names}\n\nこのまま保存しますか？`);
    if (!ok) return;
  }

  if (editResId) {
    const i = db.reservations.findIndex(x => x.id === editResId);
    db.reservations[i] = r;
  } else {
    db.reservations.push(r);
  }
  saveDB(); closeModal('reservation-modal'); render();
}

function deleteRes() {
  if (!editResId || !confirm('この予約を削除しますか？')) return;
  db.reservations = db.reservations.filter(r => r.id !== editResId);
  saveDB(); closeModal('reservation-modal'); render();
}

// ─── Staff Modal ──────────────────────────────────────────────────────────────

function renderColorPicker(picked) {
  document.getElementById('color-picker').innerHTML = COLORS.map(c => `
    <div class="color-swatch ${c===picked?'picked':''}"
         style="background:${c}"
         onclick="pickColor('${c}')"></div>
  `).join('');
}
window.pickColor = function(c) {
  document.getElementById('staff-color').value = c;
  renderColorPicker(c);
};

function openAddStaff() {
  editStaffId = null;
  document.getElementById('staff-modal-title').textContent = 'スタッフ追加';
  document.getElementById('staff-id').value   = '';
  document.getElementById('staff-name').value = '';
  document.getElementById('staff-color').value = COLORS[0];
  document.getElementById('staff-delete-btn').style.display = 'none';
  renderColorPicker(COLORS[0]);
  openModal('staff-modal');
}

function openEditStaff(id) {
  const s = db.staff.find(x => x.id === id);
  if (!s) return;
  editStaffId = id;
  document.getElementById('staff-modal-title').textContent = 'スタッフを編集';
  document.getElementById('staff-id').value   = id;
  document.getElementById('staff-name').value = s.name;
  document.getElementById('staff-color').value = s.color;
  document.getElementById('staff-delete-btn').style.display = 'inline-flex';
  renderColorPicker(s.color);
  openModal('staff-modal');
}

function saveStaff(e) {
  e.preventDefault();
  const s = {
    id:    editStaffId || nextId(db.staff),
    name:  document.getElementById('staff-name').value.trim(),
    color: document.getElementById('staff-color').value,
  };
  if (editStaffId) {
    const i = db.staff.findIndex(x => x.id === editStaffId);
    db.staff[i] = s;
  } else {
    db.staff.push(s);
  }
  saveDB(); closeModal('staff-modal'); renderStaffGrid();
}

function deleteStaff() {
  if (!editStaffId) return;
  const cnt = db.reservations.filter(r => r.staffId === editStaffId).length;
  const msg = cnt > 0
    ? `このスタッフには ${cnt} 件の予約があります。削除しますか？`
    : 'このスタッフを削除しますか？';
  if (!confirm(msg)) return;
  db.staff = db.staff.filter(s => s.id !== editStaffId);
  saveDB(); closeModal('staff-modal'); renderStaffGrid();
}

// ─── Menu Modal ───────────────────────────────────────────────────────────────

function openAddMenu() {
  editMenuId = null;
  document.getElementById('menu-modal-title').textContent = 'メニュー追加';
  document.getElementById('menu-id').value       = '';
  document.getElementById('menu-name').value     = '';
  document.getElementById('menu-duration').value = '';
  document.getElementById('menu-price').value    = '';
  document.getElementById('menu-delete-btn').style.display = 'none';
  openModal('menu-modal');
}

function openEditMenu(id) {
  const m = db.menus.find(x => x.id === id);
  if (!m) return;
  editMenuId = id;
  document.getElementById('menu-modal-title').textContent = 'メニューを編集';
  document.getElementById('menu-id').value       = id;
  document.getElementById('menu-name').value     = m.name;
  document.getElementById('menu-duration').value = m.duration;
  document.getElementById('menu-price').value    = m.price;
  document.getElementById('menu-delete-btn').style.display = 'inline-flex';
  openModal('menu-modal');
}

function saveMenu(e) {
  e.preventDefault();
  const m = {
    id:       editMenuId || nextId(db.menus),
    name:     document.getElementById('menu-name').value.trim(),
    duration: +document.getElementById('menu-duration').value,
    price:    +document.getElementById('menu-price').value,
  };
  if (editMenuId) {
    const i = db.menus.findIndex(x => x.id === editMenuId);
    db.menus[i] = m;
  } else {
    db.menus.push(m);
  }
  saveDB(); closeModal('menu-modal'); renderMenuGrid();
}

function deleteMenu() {
  if (!editMenuId) return;
  const cnt = db.reservations.filter(r => r.menuId === editMenuId).length;
  const msg = cnt > 0
    ? `このメニューには ${cnt} 件の予約があります。削除しますか？`
    : 'このメニューを削除しますか？';
  if (!confirm(msg)) return;
  db.menus = db.menus.filter(m => m.id !== editMenuId);
  saveDB(); closeModal('menu-modal'); renderMenuGrid();
}

// ─── Modal utils ──────────────────────────────────────────────────────────────

function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// expose for inline onclick
window.openEditRes   = openEditRes;
window.openEditStaff = openEditStaff;
window.openEditMenu  = openEditMenu;

// ─── Bootstrap ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadDB();
  migrateMenus();
  fetchSBSync().then(() => { updateSyncBadge(); render(); });
  updateSyncBadge();

  // Nav tabs
  document.querySelectorAll('.nav-tab').forEach(tab =>
    tab.addEventListener('click', () => switchView(tab.dataset.view))
  );

  // New reservation button
  document.getElementById('new-reservation-btn')
    .addEventListener('click', () => openNewRes());

  // Calendar navigation
  document.getElementById('prev-period').addEventListener('click', () => {
    calView === 'week'
      ? cursorDate.setDate(cursorDate.getDate()-7)
      : cursorDate.setDate(cursorDate.getDate()-1);
    renderCalendar();
  });
  document.getElementById('next-period').addEventListener('click', () => {
    calView === 'week'
      ? cursorDate.setDate(cursorDate.getDate()+7)
      : cursorDate.setDate(cursorDate.getDate()+1);
    renderCalendar();
  });
  document.getElementById('today-btn').addEventListener('click', () => {
    cursorDate = new Date(); renderCalendar();
  });

  // Week / Day toggle
  document.querySelectorAll('.view-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      calView = btn.dataset.calView;
      renderCalendar();
    })
  );

  // Reservation form
  document.getElementById('reservation-form').addEventListener('submit', saveRes);
  document.getElementById('res-delete-btn').addEventListener('click', deleteRes);
  document.getElementById('res-time').addEventListener('change', updateEndTimeHint);
  document.getElementById('res-menu').addEventListener('change', updateEndTimeHint);
  document.getElementById('res-staff').addEventListener('change', updateEndTimeHint);
  document.getElementById('res-date').addEventListener('change', () => {
    const dateVal = document.getElementById('res-date').value;
    const curTime = document.getElementById('res-time').value;
    populateTimeSelect(curTime, dateVal);
    updateEndTimeHint();
  });

  // Staff form
  document.getElementById('add-staff-btn').addEventListener('click', openAddStaff);
  document.getElementById('staff-form').addEventListener('submit', saveStaff);
  document.getElementById('staff-delete-btn').addEventListener('click', deleteStaff);

  // Menu form
  document.getElementById('add-menu-btn').addEventListener('click', openAddMenu);
  document.getElementById('menu-form').addEventListener('submit', saveMenu);
  document.getElementById('menu-delete-btn').addEventListener('click', deleteMenu);

  // Search
  document.getElementById('search-input').addEventListener('input', e =>
    renderResList(e.target.value)
  );

  // [data-close] buttons
  document.querySelectorAll('[data-close]').forEach(btn =>
    btn.addEventListener('click', () => closeModal(btn.dataset.close))
  );

  // Click overlay to close
  document.querySelectorAll('.modal-overlay').forEach(overlay =>
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('open');
    })
  );

  // Initial render
  render();
});
