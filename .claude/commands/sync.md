# SalonBoard 予約データ同期

SalonBoardの予約データを取得してsb-sync.jsonを更新し、GitHubにプッシュする。

## 手順

### 1. Chrome の SalonBoard タブを確認
`mcp__Claude_in_Chrome__tabs_context_mcp` でタブ一覧を取得する。
SalonBoardのタブ（salonboard.com）がなければ、以下のURLに遷移する：
`https://salonboard.com/CLP/bt/schedule/salonSchedule/`

### 2. 今日から60日分のデータを取得

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
  if (!dateRaw || !timeRaw) return null;
  return {
    date:          dateRaw.slice(0,4)+'-'+dateRaw.slice(4,6)+'-'+dateRaw.slice(6,8),
    time:          timeRaw.slice(0,2)+':'+timeRaw.slice(2,4),
    customerName:  custName,
    reservationNo: resNo,
    stylist:       stylistId === 'T000997646' ? 'ハナ' : '指名なし',
    menu:          '',
    duration:      60,
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

**4-3. 各予約をiframeで登録**（toRegの件数分繰り返す）：
```javascript
(async()=>{
  const toReg=JSON.parse(sessionStorage.getItem('_toReg')||'[]');
  const HANA='T000997646';
  let ok=0,fail=0;
  function regFB(fb){
    return new Promise(resolve=>{
      const iframe=document.createElement('iframe');
      iframe.style.cssText='position:fixed;top:-9999px;left:-9999px;width:800px;height:600px;';
      const sd=fb.date.replace(/-/g,''),st=(fb.time||'').replace(':','');
      iframe.src='/CLP/bt/reserve/ext/extReserveRegist/?date='+sd+'&time='+st+'&stylistId='+HANA+'&rlastupdate='+Date.now();
      let step=0;
      const timer=setTimeout(()=>{try{iframe.remove();}catch(e){}resolve(false);},15000);
      function onLoad(){
        try{
          const doc=iframe.contentDocument,path=iframe.contentWindow.location.pathname;
          if(step===0){
            step=1;
            const form=doc.querySelector('form');
            if(!form){clearTimeout(timer);iframe.remove();resolve(false);return;}
            const parts=(fb.customerName||'').replace(/\s*様\s*$/,'').trim().split(/\s+/);
            const sei=parts[0]||'',mei=parts.slice(1).join(' ')||'';
            const sv=(id,v)=>{const el=doc.getElementById(id);if(el)el.value=v;};
            sv('nmSeiKana',sei);sv('nmMeiKana',mei);sv('nmSei',sei);sv('nmMei',mei);
            if(fb.phone)sv('tel',String(fb.phone).replace(/[^\d]/g,''));
            sv('rsvEtc','顧客アプリ予約'+(fb.notes?': '+fb.notes:''));
            const rs=doc.querySelector('[name="rsvRouteId"]');if(rs)rs.value='K000000001';
            iframe.onload=onLoad;form.submit();
          }else if(step===1){
            step=2;
            if(path.includes('Regist')&&!path.includes('Confirm')&&!path.includes('Complete')){
              clearTimeout(timer);iframe.remove();resolve(false);
            }else if(path.includes('Confirm')){
              const cf=doc.querySelector('form');
              if(cf){iframe.onload=onLoad;cf.submit();}else{clearTimeout(timer);iframe.remove();resolve(true);}
            }else{clearTimeout(timer);iframe.remove();resolve(true);}
          }else{clearTimeout(timer);iframe.remove();resolve(true);}
        }catch(e){clearTimeout(timer);try{iframe.remove();}catch(e2){}resolve(false);}
      }
      iframe.onload=onLoad;
      document.body.appendChild(iframe);
    });
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
