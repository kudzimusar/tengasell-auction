// policies.ts — Tengasell policy content v1.0 (bilingual EN + JA).
//
// Canonical content spec: worklog Task 12-plan §H (LEGAL CONTENT). Markdown-
// lite format only: "##" headings, paragraphs, "- " list items. The public
// renderer (policies-page.tsx) escapes HTML and maps these three constructs.
//
// Legal grounding (Zimbabwe): Cyber and Data Protection Act [Chapter 12:07]
// (POTRAZ as the data protection authority), Consumer Protection Act
// [Chapter 14:44], Value Added Tax Act [Chapter 23:12], Companies and Other
// Business Entities Act [Chapter 24:31]. Every policy closes with the
// "Version 1.0 · Effective 2026-10-20 · © Tengasell" line and the
// not-legal-advice notice.

export const POLICY_VERSION = 1;
export const POLICY_EFFECTIVE_FROM = "2026-10-20";

export interface PolicyContent {
  key: string;
  title: string;
  titleJa: string;
  owner: string;
  changeNote: string;
  en: string;
  ja: string;
}

const FOOTER_EN = `Version 1.0 · Effective ${POLICY_EFFECTIVE_FROM} · © Tengasell

This policy is provided for information; it is not legal advice.`;

const FOOTER_JA = `バージョン 1.0 · 発効日 ${POLICY_EFFECTIVE_FROM} · © Tengasell

本ポリシーは参考情報であり、法的助言ではありません。`;

// ── 1. Terms of Service ─────────────────────────────────────────────────────

const TOS_EN = `Tengasell operates an online auction marketplace that connects independent sellers with buyers in Zimbabwe and abroad. These Terms of Service ("Terms") form a binding agreement between you and Tengasell (Private) Limited ("Tengasell", "we", "us") governing your access to and use of the Tengasell website, applications and services (the "Platform"). By registering an account, bidding, listing an item or otherwise using the Platform, you accept these Terms.

## 1. Our role: intermediary

Tengasell is a marketplace intermediary. We provide the venue, the auction engine, escrow-style payment holding, communication tools and dispute handling. We are not a party to the contract of sale between a buyer and a seller. The seller owns the listing and the goods; the buyer contracts with the seller. We do not take title to listed goods, and we do not warrant any listing's accuracy, legality or fitness for purpose. Where Zimbabwean consumer law — principally the Consumer Protection Act [Chapter 14:44] — grants buyers rights against sellers, nothing in these Terms limits those statutory rights.

## 2. Eligibility and accounts

- You must be at least 18 years old and legally capable of entering contracts.
- One person or business may hold one account. Accounts are personal and must not be transferred or shared.
- You are responsible for keeping your credentials confidential. Enable multi-factor authentication when it is offered to you.
- We may require identity verification ("KYC") before you sell, request payouts, or in connection with a dispute, fraud review or legal request.

## 3. Auctions and bidding

- Auctions run for the period stated on the listing. The highest bid at close wins, provided any reserve price is met.
- Proxy (automatic) bidding: you may set a maximum bid; the engine bids the minimum increments on your behalf up to that maximum. Your maximum is never shown to other users.
- Anti-sniping: if a bid arrives in the final minutes of an auction, the closing time is extended so other bidders can respond.
- Buy now: where a listing offers Buy Now, the first buyer to confirm and complete payment at the buy-now price ends the auction immediately.
- Bids are binding offers. Retracting a bid without a genuine reason (obvious typographical error, unreachable seller) is a violation.
- Shill bidding (bidding on your own listing, or having friends or family bid to inflate the price) is strictly prohibited and is treated as fraud.

## 4. Buying and paying

- Winning bidders must pay the full order amount (winning price plus the stated shipping fee) within 48 hours of the auction close. Unpaid orders are cancelled and may result in account restrictions.
- Payment is made through Platform-supported methods — Paynow (card, EcoCash, InnBucks and other Zimbabwean methods) or agreed manual methods — and is held by the Platform in escrow.
- Funds are released to the seller only after the order is marked delivered and the 7-day dispute window closes without an open dispute, or an admin resolves a dispute in the seller's favour.
- All prices are in United States dollars (USD). Zimbabwean taxes that apply to platform fees are handled by Tengasell as described in the Seller Agreement.

## 5. Selling and dispatch

- Sellers must dispatch paid orders within 3 days and enter a valid tracking or delivery reference.
- Listings must accurately describe the item, its condition and its location, and must comply with the Seller Agreement, the Marketplace Rules and the Acceptable Use Policy.
- Sellers grant buyers the statutory consumer protections of Zimbabwe, including the right to return defective goods within the window provided by law and these Terms.

## 6. Disputes

- A buyer may open a dispute within 7 days of delivery for: item not received, item significantly not as described, or item defective/damaged.
- Tengasell reviews disputes using the evidence submitted by both parties (photos, messages, tracking records).
- Refunds are processed within 5 business days of a dispute being decided in the buyer's favour, in accordance with the Refund Policy.

## 7. Fees

Sellers pay a final-value fee of 8% of the item price, capped at US$50 per order, plus a US$2 featured-listing fee where the seller opts to feature a listing. Fees are set out in full in the Seller Agreement. Buyers pay no platform fees.

## 8. Suspension and termination

We may suspend, restrict or terminate accounts that violate these Terms, our policies or applicable law, or that expose the Platform or its users to risk. Where practical, we give notice and an opportunity to respond. You may close your account at any time through Privacy Centre account-deletion, subject to completed transactions, open disputes, tax-record retention and any legal hold.

## 9. Liability

To the maximum extent permitted by law, Tengasell's aggregate liability arising from or connected to a transaction or the Platform is limited to the greater of the fees you paid us for the transaction or US$100. We are not liable for indirect or consequential loss. Nothing in these Terms excludes liability that cannot be excluded under Zimbabwean law.

## 10. Changes to these Terms

We may update these Terms to reflect changes in the Platform or the law. Material changes are published with a new version number and effective date; continued use after the effective date constitutes acceptance. We record policy acceptances with a timestamp and version number.

## 11. Governing law and dispute resolution

These Terms are governed by the laws of Zimbabwe. Disputes are first addressed through the Platform's dispute process. Unresolved disputes are settled by arbitration in Harare under the Arbitration Act [Chapter 7:15], in English, by a single arbitrator agreed by the parties or appointed by the Harare Commercial Arbitration Centre.

## 12. Contact

Questions about these Terms: legal@tengasell.com or Tengasell (Private) Limited, Harare, Zimbabwe.

${FOOTER_EN}`;

const TOS_JA = `Tengasellは、ジンバブエおよび海外の独立出品者と購入者をつなぐオンライン・オークション・マーケットプレイスを運営しています。本利用規約（以下「本規約」）は、Tengasell (Private) Limited（以下「Tengasell」）と、当サイト・アプリ・サービス（以下「本プラットフォーム」）を利用するお客様との間の契約です。アカウント登録、入札、出品その他本プラットフォームの利用により、お客様は本規約に同意したものとみなされます。

## 1. 当社の役割：仲介業者

Tengasellはマーケットプレイスの仲介者です。場所（サイト）、オークションエンジン、エスクロー型の入金保管、コミュニケーション機能、紛争処理を提供します。購入者と出品者との間の売買契約の当事者ではありません。出品物は出品者自身のものであり、取引の契約相手は出品者です。出品情報の正確性・適法性・目的適合性を保証しません。ジンバブエ消費者保護法（Chapter 14:44）が購入者に与える権利を、本規約により制限することはありません。

## 2. 利用資格とアカウント

- 18歳以上で、法的に契約を締結できる方がご利用いただけます。
- 1人（1事業者）1アカウントです。アカウントの譲渡・共有は禁止します。
- ログイン情報の管理はお客様の責任です。多要素認証の提供時に有効化することをお勧めします。
- 出品・出金リクエスト時、または紛争・不正調査・法的要請に関連して、本人確認（KYC）を求める場合があります。

## 3. オークションと入札

- オークションは出品に記載された期間実施されます。予約価格（あれば）を満たす最高額入札が落札します。
- 自動入札（プロキシ入札）：最高入札額を設定すると、システムが差額分を自動入札します。上限額は他の利用者に表示されません。
- 終了間際の入札があると、終了時刻が延長され、他の入札者が対抗できるようにします（スニピング防止）。
- 即決購入：即決価格での支払い完了時に、他の入札より優先してオークションが即時終了します。
- 入札は拘束力のある申込です。正当な理由のない入札の取り消しは違反です。
- さや予備入札（自分や知人に高額入札させる行為）は不正として厳しく禁止します。

## 4. 購入と支払い

- 落札者はオークション終了後48時間以内に、落札価格＋配送料を支払う必要があります。未払いの場合は注文がキャンセルされ、アカウント制限となる場合があります。
- 支払いはPaynow（カード・EcoCash・InnBucks等）または合意された手動方法で行われ、資金はプラットフォームがエスクロー（保管）します。
- 資金は、商品到着後7日間の紛争期間を異議なく経過するか、管理者が出品者有利で紛争を解決した後に、出品者へ解放されます。
- 価格はすべて米ドル（USD）です。プラットフォーム手数料への課税は出品者契約の定めによります。

## 5. 出品と発送

- 出品者は、支払い済み注文を3日以内に発送し、追跡番号等を登録してください。
- 出品情報は商品・状態・所在地を正確に記載し、出品者契約・マーケットプレイスルール・許容利用ポリシーを遵守してください。
- 出品者はジンバブエ法に基づく法定の消費者保護（不良品の返品権を含む）を購入者に提供します。

## 6. 紛争処理

- 購入者は到着後7日以内に、未着・説明と著しく異なる・不良・破損を理由に紛争を開始できます。
- Tengasellは双方の証拠（写真・メッセージ・追跡記録）に基づき審査します。
- 購入者有利の裁定後、返金は5営業日以内に処理されます（返金ポリシーによる）。

## 7. 手数料

出品者には落札価格8%（1件上限50米ドル）の成約手数料と、特集出品を選択した場合2米ドルの特集料がかかります。詳細は出品者契約に定めます。購入者にプラットフォーム手数料はかかりません。

## 8. 停止と終了

本規約・各ポリシー・法令への違反、またはリスクをもたらすアカウントは、制限・停止・終了する場合があります。可能な範囲で通知と弁明の機会を提供します。お客様はプライバシーセンターからいつでもアカウント削除をリクエストできます（完了済み取引・係争中の紛争・税務記録の保存・法的ホールドの対象を除く）。

## 9. 責任の制限

法令で許される最大限の範囲において、Tengasellの責任総額は、当該取引で当社に支払われた手数料または100米ドルのいずれか高い方を上限とします。間接損害・結果的損害については責任を負いません。ジンバブエ法により排除できない責任は、この限りではありません。

## 10. 規約の変更

本規約はサービスや法令の変化に応じて更新されます。重要な変更は新しいバージョン番号と発効日付きで公表し、継続利用をもって同意とみなします。同意の記録はバージョン番号とタイムスタンプ付きで保存します。

## 11. 準準拠法と紛争解決

本規約はジンバブエ法に準拠します。紛争はまずプラットフォームの紛争プロセスで処理し、解決しない事項はハラレにおいて仲裁法（Chapter 7:15）に基づき英語で仲裁により解決します。

## 12. お問い合わせ

本規約について：legal@tengasell.com（Tengasell (Private) Limited, ハラレ, ジンバブエ）。

${FOOTER_JA}`;

// ── 2. Privacy Policy ───────────────────────────────────────────────────────

const PRIVACY_EN = `This Privacy Policy explains how Tengasell (Private) Limited ("Tengasell", "we", "us") collects, uses, stores, shares and protects personal information when you use the Tengasell marketplace (the "Platform"). It is written to comply with the Cyber and Data Protection Act [Chapter 12:07] of Zimbabwe ("CDPA"), under which the Postal and Telecommunications Regulatory Authority of Zimbabwe (POTRAZ) is designated as the data protection authority and Tengasell acts as a data controller.

## 1. Who we are

Tengasell (Private) Limited, Harare, Zimbabwe, is the data controller for personal information processed through the Platform. Our data protection contact: privacy@tengasell.com. We are completing registration as a data controller with POTRAZ in accordance with the CDPA, and this policy will be updated with our registration status.

## 2. Information we collect

- Account data: username, display name, email address, password (stored only as a verifiable hash by our authentication provider), phone number where you provide it.
- Profile data: city, biography, photograph, ratings.
- Transaction data: bids (including proxy-bid maximums), orders, payments and payment references, escrow and payout records, refunds, invoices, fees and tax records.
- Listing data: item descriptions, photographs and questions and answers you post.
- Communications data: messages between buyers and sellers, notifications sent to you, channel links (email, Telegram, WhatsApp, Messenger) and your communication preferences.
- Technical data: log records of actions on the Platform (audit events), IP addresses in service logs, device and browser information, cookies and local storage needed to run the Platform (session, language and theme preferences).
- Support and trust data: dispute evidence, reports you file, verification (KYC) documents you submit, moderation records.

## 3. Why we process your information (purposes and legal bases)

Under the CDPA we rely on the following bases:

- Contract: creating your account, running auctions, processing orders, holding and releasing escrow, paying sellers, handling disputes and refunds. Without this data we cannot operate the marketplace for you.
- Legal obligation: keeping tax and accounting records (Value Added Tax Act [Chapter 23:12]; records retention obligations), responding to lawful requests, preventing fraud and money laundering, and honouring legal holds.
- Legitimate interests: keeping the Platform safe and available — abuse detection, shill-bidding detection, security logging, service monitoring and improvement.
- Consent: marketing communications (each channel is opt-in and you may withdraw consent at any time), and optional channel links you verify.
- Vital interests / legal claims: protecting rights, property and safety of our users and ourselves.

Sensitive data (such as special categories under the CDPA) is not required to use the Platform and should not be submitted.

## 4. Your rights

The CDPA gives you rights over your personal information, and we provide tools for each in the Privacy Centre of your account:

- Access — obtain a copy of the personal information we hold about you.
- Correction — correct inaccurate or incomplete information (most profile fields are self-service).
- Deletion — request deletion of your account and personal data, subject to the retention exceptions below.
- Portability — receive your data in a structured, machine-readable (JSON) export.
- Restriction — request that we restrict certain processing while a request or dispute is being resolved.
- Objection — object to direct marketing at any time (also available per channel via notification preferences and unsubscribe links).

You may submit a request through the Privacy Centre or by emailing privacy@tengasell.com. We respond within 30 days. You may also lodge a complaint with POTRAZ as the supervisory authority.

## 5. Sharing and processors

We do not sell your personal information. We share it only as needed to run the Platform:

- Payment processing: Paynow (Zimbabwe) processes card, EcoCash and bank payments. Payment data is handled by the payment provider; we store references, amounts and statuses.
- Communications providers: Resend (email), Telegram, WhatsApp (Meta) and Messenger (Meta) deliver notifications you have linked or opted into.
- Mapping: OpenStreetMap tile servers render maps on item pages.
- Hosting and infrastructure: the Platform is self-hosted on infrastructure engaged by Tengasell; the AI assistant is provided through a third-party model API under contractual confidentiality.
- Professional advisers, auditors and insurers under confidentiality.
- Law enforcement and regulators, where compelled by lawful request (see our policy on lawful requests) or where reporting is legally required.

Our processor register (in the Platform's governance console) records each processor's role, location, categories of data, transfer basis and review date.

## 6. Cross-border transfers

The Platform's primary database is self-hosted. Some processors operate outside Zimbabwe (for example email delivery and messaging APIs, map tiles and the AI model API). Where your information is transferred across borders, we do so only to providers bound by contractual data-protection terms, we transfer only the minimum data the service requires, and we document the transfer basis in our processor register. Where you link a channel such as Telegram or WhatsApp, you understand those providers process your handle and message content under their own privacy terms.

## 7. Retention

We keep personal information only as long as needed for the purposes above. Key retention periods:

- Account and profile data: until you delete your account, then removed from active systems.
- Order, payment, fee and tax records: 7 years (tax and accounting law).
- Audit and security logs: 12 months.
- Disputes and moderation records: 3 years after closure.
- Marketing consents: until withdrawn, plus a suppression record to honour your opt-out.
- Legal holds: for the duration of the hold, overriding deletion.

When you request deletion, we remove your personal data from active systems and retain only what tax, accounting, consumer-protection and legal-hold obligations require (primely order/payment records, retained in a de-identified form where possible). We record which categories were retained and why.

## 8. Security

We apply technical and organisational measures appropriate to the risk: hashed passwords, multi-factor authentication for administrative accounts, role-based access control, encrypted transport (TLS), escrow-controlled money movement, audit logging of privileged actions, moderation of user-to-user contact details, security reviews and a threat model maintained by the platform team. No system is perfectly secure; if a breach affects your personal information, we follow our incident response process.

## 9. Data breach notification

If a security incident is likely to result in a high risk to your rights and freedoms, we will notify POTRAZ as required by the CDPA without undue delay, and will inform affected users, including through Platform notifications and our communications channels.

## 10. Children

The Platform is not directed at persons under 18 and we do not knowingly collect their personal information. If we learn we have done so, we delete it.

## 11. Changes to this policy

We version this policy. Material changes are published with a new version number and effective date; where required we seek your consent (for example, for new marketing uses) and record your acceptance.

## 12. Contact and complaints

Data protection contact: privacy@tengasell.com. Postal: Tengasell (Private) Limited, Harare, Zimbabwe. If you believe we have not handled your information lawfully you may complain to us first and then to POTRAZ in its capacity as data protection authority.

${FOOTER_EN}`;

const PRIVACY_JA = `本プライバシーポリシーは、Tengasell (Private) Limited（以下「Tengasell」）が当マーケットプレイス（以下「本プラットフォーム」）で個人情報をどのように収集・利用・保存・共有・保護するかを説明します。本ポリシーは、ジンバブエのサイバーおよびデータ保護法（Cyber and Data Protection Act [Chapter 12:07]、以下「CDPA」）に準拠して作成されています。CDPAでは、ジンバブエ郵政通信規制庁（POTRAZ）がデータ保護当局に指定されており、Tengasellはデータ管理者（コントローラー）として行動します。

## 1. 当社について

Tengasell (Private) Limited（ハラレ、ジンバブエ）が本プラットフォームで処理される個人情報のデータ管理者です。データ保護担当：privacy@tengasell.com。CDPAに基づきPOTRAZへのデータ管理者登録を進めており、登録状況は本ポリシーで更新します。

## 2. 収集する情報

- アカウント情報：ユーザー名、表示名、メールアドレス、パスワード（認証提供者により検証可能なハッシュのみ保存）、任意の電話番号。
- プロフィール情報：都市、自己紹介、写真、評価。
- 取引情報：入札（自動入札の上限を含む）、注文、支払いと参照番号、エスクロー・出金記録、返金、請求書、手数料・税務記録。
- 出品情報：商品説明、写真、質問と回答。
- コミュニケーション情報：取引メッセージ、通知、チャネル連携（メール・Telegram・WhatsApp・Messenger）と通知設定。
- 技術情報：監査ログ、サービスログ内のIPアドレス、デバイス・ブラウザ情報、プラットフォーム動作に必要なCookie・ローカルストレージ（セッション・言語・テーマ設定）。
- サポート・信頼性情報：紛争の証拠、通報記録、本人確認（KYC）書類、モデレーション記録。

## 3. 利用目的と法的根拠（CDPA）

- 契約：アカウント管理、オークション運営、注文処理、エスクロー保管と解放、出品者への支払い、紛争・返金処理。
- 法的義務：税務・会計記録の保存（付加価値税法 Chapter 23:12）、法令に基づく要請への対応、不正・資金洗浄の防止、法的ホールドの遵守。
- 正当な利益：不正検知、さや予備入札検知、セキュリティログ、サービス監視と改善。
- 同意：マーケティング通信（チャネルごとのオプトイン、いつでも取り消し可能）、任意のチャネル連携。
- 権利・財産・安全の保護：利用者と当社の権利保護。

本プラットフォームの利用に機密情報（CDPAの特別カテゴリー等）は不要であり、送信しないでください。

## 4. お客様の権利

CDPAに基づく権利と、アカウントのプライバシーセンターでのご利用手段：

- 開示 — 当社が保有する個人情報のコピーを取得。
- 訂正 — 不正確・不完全な情報の訂正（プロフィール項目の多くはセルフサービス）。
- 削除 — アカウントと個人情報の削除リクエスト（下記の保存例外を除く）。
- ポータビリティ — 構造化された機械可読（JSON）形式でのデータ受取。
- 制限 — リクエストや紛争の解決中、特定の処理の制限を要求。
- 反対 — ダイレクトマーケティングへの異議（通知設定や配信停止リンクからも可能）。

リクエストはプライバシーセンターまたはprivacy@tengasell.comへ。30日以内に回答します。POTRAZへの苦情申立ても可能です。

## 5. 共有と処理委託先

個人情報を販売しません。運営に必要な範囲のみ共有します：

- 決済：Paynow（ジンバブエ）がカード・EcoCash・銀行決済を処理。決済データは決済提供者が処理し、当社は参照番号・金額・状態を保存します。
- 通信提供者：Resend（メール）、Telegram、WhatsApp（Meta）、Messenger（Meta）。
- 地図：OpenStreetMapタイルサーバー。
- ホスティング・インフラ：本プラットフォームは自社ホスティング。AIアシスタントは守秘義務条項付きの第三者モデルAPIで提供。
- 守秘義務のある専門助言者・監査人・保険者。
- 法令に基づく要請または報告義務がある場合の法執行機関・規制当局。

処理委託先登録簿（ガバナンスコンソール）に各委託先の役割・所在地・データ区分・移転根拠・レビュー期日を記録しています。

## 6. 国際移転

主要データベースは自社ホスティングです。一部の委託先（メール配信、メッセージングAPI、地図タイル、AIモデルAPI等）はジンバブ国外で事業を運営しています。国境を越える移転は、契約上のデータ保護条項に拘束された委託先に対してのみ、サービスに必要な最小限のデータを移転し、移転根拠を委託先登録簿に記録します。TelegramやWhatsAppを連携した場合、これらの提供者は利用者名義やメッセージ内容を各自のプライバシー規約に基づき処理します。

## 7. 保存期間

- アカウント・プロフィール：削除リクエストまで。その後は稼働システムから削除。
- 注文・支払い・手数料・税務記録：7年（税務・会計法）。
- 監査・セキュリティログ：12ヶ月。
- 紛争・モデレーション記録：終了後3年。
- マーケティング同意：撤回まで（オプトアウトを遵守するための配信停止記録を除く）。
- 法的ホールド：ホールドの期間中（削除に優先）。

削除リクエスト時、稼働システムから個人情報を削除し、税務・会計・消費者保護・法的ホールド義務で必要なもの（主に注文・支払い記録、可能な範囲で匿名化）のみ保存します。保存した区分と理由を記録します。

## 8. セキュリティ

リスクに応じた技術的・組織的措置を講じます：パスワードのハッシュ化、管理者アカウントへの多要素認証、役割ベースのアクセス制御、暗号化通信（TLS）、エスクローによる資金管理、特権操作の監査ログ、利用者間連絡先のモデレーション、セキュリティレビューと脅威モデルの維持。完全に安全なシステムは存在しません。個人情報に影響する漏えいが発生した場合は、インシデント対応プロセスに従います。

## 9. データ漏えい通知

利用者の権利に高リスクをもたらす可能性のあるセキュリティインシデントが発生した場合、CDPAの要件に従い遅滞なくPOTRAZへ通知し、プラットフォーム通知等を通じて影響を受ける利用者にもお知らせします。

## 10. 児童

本プラットフォームは18歳未満の方を対象とせず、その個人情報を意図的に収集しません。判明した場合は削除します。

## 11. ポリシーの変更

本ポリシーはバージョン管理します。重要な変更は新しいバージョン番号と発効日付きで公表し、必要な場合（新たなマーケティング利用等）は同意を求め、同意記録を保存します。

## 12. お問い合わせと苦情

データ保護担当：privacy@tengasell.com／Tengasell (Private) Limited, ハラレ, ジンバブエ。法令違反と思われる場合は、まず当社へ、その後POTRAZへ苦情を申立てできます。

${FOOTER_JA}`;

// ── 3. Marketplace Rules ────────────────────────────────────────────────────

const RULES_EN = `These Marketplace Rules apply to every participant on Tengasell and work alongside the Terms of Service, the Seller Agreement, the Acceptable Use Policy and the Refund Policy. They define the duties of buyers and sellers so that the auction floor stays fair, honest and safe.

## 1. Everyone

- Deal honestly. Misrepresentation, concealment of defects and manipulation of the auction process are violations.
- Keep transactions on the Platform. Paying or communicating off-platform removes escrow protection, evidence trails and dispute rights, and is itself a violation (see the Acceptable Use Policy).
- Treat other users with respect. Harassment, hate speech and abuse in messages, questions or ratings are prohibited and are automatically screened.
- One account per person. Using multiple accounts to bid, sell or evade restrictions is prohibited.

## 2. Buyers

- Bid only what you intend to pay. Bids are binding.
- Pay within 48 hours of winning. Unpaid wins are cancelled and repeat non-payment leads to bidding restrictions.
- Read the listing. Condition, shipping fee, dispatch time and location are the seller's statements — check them before bidding and ask questions through the Q&A.
- Rate honestly after delivery. Ratings are the marketplace's trust engine; retaliatory or fake ratings are violations.
- Open disputes within 7 days of delivery and only for genuine reasons: item not received, significantly not as described, or defective/damaged goods.

## 3. Sellers

- List accurately: true photographs of the actual item, honest condition descriptions, correct category, realistic shipping fee and dispatch time.
- Dispatch within 3 days of payment and record the delivery reference. Dispatch SLA breaches reduce your seller standing.
- Answer buyer questions within a reasonable time; your response time is shown on your profile.
- Do not bid on your own listings or arrange bids by others (shill bidding). Do not contact bidders to steer them to off-platform deals.
- Honour refunds decided against you. Escrow release depends on a clean dispute window.
- Comply with the Acceptable Use Policy: certain goods may never be listed, and others need licences you must hold.

## 4. Auction integrity

- The auction engine extends closing time when bids arrive in the final minutes (anti-snipe), so no bid placed in good faith loses to timing games.
- Proxy-bid maximums are confidential and are never disclosed to other users.
- Buy-now ends an auction immediately; the seller cannot cancel to keep bidding open after a buy-now payment.
- Sellers may cancel a listing only before a winning bid exists. Once an auction closes with a winner, the seller must honour the sale.

## 5. Enforcement

Violations are handled under our trust and safety process: warnings, listing removal, bid restrictions, account suspension and, for fraud or illegal goods, reports to authorities. Enforcement is logged and can be appealed once with new evidence. Ratings and dispute outcomes can be revisited only where fraud or manifest error is shown.

## 6. Questions

Contact support through the Help centre. Rule questions can also be raised with our moderation team, who apply these rules day to day.

${FOOTER_EN}`;

const RULES_JA = `本マーケットプレイスルールは、利用規約・出品者契約・許容利用ポリシー・返金ポリシーとともに、Tengasellのすべての利用者に適用されます。公正で誠実かつ安全なオークションを維持するための、購入者と出品者の義務を定めます。

## 1. すべての利用者

- 誠実に取引してください。虚偽表示、欠陥の隠蔽、オークション操作は違反です。
- 取引は必ずプラットフォーム内で行ってください。プラットフォーム外の支払い・連絡は、エスクロー保護・証拠・紛争権利を失わせるため、それ自体が違反です（許容利用ポリシー参照）。
- 他の利用者を尊重してください。メッセージ・質問・評価での嫌がらせ・憎悪表現・侮辱は禁止され、自動スクリーニングされます。
- 1人1アカウントです。複数アカウントによる入札・出品・制限回避は禁止です。

## 2. 購入者

- 支払う意思のある金額のみ入札してください。入札は拘束力があります。
- 落札後48時間以内に支払ってください。未払いは注文キャンセルとなり、繰り返しは入札制限につながります。
- 出品情報をよく確認してください。状態・配送料・発送時間・所在地は出品者の表明です。入札前に確認し、Q&Aで質問してください。
- 到着後、誠実に評価してください。報復的・偽の評価は違反です。
- 紛争は到着後7日以内に、正当な理由（未着・説明と著しく異なる・不良・破損）でのみ開始してください。

## 3. 出品者

- 正確に出品してください：実物の写真、誠実な状態説明、正しいカテゴリー、現実的な配送料と発送時間。
- 支払い後3日以内に発送し、配送参照を記録してください。SLA違反は出品者評価を下げます。
- 購入者の質問に合理的な時間内に回答してください。回答時間はプロフィールに表示されます。
- 自分の出品への入札や、他者による入札の工作（さや予備）は禁止です。入札者へのプラットフォーム外取引の勧誘も禁止です。
- 買い手有利の裁定に従ってください。エスクロー解放は紛争期間のクリアに依存します。
- 許容利用ポリシーを遵守してください。出品できない商品と、資格・免許が必要な商品があります。

## 4. オークションの公正性

- 終了間際の入札で終了時刻を延長します（スニピング防止）。
- 自動入札の上限は他の利用者に開示されません。
- 即決購入はオークションを即時終了させます。支払い後のキャンセルで入札を続けることはできません。
- 出品者は落札者が確定する前にのみキャンセルできます。落札が成立したら履行してください。

## 5. 対応

違反には注意・出品削除・入札制限・アカウント停止で対応し、不正や違法商品は当局へ通報します。対応は記録され、新証拠があれば一度異議申立てできます。評価と紛争結果は、不正や明白な誤りがある場合にのみ見直されます。

## 6. 質問

ヘルプセンターからサポートに連絡してください。

${FOOTER_JA}`;

// ── 4. Seller Agreement ─────────────────────────────────────────────────────

const SELLER_EN = `This Seller Agreement governs your selling activity on Tengasell. By listing an item you accept this agreement together with the Terms of Service, the Marketplace Rules and the Acceptable Use Policy.

## 1. Who may sell

- Individual sellers must be 18 or older with a verified account.
- Business sellers must be lawfully registered (for example under the Companies and Other Business Entities Act [Chapter 24:31] or as a licensed informal trader) and must display their trading name in their profile.
- You may sell only goods you own or are lawfully authorised to sell, and that are located in (or dispatchable from) the location stated on the listing.

## 2. Fees

- Final-value fee: 8% of the item sale price, capped at US$50 per order. The fee is charged when an order is paid and is deducted from your escrow payout or balance.
- Featured listing fee: US$2 (optional), charged at listing time to promote the item on the home page and category rails.
- No listing fees and no buyer fees. Fees are exclusive of VAT, which Tengasell accounts for on its commission revenue as required by the Value Added Tax Act [Chapter 23:12].
- Fees for cancelled or refunded orders are reversed proportionally.

## 3. Payouts and KYC

- Sale proceeds are held in escrow and released to your seller balance when the order is delivered and the 7-day dispute window closes without an open dispute (or an admin resolves a dispute in your favour).
- You may request a payout of your balance (minimum US$10) to your bank or mobile-money account. Payouts above US$100 require dual approval by our finance roles.
- Before your first payout you must complete identity verification: a government-issued ID and the account name matching your payout destination.
- You are responsible for your own taxes on sale proceeds. Tengasell's fees and VAT obligations are separate.

## 4. Dispatch SLA

- Dispatch paid orders within 3 days and enter the tracking/delivery reference. Buyers can see your dispatch performance on your profile.
- Late dispatch is a rules violation; repeated breaches lead to selling restrictions.

## 5. Screening and sanctions consent

You agree that Tengasell may screen you, your listings and your transactions against prohibited-parties lists and its own fraud controls, and may require additional verification before allowing listings, releases or payouts. We may delay or refuse a payout where a screening result, dispute or lawful request requires it. This is necessary for the Platform's anti-fraud and legal-compliance duties.

## 6. Prohibited conduct

You may not list prohibited goods (see the Acceptable Use Policy for the full list), sell counterfeit or stolen items, misdescribe items, shill bid, steer buyers off-platform, or misuse the ratings system. Violations lead to listing removal, fee forfeiture, payout holds and account suspension.

## 7. Content licence

You retain ownership of your listing photographs and text. You grant Tengasell a non-exclusive, worldwide licence to host, reproduce and display that content for the operation, promotion and archiving of the marketplace, for as long as the listing and its records exist on the Platform.

## 8. Termination

You may stop selling at any time. We may suspend selling privileges for violations, fraud indicators, failed KYC or legal requirements. Earned balances are paid out subject to section 3 verification and any open disputes or holds.

${FOOTER_EN}`;

const SELLER_JA = `本出品者契約は、Tengasellでの出品活動に適用されます。出品により、利用規約・マーケットプレイスルール・許容利用ポリシーとともに本契約に同意したものとみなされます。

## 1. 出品資格

- 個人出品者は18歳以上で、認証済みアカウントが必要です。
- 事業者出品者は適法に登録され（会社法人等登記法 Chapter 24:31 または免許を持つインフォーマル事業者等）、プロフィールに商号を表示してください。
- 自己所有または適法に販売する権限のある商品で、出品に記載の場所から発送できるものに限ります。

## 2. 手数料

- 成約手数料：落札価格の8%（1件あたり上限50米ドル）。注文の支払い完了時に計上し、エスクロー出金または残高から控除します。
- 特集出品料：2米ドル（任意）。出品時に課され、ホーム画面・カテゴリー欄に商品を表示します。
- 出品料・購入者手数料は無料。手数料は付加価値税別（当社は付加価値税法 Chapter 23:12 に基づき手数料収入のVATを処理します）。
- キャンセル・返金された注文の手数料は比例して取り消されます。

## 3. 出金とKYC

- 代金はエスクローで保管され、商品到着後7日間の紛争期間を異議なく経過するか、管理者が出品者有利で裁定した後に、出品者残高へ解放されます。
- 残高（最低10米ドル）から銀行・モバイルマネーへの出金をリクエストできます。100米ドル超の出金は財務ロールの二重承認が必要です。
- 初回出金前に本人確認（政府発行IDと、出金先名義の一致）を完了してください。
- 売上に対する税務は出品者ご自身の責任です。

## 4. 発送SLA

- 支払い済み注文は3日以内に発送し、追跡・配送参照を記録してください。発送成績はプロフィールに表示されます。
- 遅延発送は違反であり、繰り返しは出品制限につながります。

## 5. スクリーニングと制裁リストへの同意

Tengasellは、出品者・出品・取引を、禁止者リストおよび不正対策基準でスクリーニングし、出品・解放・出金の前に追加確認を求める場合があります。スクリーニング結果・紛争・法令に基づく要請により、出金を遅延または拒否することがあります。これは不正防止と法令遵守に必要な措置です。

## 6. 禁止行為

禁止商品の出品（許容利用ポリシー参照）、偽ブランド・盗品の販売、虚偽説明、さや予備入札、プラットフォーム外への誘導、評価システムの悪用は禁止します。違反は出品削除・手数料没収・出金保留・アカウント停止につながります。

## 7. コンテンツライセンス

出品写真・文章の所有権は出品者に帰属します。出品者は、Tengasellに対し、出品と記録がプラットフォームに存在する期間、マーケットプレイスの運営・プロモーション・アーカイブのために当該コンテンツをホスト・複製・表示する非独占的かつ世界的なライセンスを許諾します。

## 8. 終了

いつでも出品を停止できます。違反・不正兆候・KYC不備・法令要件により出品権限を停止する場合があります。残高は第3条の本人確認と、係争中の紛争・ホールドの対象を条件に出金されます。

${FOOTER_JA}`;

export const POLICIES_PART1: PolicyContent[] = [
  {
    key: "tos",
    title: "Terms of Service",
    titleJa: "利用規約",
    owner: "legal",
    changeNote: "Initial v1.0 publication (MSCS 12-d).",
    en: TOS_EN,
    ja: TOS_JA,
  },
  {
    key: "privacy",
    title: "Privacy Policy",
    titleJa: "プライバシーポリシー",
    owner: "compliance",
    changeNote: "Initial v1.0 publication (MSCS 12-d).",
    en: PRIVACY_EN,
    ja: PRIVACY_JA,
  },
  {
    key: "rules",
    title: "Marketplace Rules",
    titleJa: "マーケットプレイスルール",
    owner: "trust",
    changeNote: "Initial v1.0 publication (MSCS 12-d).",
    en: RULES_EN,
    ja: RULES_JA,
  },
  {
    key: "seller",
    title: "Seller Agreement",
    titleJa: "出品者契約",
    owner: "legal",
    changeNote: "Initial v1.0 publication (MSCS 12-d).",
    en: SELLER_EN,
    ja: SELLER_JA,
  },
];
