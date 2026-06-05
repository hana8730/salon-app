# サロン管理アプリ - Claude Code 設定

## プロジェクト概要
はなさんの美容サロン向け予約管理アプリ。
GitHub Pages（https://hana8730.github.io/salon-app/）でホスト。

## よく使うコマンド

### 「同期して」「SB同期」「サロンボード同期」
→ `/sync` コマンドを実行する（SalonBoard予約データの取得・更新）

### 「デプロイ」「公開して」「プッシュして」
→ 変更をコミットして `git push origin main` する

## ファイル構成

| ファイル | 説明 |
|---------|------|
| `index.html` | 管理アプリ本体（はなさん用） |
| `app.js` | 管理アプリのJavaScript |
| `customer.html` | お客様向け予約ページ |
| `sb-sync.json` | SalonBoard予約データ（自動同期対象） |
| `system-diagram.html` | システム構成図 |
| `tools/sb-bookmark.html` | SalonBoard同期ブックマークレット設定ページ |

## データフロー
1. SalonBoard → sb-sync.json（/syncコマンドで同期） → 管理アプリ（グレー「SB」タグ）
2. customer.html → Firebase → 管理アプリ（ピンク「顧客」タグ）
3. 管理アプリ直接入力 → カラーブロック表示

## Firebase
- プロジェクト: salon-app-c1357
- Realtime Database: https://salon-app-c1357-default-rtdb.asia-southeast1.firebasedatabase.app
- セキュリティルール: reservations配下のみ読み書き可、データ構造バリデーションあり

## SalonBoard 予約抽出の仕様
- スケジュールURL: `https://salonboard.com/CLP/bt/schedule/salonSchedule/?date=YYYYMMDD`
- 予約カードセレクタ: `div[id^="reserve_item_"]`
- スタイリストID T000997646 = ハナ、その他 = 指名なし
- 日付: `.panel_reserve_date`（YYYYMMDD形式）
- 時刻: `.panel_reserve_start`（HHMM形式）
- お客様名: `.reserveItemCustomer`
- 予約番号: `.panel_reserve_id`
- ※スケジュールカードに終了時刻・メニュー・施術時間は含まれない

## 予約詳細ページ（施術時間・メニュー取得）
- BF（ホットペッパー）: `/CLP/bt/reserve/net/reserveDetail/?reserveId=BF...`
- YG（外部/直接登録）: `/CLP/bt/reserve/ext/extReserveDetail/?reserveId=YG...`
- 施術時間: `td:contains('施術時間')` → `施術時間[ HH:MM ]` をパース
- メニュー: `th:text='メニュー'` の次の `td`（BFのみ。YGは空）
- カット系メニュー = 30分、その他 = 60分（施術時間が取れない場合のフォールバック）
