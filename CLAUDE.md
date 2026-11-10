# サロン管理アプリ - Claude Code 設定

## プロジェクト概要
はなさんの美容サロン向け予約管理アプリ。
GitHub Pages（https://hana8730.github.io/salon-app/）でホスト。

## よく使うコマンド

### 「同期」「同期して」「SB同期」「サロンボード同期」（2026-11-09〜 運用変更・同11/9に一部訂正）
チャットで「同期」と言われたら、**必ずサロンボード同期（`/sync`相当）を実行する**（これは常に行う。GitHub Issueの有無で実行をスキップしない）。

それに加えて、GitHub `hana8730/muse-claude` リポジトリの「Macのクロード宛て」Issueも確認する：
1. `gh issue list --repo hana8730/muse-claude --state all --json number,title,createdAt,comments` で、はなさん（hana8730）またはこちら側からの完了報告コメントが無い「Macのクロード宛て」Issueを探す
2. 該当Issueがあれば、同期結果（件数・対象期間・エラー・ダブルブッキングなど要確認事項）を `gh issue comment` でそのIssueにもコメント報告する
3. 該当Issueが無ければ、Issue側への報告はせず、通常どおりチャットでの完了報告のみでよい

※2026-11-09の初版では「未実行Issueが無ければ同期自体を実行しない」としたが、はなさんから訂正あり（「未実行のIssueとは関係なく同期」）。チャットの「同期」は常に実行し、Issue確認・報告は付随タスクとして扱う。

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
- BF・BG（ホットペッパー系、両方とも）: `/CLP/bt/reserve/net/reserveDetail/?reserveId=BF...`（BGも同じnet/reserveDetailエンドポイント。2026-11-11判明、以前はBFのみ対応でBGが未対応だった）
- YG・YH（外部/直接登録）: `/CLP/bt/reserve/ext/extReserveDetail/?reserveId=YG...`
- 施術時間: `td:contains('施術時間')` → `施術時間[ HH:MM ]` をパース
- メニュー: `th:text='メニュー'` の次の `td`（BF・BGのみ取得できる。YG/YHは空）
- カット系メニュー = 30分、その他 = 60分（施術時間が取れない場合のフォールバック）
- **収集スクリプトのURL分岐**: `resNo.startsWith('BF') ? BF-url : YG-url` ではなく `resNo.startsWith('B') ? net/reserveDetail-url : ext/extReserveDetail-url`（B始まりは全てnet/reserveDetail、Y始まりは全てext/extReserveDetailが正しい分岐）
