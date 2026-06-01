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

### 4. GitHubにコミット＆プッシュ

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
