// policies-part2.ts — remaining policy content v1.0 (AUP, refunds, IP,
// accessibility). See policies-part1.ts for the content contract.

import { PolicyContent } from "./policies-part1";

const FOOTER_EN = `Version 1.0 · Effective 2026-10-20 · © Tengasell

This policy is provided for information; it is not legal advice.`;

const FOOTER_JA = `バージョン 1.0 · 発効日 2026-10-20 · © Tengasell

本ポリシーは参考情報であり、法的助言ではありません。`;

// ── 5. Acceptable Use Policy ────────────────────────────────────────────────

const AUP_EN = `The Acceptable Use Policy (AUP) defines what may never be sold, said or done on Tengasell. It applies to listings, photographs, descriptions, questions and answers, messages between users, ratings, profile content and any other use of the Platform. It is enforced by automated screening and human moderation.

## 1. Prohibited goods

The following may never be listed or sold:

- Weapons and ammunition: firearms, component parts, magazines, ammunition, explosives, tasers and switchblades (except items demonstrably legal in Zimbabwe with required permits, which must be shown in the listing).
- Narcotics and controlled substances: illegal drugs, drug paraphernalia, prescription medicines sold without a licensed pharmacy, and unlicensed traditional remedies making medical claims.
- Counterfeit and pirate goods: fake branded products, unauthorized replicas, and unlicensed copies of software, music, films or games.
- Wildlife and protected species: live animals, protected or endangered species (including ivory, tortoise shell and other derivative products), and plants protected under Zimbabwean law or CITES.
- Stolen goods and property with encumbrances: any item you do not own or cannot lawfully transfer.
- Currency and payment instruments: currency exchange as a business, counterfeit-detector-adjacent fraud tools, cloned cards, and bank credentials.
- Adult content and services.
- Human organs, bodily items and hazardous materials (including medical waste, asbestos and unauthorized chemicals).
- Government items: uniforms, insignia, licences and identity documents (genuine or replica).
- Items requiring a licence you do not hold: tobacco, alcohol, pharmaceuticals, broadcasting equipment — licences must be stated in the listing.
- Anything whose sale is prohibited by the law of Zimbabwe or the buyer's jurisdiction.

## 2. Conduct rules

- No off-platform payment steering. Do not share phone numbers, bank details, WhatsApp links or social handles to move the deal — or the payment — outside Tengasell. Our messaging automatically masks contact details, and confirmed steering leads to listing removal and account restrictions. This rule exists to protect you: off-platform deals have no escrow, no dispute rights and no recovery path.
- No shill bidding. Bidding on your own listing or arranging bids through others to inflate prices is fraud.
- No fake reviews or rating manipulation: do not buy, sell, trade or coerce ratings.
- No harassment, hate speech, threats or doxxing in any channel.
- No scraping, automated bidding outside official clients, credential sharing, or attempts to breach or overload the Platform.
- No misuse of the Q&A: questions and answers are public auction content, not advertising space.

## 3. Privacy of others

- Do not post other people's personal information: addresses, phone numbers, ID numbers or photographs of identifiable people without their consent.
- Messages are moderated for contact details and prohibited content; content flagged as potentially illegal may be disclosed to authorities.

## 4. Enforcement and appeals

Suspected violations are screened, reviewed and actioned: listing removal, bid or sale restrictions, payout holds, suspension, and reporting to law enforcement where the law requires it. Actions are logged with the reason. You may appeal once per action through the Help centre; appeals are decided by a moderator not involved in the original decision.

## 5. Reporting

Use the Report button on any listing or message. Reports are confidential where the reporter's identity is not needed for enforcement.

${FOOTER_EN}`;

const AUP_JA = `許容利用ポリシー（AUP）は、Tengasellで決して販売・発言・行為できない事柄を定めます。出品・写真・説明・質問と回答・メッセージ・評価・プロフィール等、プラットフォームのあらゆる利用に適用され、自動スクリーニングと人力モデレーションで執行されます。

## 1. 禁止商品

以下は一切出品・販売できません：

- 武器・弾薬：銃器、部品、マガジン、弾薬、爆発物、スタンガン、スイッチブレード（ジンバブエで適法かつ必要な許可証を示せる場合を除く）。
- 麻薬・向精神薬：違法薬物、関連器具、無認可薬局による処方薬、医療効果を標榜する無許可の伝統薬。
- 偽ブランド・海賊版：模倣品、無断レプリカ、無許可のソフトウェア・音楽・映像・ゲーム。
- 野生動物・保護種：生体動物、保護・絶滅危惧種（象牙、亀甲等の派生品を含む）、ジンバブエ法またはCITESで保護される動植物。
- 盗品・権利負担のある財産：所有しない、または適法に譲渡できない物。
- 通貨・決済手段：業者としての両替、偽造関連道具、複製カード、銀行資格情報。
- 成人向けコンテンツ・サービス。
- 人体・臓器・危険物（医療廃棄物、アスベスト、無許可の化学物質を含む）。
- 政府関連：制服、記章、許可証、身分証（本物・複製とも）。
- 許可を持たない規制品：たばこ、酒類、医薬品、放送機器（許可証を出品に明記する必要があります）。
- ジンバブエ法または購入者の所在国法で販売が禁止されるすべての物。

## 2. 行為規範

- プラットフォーム外への支払い誘導の禁止。電話番号・銀行口座・WhatsApp・SNS等を共有して取引や支払いをTengasellの外へ移す行為は禁止です。メッセージの連絡先は自動的にマスクされ、確認された誘導は出品削除とアカウント制限につながります。この規則は利用者保護のためです：プラットフォーム外取引にはエスクロー・紛争処理・回復手段がありません。
- さや予備入札の禁止。自分の出品への入札や他者を使った入札の工作は不正です。
- 偽レビュー・評価操作の禁止：評価の売買・取引・強要は禁止です。
- 嫌がらせ・憎悪表現・脅迫・個人情報晒しの禁止。
- スクレイピング、非公式クライアントによる自動入札、資格情報の共有、プラットフォームへの侵害・過負荷の禁止。
- Q&Aの悪用禁止：質問と回答は公開オークションコンテンツであり、広告スペースではありません。

## 3. 他者のプライバシー

- 他人の個人情報（住所・電話番号・ID番号・同意のない人物写真）を投稿しないでください。
- メッセージは連絡先・禁止コンテンツについてモデレーションされ、違法の可能性があるコンテンツは当局へ開示される場合があります。

## 4. 対応と異議申立て

違反の疑いはスクリーニング・審査・対応されます：出品削除、入札・販売制限、出金保留、アカウント停止、法令上必要な場合の当局通報。対応は理由付きで記録されます。各対応について1回、ヘルプセンターから異議申立てでき、当初の判断に関与していないモデレーターが裁定します。

## 5. 通報

出品やメッセージの通報ボタンをご利用ください。通報者の特定が執行に不要な場合、通報者の身元は執行に不要な場合、秘密として扱われます。

${FOOTER_JA}`;

// ── 6. Refund Policy ────────────────────────────────────────────────────────

const REFUNDS_EN = `This Refund Policy describes exactly when money comes back to a buyer on Tengasell, how much, and how fast. It matches the behaviour of the Platform's order and escrow engine, and works alongside the Consumer Protection Act [Chapter 14:44], which gives buyers statutory rights that this policy does not limit.

## 1. The money flow

When you pay for an order, your payment is held by Tengasell in escrow — the seller is not paid yet. Escrow is released to the seller only when the order is marked delivered and 7 days pass without an open dispute (or an admin resolves a dispute in the seller's favour). While the money is in escrow, a refund is a release of the escrow back to you; after release, a refund is clawed back from the seller's balance (never below zero).

## 2. When you are entitled to a refund

- Item not received: you paid, the seller never dispatched within the 3-day SLA, and cannot show a delivery reference. Full refund of item price and shipping.
- Significantly not as described: the item materially differs from the listing (wrong model, missing stated accessories, wrong condition). Full refund including shipping; the seller may be required to pay return logistics.
- Defective or damaged on arrival: the item is faulty or damaged and this was not disclosed in the listing. Full refund including shipping.
- Order cancelled before dispatch: full refund including shipping.
- Partial refund: where both parties agree, or the dispute evidence supports it, a partial refund may be decided (for example, a described-but-minor defect with the buyer keeping the item). The seller's final-value fee is reversed proportionally to every refund.

## 3. When a refund is not due

- Buyer's remorse on correctly described items (change of mind after delivery) — unless the seller voluntarily offers returns.
- Delays caused by the buyer (collection not collected, wrong address given) — we may deduct documented re-delivery costs.
- Items damaged by the buyer after delivery, or returns outside the 7-day dispute window.

## 4. How to open a dispute

Open the dispute from the order page within 7 days of delivery. Submit photographs, the delivery reference and any messages that show the problem. The seller responds with their evidence. An admin decides based on the evidence; both parties see the outcome and the reason.

## 5. Timelines

- Payment window: 48 hours from auction close (order cancels automatically if unpaid).
- Dispatch SLA: 3 days from payment.
- Dispute window: 7 days from delivery.
- Refund processing: within 5 business days of a dispute being decided in your favour, the money is returned to your original payment method (Paynow reversal) or an agreed manual channel (ZIPIT, bank transfer). Manual-channel refunds depend on banking hours.

## 6. Fees

Buyers never pay platform fees. A refunded buyer receives the full order amount due under this policy. The seller's final-value fee is reversed proportionally and a credit note is issued.

${FOOTER_EN}`;

const REFUNDS_JA = `本返金ポリシーは、Tengasellでどのような場合に・いくら・どのくらいの速さで購入者にお金が戻るかを正確に定めます。本プラットフォームの注文・エスクローエンジンの動作と一致しており、消費者保護法（Chapter 14:44）が与える法定権利を制限するものではありません。

## 1. 資金の流れ

支払いはTengasellのエスクロー（保管）に入ります。出品者はまだ受け取っていません。エスクローは、商品到着後7日間に紛争がなければ（または管理者が出品者有利で裁定した場合）に出品者へ解放されます。エスクロー中の返金は保管額の買い手への返却、解放後の返金は出品者残高からの控除（0未満にはなりません）です。

## 2. 返金の対象

- 未着：支払ったが出品者がSLA（3日）以内に発送せず、配送参照も示せない場合。商品代金＋配送料の全額返金。
- 説明と著しく異なる：型番違い、記載された付属品の欠落、状態の相違等。配送料を含む全額返金。返品物流は出品者負担の場合があります。
- 到着時の不良・破損：出品に記載のない故障・破損。配送料を含む全額返金。
- 発送前のキャンセル：配送料を含む全額返金。
- 部分返金：双方の合意または証拠に基づき、部分返金が裁定される場合があります（軽微な欠陥で購入者が商品を保持する場合等）。出品者の成約手数料は返金に比例して取り消されます。

## 3. 返金の対象外

- 正確に出品された商品への単なる心変わり（ただし出品者が自主的に返品を受け付ける場合を除く）。
- 購入者起因の遅延（受取不履行、誤った住所）。文書化された再配送費用を差し引く場合があります。
- 到着後に購入者が破損させた場合、または7日の紛争期間を過ぎた返品。

## 4. 紛争の開始方法

到着後7日以内に注文ページから紛争を開始してください。写真・配送参照・問題を示すメッセージを提出します。出品者が証拠で回答し、管理者が証拠に基づき裁定します。双方が結果と理由を確認できます。

## 5. 期間

- 支払い期間：オークション終了後48時間（未払いで注文は自動キャンセル）。
- 発送SLA：支払い後3日。
- 紛争期間：到着後7日。
- 返金処理：買い手有利の裁定後、5営業日以内に元の支払い方法（Paynow逆課金）または合意された手動手段（ZIPIT・銀行振込）へ返金。手動手段は銀行営業時間に依存します。

## 6. 手数料

購入者にプラットフォーム手数料はかかりません。返金対象の購入者は本ポリシーに基づく全額を受け取ります。出品者の成約手数料は比例して取り消され、貸方票が発行されます。

${FOOTER_JA}`;

// ── 7. IP & Copyright Policy ────────────────────────────────────────────────

const IP_EN = `Tengasell respects intellectual property rights. This policy explains how rights holders can request the removal of infringing content and how we handle repeat infringement.

## 1. Ownership of content

- Sellers own their listing photographs and text, and grant the Platform a licence to display them (see the Seller Agreement).
- The Tengasell name, logo and site design are the property of Tengasell (Private) Limited.
- Buyers and sellers remain responsible for ensuring their listings and messages do not infringe copyright, trade mark or other IP rights.

## 2. What must not be listed

- Counterfeit goods (fake branded products) — never acceptable, even labelled as "replica".
- Unlicensed copies of software, media or publications.
- Material that copies another seller's photographs or descriptions without permission.
- Goods whose sale infringes a registered trade mark, design or patent in Zimbabwe.

## 3. Takedown process

If you believe a listing infringes your rights, send a takedown notice to ip@tengasell.com (or use the Report button and choose "intellectual property") including:

- Identification of the protected work or mark and proof of your rights (registration number or equivalent).
- The exact listing URL(s).
- Your contact details.
- A statement of good-faith belief that the use is unauthorised, and a statement (under penalty of perjury where applicable) that the information is accurate and you are the rights holder or authorised agent.

Our process:

- Report received: we acknowledge within 2 business days.
- Review: we assess the notice and the listing, and may ask the seller for their authority to sell.
- Removal: confirmed infringing listings are removed (not merely ended — they cannot be relisted by the seller).
- Notice to the seller: the seller is informed of the removal and the reason, and may respond with a counter-notice if they believe the removal was mistaken (for example, genuine parallel-imported goods or licensed resale).
- Repeat infringers: accounts with repeated confirmed infringements are suspended. We count each confirmed takedown, and suspension is automatic after the third within 12 months.

## 4. Counter-notices and restoration

A seller may submit a counter-notice with evidence of authorisation. Where the counter-notice is convincing and the rights holder does not pursue the matter legally within 10 business days, the listing may be restored. Rights holders who repeatedly file bad-faith notices lose access to the expedited process.

## 5. Legal requests

Court orders and lawful requests are handled under our legal request process with minimisation: we disclose only what the order requires.

${FOOTER_EN}`;

const IP_JA = `Tengasellは知的財産権を尊重します。本ポリシーは、権利者が侵害コンテンツの削除を求める方法と、常習侵害への対応を定めます。

## 1. コンテンツの帰属

- 出品写真・文章の所有権は出品者にあり、プラットフォームへの表示ライセンスを許諾します（出品者契約参照）。
- Tengasellの名称・ロゴ・サイトデザインはTengasell (Private) Limitedの財産です。
- 出品とメッセージが著作権・商標権その他の知的財産権を侵害しない責任は、利用者各自にあります。

## 2. 出品できない物

- 偽ブランド品（「レプリカ」表示でも一切不可）。
- 無許可のソフトウェア・メディア・出版物の複製。
- 他出品者の写真・説明の無断転用。
- ジンバブエで登録商標・意匠・特許を侵害する商品。

## 3. 削除（テイクダウン）プロセス

侵害を信じる場合、ip@tengasell.com（または通報ボタンの「知的財産」）に以下を送ってください：

- 保護対象の作品・商標の特定と権利証明（登録番号等）。
- 該当出品のURL。
- 連絡先。
- 使用が無許可と誠実に信じる旨、および情報が正確で自身が権利者または正当な代理人である旨の陳述。

当社のプロセス：

- 受領：2営業日以内に受領確認します。
- 審査：通知と出品を評価し、出品者に販売権限の提示を求める場合があります。
- 削除：侵害が確認された出品は削除され（単なる終了ではなく、再出品も不可）。
- 出品者への通知：削除と理由を出品者に通知。誤削除と考える場合（真正な並行輸入品・認可済み転売等）は反対通知が可能。
- 常習者：確認された侵害を繰り返すアカウントは停止します。確認済みテイクダウンを12ヶ月以内に3件で自動停止となります。

## 4. 反対通知と復元

出品者は権限の証拠とともに反対通知を提出できます。反対通知が説得的で、権利者が10営業日以内に法的手段を講じない場合、出品は復元される場合があります。悪意のある通知を繰り返す権利者は、迅速処理プロセスの対象から除外されます。

## 5. 法的要請

裁判所命令および法令に基づく要請は、最小限開示の原則に基づく法的手続きで処理されます。

${FOOTER_JA}`;

// ── 8. Accessibility Statement ──────────────────────────────────────────────

const ACCESS_EN = `Tengasell is committed to making the marketplace usable by everyone, including people with disabilities. This statement explains the accessibility standard we target, the current state of the Platform, and how to tell us about problems.

## 1. Our target

We aim to conform to WCAG 2.2 Level AA (Web Content Accessibility Guidelines, W3C Recommendation). New features are built and tested against this target, and known exceptions are tracked as findings with owners and fix dates.

## 2. What we do

- Semantic structure: headings, landmarks (header, navigation, main, footer) and lists are used correctly so screen readers can navigate.
- Keyboard support: every interactive control (bids, buttons, dialogs, forms, menus) is reachable and operable by keyboard; focus is visible and never trapped.
- Touch and target sizes: interactive elements are at least 44×44 pixels, including on small (390px) screens.
- Colour and contrast: text meets WCAG AA contrast against its background; colour is never the only signal for state or meaning.
- Text alternatives: meaningful images carry descriptive alternative text; decorative images are hidden from assistive technology.
- Forms: inputs have labels, required states and error messages that are announced, not only coloured.
- Live updates: bids, countdowns and notifications update with accessible labels rather than rapid unannounced changes.
- Motion: animation is subtle and honouring reduced-motion preferences.
- Zoom and reflow: the interface remains usable at 200% zoom and on narrow viewports without horizontal scrolling.
- Language: the interface is available in English and Japanese, and the page language is declared so screen readers switch voices correctly.

## 3. Known limitations

- Some historical listings submitted by sellers may contain photographs without alternative text; we prompt sellers to describe their items and continue to improve defaults.
- Third-party embeds (for example, map tiles and payment windows) may have their own accessibility behaviour outside our direct control; we choose providers with accessibility commitments where possible.
- The Japanese translation of policy documents is provided for convenience; the English text is the authoritative version for legal purposes.

## 4. Give us feedback

Accessibility problems matter to us. Report them via accessibility@tengasell.com or the Help centre with the page address and a description of the barrier. We aim to acknowledge reports within 2 business days and to fix confirmed AA-level barriers as part of our normal release cycle, prioritising blockers to core journeys (search, bidding, paying, disputes).

## 5. Assessment

Conformance is reviewed at each major release against a checklist derived from WCAG 2.2 AA, and the results are recorded in our governance console. This statement was last reviewed with version 1.0 of the Platform policies.

${FOOTER_EN}`;

const ACCESS_JA = `Tengasellは、障害のある方を含むすべての方がマーケットプレイスを利用できるよう取り組んでいます。本声明は、目標とするアクセシビリティ基準、プラットフォームの現状、問題の報告方法を説明します。

## 1. 目標基準

WCAG 2.2 レベルAA（W3C勧告）への適合を目標とします。新機能はこの基準に対して構築・テストされ、既知の例外は責任者と修正期日付きの課題として管理されます。

## 2. 実施していること

- 意味的な構造：見出し・ランドマーク（ヘッダー・ナビゲーション・メイン・フッター）・リストを正しく使用し、スクリーンリーダーでの移動を可能にします。
- キーボード対応：すべての操作要素（入札・ボタン・ダイアログ・フォーム・メニュー）はキーボードで到達・操作可能で、フォーカスは可視化され、閉じ込められません。
- タッチとターゲットサイズ：操作要素は少なくとも44×44ピクセル（390px画面でも確保）。
- 色とコントラスト：文字は背景に対しWCAG AAのコントラストを満たし、状態や意味を色のみで伝えません。
- テキスト代替：意味のある画像には説明の代替テキストを付け、装飾画像は支援技術から除外します。
- フォーム：入力にはラベル・必須状態・エラーメッセージが読み上げられる形で付与されます（色だけではありません）。
- ライブ更新：入札・カウントダウン・通知は、告知なしの急変ではなく、アクセシブルなラベルで更新します。
- モーション：アニメーションは控えめで、視差・モーション軽減設定を尊重します。
- ズームとリフロー：200%ズームや狭い画面でも、横スクロールなしで利用できます。
- 言語：インターフェースは英語と日本語で利用でき、ページ言語を宣言してスクリーンリーダーが正しく切り替わるようにします。

## 3. 既知の制限

- 一部の出品画像には代替テキストがない場合があります。出品者に商品説明を促し、デフォルトの改善を続けます。
- サードパーティ埋め込み（地図タイル、決済ウィンドウ等）は当社の直接管理外の独自の挙動を持つ場合があります。可能な範囲でアクセシビリティ方針を持つ提供者を選定します。
- ポリシーの日本語訳は利便性のためのもので、法的には英語本文が正式版です。

## 4. フィードバック

アクセシビリティの問題は重要です。accessibility@tengasell.comまたはヘルプセンターから、ページのURLと障壁の説明をお送りください。2営業日以内の確認と、通常のリリースサイクルでの修正（特に検索・入札・支払い・紛争の中核フローの阻害要素を優先）を目指します。

## 5. 適合性評価

主要リリースのたびにWCAG 2.2 AA由来のチェックリストで評価し、結果はガバナンスコンソールに記録します。本声明はポリシーバージョン1.0と合わせて最終見直ししました。

${FOOTER_JA}`;

export const POLICIES_PART2: PolicyContent[] = [
  {
    key: "aup",
    title: "Acceptable Use Policy",
    titleJa: "許容利用ポリシー",
    owner: "trust",
    changeNote: "Initial v1.0 publication (MSCS 12-d).",
    en: AUP_EN,
    ja: AUP_JA,
  },
  {
    key: "refunds",
    title: "Refund Policy",
    titleJa: "返金ポリシー",
    owner: "support",
    changeNote: "Initial v1.0 publication (MSCS 12-d).",
    en: REFUNDS_EN,
    ja: REFUNDS_JA,
  },
  {
    key: "ip",
    title: "IP & Copyright Policy",
    titleJa: "知的財産・著作権ポリシー",
    owner: "legal",
    changeNote: "Initial v1.0 publication (MSCS 12-d).",
    en: IP_EN,
    ja: IP_JA,
  },
  {
    key: "accessibility",
    title: "Accessibility Statement",
    titleJa: "アクセシビリティ声明",
    owner: "platform",
    changeNote: "Initial v1.0 publication (MSCS 12-d).",
    en: ACCESS_EN,
    ja: ACCESS_JA,
  },
];
