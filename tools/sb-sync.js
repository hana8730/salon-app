(async function () {
  'use strict';
  var TOKEN = window.__SB_TOKEN__;
  if (!TOKEN) { alert('同期トークンが未設定です。ブックマークを再登録してください。'); return; }

  var REPO   = 'hana8730/salon-app';
  var FILE   = 'sb-sync.json';
  var BRANCH = 'main';
  var HANA   = 'T000997646';
  var DAYS   = 30;
  var FB_URL = 'https://salon-app-c1357-default-rtdb.asia-southeast1.firebasedatabase.app/reservations.json';

  var ui = document.createElement('div');
  ui.style.cssText = 'position:fixed;top:20px;right:20px;background:#C75B8A;color:white;padding:16px 24px;border-radius:12px;z-index:99999;font-size:14px;min-width:240px;box-shadow:0 4px 20px rgba(0,0,0,.3);line-height:1.6;';
  ui.innerHTML = '🌸 SalonBoard同期中...<br><small>準備中</small>';
  document.body.appendChild(ui);

  function pd(s) { return s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8); }
  function pt(s) { return s.slice(0,2)+':'+s.slice(2,4); }
  function normN(n) { return (n||'').replace(/\s*様\s*/g,'').replace(/\s+/g,''); }

  function extDoc(doc) {
    var cards = doc.querySelectorAll('div[id^="reserve_item_"]');
    return Array.from(cards).map(function(c) {
      var resNo = (c.querySelector('.panel_reserve_id') && c.querySelector('.panel_reserve_id').textContent.trim()) || c.id.replace('reserve_item_','');
      var cust  = (c.querySelector('.reserveItemCustomer') && c.querySelector('.reserveItemCustomer').textContent.trim()) || '';
      var sid   = (c.querySelector('.panel_reserve_stylistId') && c.querySelector('.panel_reserve_stylistId').textContent.trim()) || '';
      var d     = (c.querySelector('.panel_reserve_date') && c.querySelector('.panel_reserve_date').textContent.trim()) || '';
      var t     = (c.querySelector('.panel_reserve_start') && c.querySelector('.panel_reserve_start').textContent.trim()) || '';
      if (!d || !t) return null;
      return {date:pd(d),time:pt(t),customerName:cust,reservationNo:resNo,stylist:sid===HANA?'ハナ':'指名なし',menu:'',duration:60,source:'salonboard'};
    }).filter(Boolean);
  }

  function loadSBPage(ds) {
    return new Promise(function(resolve) {
      var iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;';
      iframe.src = '/CLP/bt/schedule/salonSchedule/?date='+ds;
      var t = setTimeout(function() { try{iframe.remove();}catch(e){} resolve([]); }, 10000);
      iframe.onload = function() {
        clearTimeout(t);
        try { var r = extDoc(iframe.contentDocument); iframe.remove(); resolve(r); }
        catch(e) { try{iframe.remove();}catch(e2){} resolve([]); }
      };
      iframe.onerror = function() { clearTimeout(t); try{iframe.remove();}catch(e){} resolve([]); };
      document.body.appendChild(iframe);
    });
  }

  // Phase 1: SalonBoard スクレイピング
  var all = [], today = new Date();
  for (var i = 0; i < DAYS; i += 5) {
    var batch = [];
    for (var j = i; j < Math.min(i+5,DAYS); j++) {
      var dd = new Date(today);
      dd.setDate(today.getDate()+j);
      batch.push(dd.toISOString().slice(0,10).replace(/-/g,''));
    }
    ui.innerHTML = '🌸 SB読込中... '+Math.round(i/DAYS*100)+'%<br><small>'+batch[0].slice(0,4)+'/'+batch[0].slice(4,6)+'/'+batch[0].slice(6,8)+'</small>';
    var results = await Promise.all(batch.map(loadSBPage));
    results.forEach(function(r) { all.push.apply(all,r); });
  }
  all.sort(function(a,b) { return (a.date+a.time).localeCompare(b.date+b.time); });

  // Phase 2: GitHub sb-sync.json 更新
  ui.innerHTML = '🌸 GitHub更新中...<br><small>'+all.length+'件</small>';
  var body = JSON.stringify({syncTime:new Date().toISOString(),reservations:all},null,2);
  var b64  = btoa(unescape(encodeURIComponent(body)));
  try {
    var gr = await fetch('https://api.github.com/repos/'+REPO+'/contents/'+FILE+'?ref='+BRANCH, {headers:{Authorization:'token '+TOKEN}});
    var gj = await gr.json();
    var pr = await fetch('https://api.github.com/repos/'+REPO+'/contents/'+FILE, {
      method:'PUT',
      headers:{Authorization:'token '+TOKEN,'Content-Type':'application/json'},
      body:JSON.stringify({message:'chore: SB自動同期 '+new Date().toLocaleString('ja-JP'),content:b64,sha:gj.sha,branch:BRANCH})
    });
    if (!pr.ok) {
      var pe = await pr.json();
      ui.style.background='#e74c3c';
      ui.innerHTML='❌ GitHub失敗<br><small>'+(pe.message||pr.status)+'</small>';
      setTimeout(function(){ui.remove();},5000);
      return;
    }
  } catch(e) {
    ui.style.background='#e74c3c';
    ui.innerHTML='❌ エラー<br><small>'+e.message+'</small>';
    setTimeout(function(){ui.remove();},5000);
    return;
  }

  // Phase 3: Firebase顧客予約 → SalonBoard登録
  ui.innerHTML = '🌸 顧客予約をSBに登録中...<br><small>Firebase読み込み中</small>';
  var toReg = [];
  try {
    var fbResp = await fetch(FB_URL);
    var fbData = await fbResp.json();
    if (fbData) {
      toReg = Object.values(fbData).filter(function(fb) {
        if (!fb.date||!fb.time) return false;
        var sbT = all.filter(function(s){return s.date===fb.date&&s.time===fb.time;});
        if (!sbT.length) return true;
        var fn = normN(fb.customerName);
        return !sbT.some(function(s){var sn=normN(s.customerName);return fn.length>=2&&sn.indexOf(fn.slice(0,2))>=0;});
      });
    }
  } catch(e) {}

  function regFB(fb) {
    return new Promise(function(resolve) {
      var iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:800px;height:600px;';
      var sd = fb.date.replace(/-/g,'');
      var st = (fb.time||'').replace(':','');
      iframe.src = '/CLP/bt/reserve/ext/extReserveRegist/?date='+sd+'&time='+st+'&stylistId='+HANA+'&rlastupdate='+Date.now();
      var step = 0, timer = setTimeout(function(){try{iframe.remove();}catch(e){}resolve(false);},15000);
      function onLoad() {
        try {
          var doc  = iframe.contentDocument;
          var path = iframe.contentWindow.location.pathname;
          if (step===0) {
            step=1;
            var form = doc.querySelector('form');
            if (!form) { clearTimeout(timer); iframe.remove(); resolve(false); return; }
            var parts = (fb.customerName||'').replace(/\s*様\s*$/,'').trim().split(/\s+/);
            var sei = parts[0]||'', mei = parts.slice(1).join(' ')||'';
            function sv(id,v){var el=doc.getElementById(id);if(el)el.value=v;}
            sv('nmSeiKana',sei); sv('nmMeiKana',mei);
            sv('nmSei',sei);     sv('nmMei',mei);
            if (fb.phone) sv('tel',String(fb.phone).replace(/[^\d]/g,''));
            sv('rsvEtc','顧客アプリ予約'+(fb.notes?': '+fb.notes:''));
            var rs = doc.querySelector('[name="rsvRouteId"]'); if(rs) rs.value='K000000001';
            iframe.onload = onLoad; form.submit();
          } else if (step===1) {
            step=2;
            if (path.indexOf('Regist')>=0&&path.indexOf('Confirm')<0&&path.indexOf('Complete')<0) {
              clearTimeout(timer); iframe.remove(); resolve(false);
            } else if (path.indexOf('Confirm')>=0) {
              var cf = doc.querySelector('form');
              if (cf) { iframe.onload=onLoad; cf.submit(); }
              else    { clearTimeout(timer); iframe.remove(); resolve(true); }
            } else {
              clearTimeout(timer); iframe.remove(); resolve(true);
            }
          } else {
            clearTimeout(timer); iframe.remove(); resolve(true);
          }
        } catch(e) { clearTimeout(timer); try{iframe.remove();}catch(e2){} resolve(false); }
      }
      iframe.onload = onLoad;
      document.body.appendChild(iframe);
    });
  }

  var regOk=0, regFail=0;
  for (var fi=0; fi<toReg.length; fi++) {
    var fb = toReg[fi];
    ui.innerHTML = '🌸 顧客→SB登録中 ('+(fi+1)+'/'+toReg.length+')<br><small>'+(fb.customerName||'')+'</small>';
    var ok = await regFB(fb);
    if (ok) regOk++; else regFail++;
    await new Promise(function(r){setTimeout(r,1500);});
  }

  // 完了
  ui.style.background = '#27ae60';
  var msg = 'SB:'+all.length+'件取得済';
  if (toReg.length > 0) msg += ' / 顧客SB登録:'+regOk+'件成功';
  if (regFail > 0)      msg += '('+regFail+'件失敗)';
  if (toReg.length===0) msg += ' / 新規顧客予約なし';
  ui.innerHTML = '✅ 同期完了！<br><small>'+msg+'</small>';
  setTimeout(function(){ui.remove();},8000);
})();
