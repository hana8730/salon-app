# SalonBoard 予約データ同期

SalonBoardの予約データを取得してsb-sync.jsonを更新し、GitHubにプッシュする。

## 手順

### 1. Chrome の SalonBoard タブを確認
`mcp__Claude_in_Chrome__tabs_context_mcp` でタブ一覧を取得する。
SalonBoardのタブ（salonboard.com）がなければ、以下のURLに遷移する：
`https://salonboard.com/CLP/bt/schedule/salonSchedule/`

### 2. 今日から30日分のデータを取得（詳細ページから正確な施術時間も取得）

SalonBoardのスケジュールタブで以下のJSを**1回だけ**実行する。
スケジュールページを30日分フェッチし、各予約の詳細ページから `施術時間` とメニューも取得する。

```javascript
(async () => {
  const DAYS = 30;
  const today = new Date();
  const allRes = [], seen = new Set();

  // --- スケジュールページから予約カードを収集 ---
  for (let d = 0; d < DAYS; d++) {
    const dt = new Date(today); dt.setDate(today.getDate() + d);
    const dateStr = dt.toISOString().slice(0,10).replace(/-/g,'');
    try {
      const res = await fetch('/CLP/bt/schedule/salonSchedule/?date='+dateStr, {credentials:'same-origin'});
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html,'text/html');
      for (const card of doc.querySelectorAll('div[id^="reserve_item_"]')) {
        const resNo = card.querySelector('.panel_reserve_id')?.textContent.trim() || card.id.replace('reserve_item_','');
        if (seen.has(resNo)) continue; seen.add(resNo);
        const custName  = card.querySelector('.reserveItemCustomer')?.textContent.trim() || '';
        const stylistId = card.querySelector('.panel_reserve_stylistId')?.textContent.trim() || '';
        const dateRaw   = card.querySelector('.panel_reserve_date')?.textContent.trim() || '';
        const timeRaw   = card.querySelector('.panel_reserve_start')?.textContent.trim() || '';
        if (!dateRaw || !timeRaw) continue;
        allRes.push({
          date: dateRaw.slice(0,4)+'-'+dateRaw.slice(4,6)+'-'+dateRaw.slice(6,8),
          time: timeRaw.slice(0,2)+':'+timeRaw.slice(2,4),
          customerName: custName,
          reservationNo: resNo,
          stylist: stylistId === 'T000997646' ? 'ハナ' : '指名なし',
          menu: '', duration: 60, source: 'salonboard'
        });
      }
    } catch(e) {}
    await new Promise(r=>setTimeout(r,200));
  }

  // --- 各予約の詳細ページから施術時間・メニューを取得 ---
  // BF（ホットペッパー）→ /net/reserveDetail/
  // YG（外部/直接）     → /ext/extReserveDetail/
  for (const rsv of allRes) {
    try {
      const url = rsv.reservationNo.startsWith('BF')
        ? '/CLP/bt/reserve/net/reserveDetail/?reserveId='+rsv.reservationNo
        : '/CLP/bt/reserve/ext/extReserveDetail/?reserveId='+rsv.reservationNo;
      const res = await fetch(url, {credentials:'same-origin'});
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html,'text/html');
      // 施術時間[ HH:MM ] から分数を計算
      const timeTd = Array.from(doc.querySelectorAll('td')).find(td=>td.textContent.includes('施術時間'));
      const m = (timeTd?.textContent||'').match(/施術時間\[\s*(\d+):(\d+)\s*\]/);
      if (m) rsv.duration = parseInt(m[1])*60 + parseInt(m[2]);
      // メニュー名（BFのみ取得できる）
      const menuTh = Array.from(doc.querySelectorAll('th')).find(th=>th.textContent.trim()==='メニュー');
      rsv.menu = menuTh?.nextElementSibling?.textContent.trim() || '';
      // 施術時間が取得できなかった場合のメニュー名フォールバック（カット=30分）
      if (!m && rsv.menu.includes('カット')) rsv.duration = 30;
    } catch(e) {}
    await new Promise(r=>setTimeout(r,300));
  }

  allRes.sort((a,b)=>a.date+a.time < b.date+b.time ? -1 : 1);
  sessionStorage.setItem('_sb', JSON.stringify(allRes));
  return allRes.length + '件収集完了（' + DAYS + '日分）';
})()
```

完了メッセージ（例：「27件収集完了（30日分）」）が返ったら次へ進む。

### 3. sb-sync.json を更新

sessionStorageから取得して `/Users/hana/salon-app/sb-sync.json` に書き込む。

```javascript
JSON.parse(sessionStorage.getItem('_sb') || '[]')
```

上記JSの結果（予約配列）を使って以下のフォーマットで書き込む：

```json
{
  "syncTime": "取得時刻のISO文字列",
  "reservations": [ ...ソート済み予約配列... ]
}
```

### 4. Firebase顧客予約をSalonBoardに自動登録

収集したSBデータと照合し、未登録のFirebase顧客予約をSalonBoardに登録する。

**4-1. Firebase顧客予約を取得**（現在のSalonBoardタブで実行）：
```javascript
(async()=>{
  const r=await fetch('https://salon-app-c1357-default-rtdb.asia-southeast1.firebasedatabase.app/reservations.json');
  const d=await r.json();
  const list=d?Object.values(d):[];
  sessionStorage.setItem('_fb',JSON.stringify(list));
  list.length+'件のFirebase顧客予約を取得';
})()
```

**4-2. SBと照合して未登録を抽出**：
```javascript
const sbAll=JSON.parse(sessionStorage.getItem('_sb')||'[]');
const fbAll=JSON.parse(sessionStorage.getItem('_fb')||'[]');
const normN=n=>(n||'').replace(/\s*様\s*/g,'').replace(/\s+/g,'');
const toReg=fbAll.filter(fb=>{
  if(!fb.date||!fb.time)return false;
  const sbT=sbAll.filter(s=>s.date===fb.date&&s.time===fb.time);
  if(!sbT.length)return true;
  const fn=normN(fb.customerName);
  return!sbT.some(s=>fn.length>=2&&normN(s.customerName).includes(fn.slice(0,2)));
});
sessionStorage.setItem('_toReg',JSON.stringify(toReg));
toReg.length+'件を登録予定:\n'+toReg.map(r=>r.date+' '+r.time+' '+r.customerName).join('\n')
```

**4-3. 各予約をfetchで登録**（SalonBoardタブで実行）：
```javascript
(async()=>{
  const toReg=JSON.parse(sessionStorage.getItem('_toReg')||'[]');
  const HANA='T000997646';
  let ok=0,fail=0;

  async function regFB(fb){
    try{
      const sd=fb.date.replace(/-/g,''),st=(fb.time||'').replace(':','');
      const ts=new Date().toISOString().replace(/\D/g,'').slice(0,14);
      const formUrl='/CLP/bt/reserve/ext/extReserveRegist/?date='+sd+'&time='+st+'&stylistId='+HANA+'&rlastupdate='+ts;

      // GETでフォームページを取得してCSRFトークンを入手
      const getRes=await fetch(formUrl,{credentials:'same-origin'});
      const html=await getRes.text();
      const doc=new DOMParser().parseFromString(html,'text/html');

      // フォームのhiddenフィールドを抽出（CSRFトークン含む）
      const f2=Array.from(doc.querySelectorAll('form')).find(f=>f.querySelector('[name="nmSeiKana"]'));
      if(!f2)return false;

      // FormDataを構築
      const fd=new FormData();
      for(const el of f2.querySelectorAll('input[type="hidden"]')){
        if(el.name)fd.set(el.name,el.value);
      }
      // セレクトボックスのデフォルト値
      const getSelect=(name,def)=>f2.querySelector('[name="'+name+'"]')?.value||def;
      fd.set('stylistId',HANA);
      fd.set('rsvTypeCdBool','on');
      fd.set('rsvDispDate',doc.getElementById('rsvDispDate')?.value||'');
      fd.set('time',st); fd.set('rsvTerm',getSelect('rsvTerm','30'));
      fd.set('rsvRouteId','K000000001');
      fd.set('setmenuId',''); fd.set('menuCategoryCdList',''); fd.set('menuIdList','');
      fd.set('netCouponId',''); fd.set('extCouponCategoryCdList',''); fd.set('extCouponIdList','');

      // 名前フィールド（プレースホルダークラスを意識せずそのまま設定）
      const parts=(fb.customerName||'').replace(/\s*様\s*$/,'').trim().split(/\s+/);
      const sei=parts[0]||'',mei=parts.slice(1).join('')||sei;
      fd.set('nmSeiKana',sei); fd.set('nmMeiKana',mei);
      fd.set('nmSei',sei);     fd.set('nmMei',mei);
      if(fb.phone)fd.set('tel',String(fb.phone).replace(/[^\d]/g,''));
      fd.set('rsvEtc','顧客アプリ予約'+(fb.notes?': '+fb.notes:''));

      // doCompleteにPOST
      const res=await fetch('/CLP/bt/reserve/ext/extReserveRegist/doComplete',{
        method:'POST',body:fd,credentials:'same-origin'
      });
      const resText=await res.text();
      return res.url.includes('salonSchedule')||!resText.includes('入力してください');
    }catch(e){return false;}
  }

  for(const fb of toReg){
    const r=await regFB(fb);
    if(r)ok++;else fail++;
    await new Promise(r=>setTimeout(r,1500));
  }
  ok+'件登録成功 / '+fail+'件失敗';
})()
```

登録が完了したら結果を報告する。

### 5. GitHubにコミット＆プッシュ

```bash
cd /Users/hana/salon-app
git add sb-sync.json
git commit -m "chore: SB同期 YYYY/MM/DD HH:MM"
git push origin main
```

### 5. 完了報告

何件取得したか、何日分を確認したかを日本語で報告する。

## 注意事項
- SalonBoardにログインしていない場合は「ログインしてください」と案内する
- 予約が0件のページはスキップしてOK（エラーではない）
- ネットワークエラーは最大2回リトライ
