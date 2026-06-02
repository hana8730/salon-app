# SalonBoard 予約データ同期

SalonBoardの予約データを取得してsb-sync.jsonを更新し、GitHubにプッシュする。

## 手順

### 1. Chrome の SalonBoard タブを確認
`mcp__Claude_in_Chrome__tabs_context_mcp` でタブ一覧を取得する。
SalonBoardのタブ（salonboard.com）がなければ、以下のURLに遷移する：
`https://salonboard.com/CLP/bt/schedule/salonSchedule/`

### 2. 今日から30日分のデータを取得

以下のJavaScriptを各日付ページで実行して予約データを収集する。
日付URLパターン：`https://salonboard.com/CLP/bt/schedule/salonSchedule/?date=YYYYMMDD`

各ページで実行するJS：
```javascript
Array.from(document.querySelectorAll('div[id^="reserve_item_"]')).map(card => {
  const resNo     = card.querySelector('.panel_reserve_id')?.textContent.trim() || card.id.replace('reserve_item_','');
  const custName  = card.querySelector('.reserveItemCustomer')?.textContent.trim() || '';
  const stylistId = card.querySelector('.panel_reserve_stylistId')?.textContent.trim() || '';
  const dateRaw   = card.querySelector('.panel_reserve_date')?.textContent.trim() || '';
  const timeRaw   = card.querySelector('.panel_reserve_start')?.textContent.trim() || '';
  const endRaw    = card.querySelector('.panel_reserve_end')?.textContent.trim() || '';
  if (!dateRaw || !timeRaw) return null;
  // 実際の所要時間を計算（終了時刻がある場合）、なければ60分デフォルト
  let duration = 60;
  if (endRaw && endRaw.length >= 4) {
    const startMin = parseInt(timeRaw.slice(0,2))*60 + parseInt(timeRaw.slice(2,4));
    const endMin   = parseInt(endRaw.slice(0,2))*60  + parseInt(endRaw.slice(2,4));
    if (endMin > startMin) duration = endMin - startMin;
  }
  return {
    date:          dateRaw.slice(0,4)+'-'+dateRaw.slice(4,6)+'-'+dateRaw.slice(6,8),
    time:          timeRaw.slice(0,2)+':'+timeRaw.slice(2,4),
    customerName:  custName,
    reservationNo: resNo,
    stylist:       stylistId === 'T000997646' ? 'ハナ' : '指名なし',
    menu:          '',
    duration:      duration,
    source:        'salonboard'
  };
}).filter(Boolean)
```

### 3. sb-sync.json を更新

収集した全予約を日付・時刻順にソートして `/Users/hana/salon-app/sb-sync.json` に書き込む。

フォーマット：
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
