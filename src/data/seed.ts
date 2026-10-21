// Tengasell — deterministic seed data.
// Single source of truth used by BOTH:
//   1. mini-services/trailbase-db/gen-sql.ts  → SQL migration import (live TrailBase)
//   2. src/lib/tengasell/api/local.ts          → offline demo fallback store
//
// Times are computed relative to "now" at build/load time so the marketplace
// always feels alive. The trade engine re-stagger live auctions on boot.

import { IMAGES } from "./images";
import {
  bidIncrement,
  round2,
  slugify,
} from "@/lib/tengasell/format";
import type {
  Auction,
  Bid,
  Category,
  Message,
  Notification,
  Order,
  Payment,
  Profile,
  Question,
  Rating,
  Thread,
  WatchItem,
} from "@/lib/tengasell/types";

export const DEMO_PASSWORD = "Tengasell#2025";

// ── deterministic pseudo-random (same sequence every run) ───────────
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function isoMinutesFromNow(min: number): string {
  return new Date(Date.now() + min * 60_000).toISOString().replace(/\.\d+Z$/, "Z");
}

const BUYER_POOL = [
  "simba",
  "panashe",
  "ruvarashe",
  "shamiso",
  "tatenda",
  "anesu",
  "mukudzei",
  "blessing",
  "tendai",
  "chipo",
];

export const SEED_CATEGORIES: Category[] = [
  { id: 1, slug: "phones", name: "Phones & Tablets", name_ja: "スマホ・タブレット", icon: "smartphone", blurb: "Smartphones, tablets, chargers and accessories", sort: 1 },
  { id: 2, slug: "electronics", name: "Electronics", name_ja: "家電・電子機器", icon: "zap", blurb: "TVs, audio, cameras, gaming and gadgets", sort: 2 },
  { id: 3, slug: "computers", name: "Computers", name_ja: "パソコン", icon: "laptop", blurb: "Laptops, desktops, monitors and parts", sort: 3 },
  { id: 4, slug: "solar-power", name: "Solar & Power", name_ja: "ソーラー・電源", icon: "sun", blurb: "Panels, inverters, batteries, generators — beat load shedding", sort: 4 },
  { id: 5, slug: "home", name: "Home & Appliances", name_ja: "家具・家電", icon: "refrigerator", blurb: "Kitchen, furniture, appliances and décor", sort: 5 },
  { id: 6, slug: "fashion", name: "Fashion & Beauty", name_ja: "ファッション", icon: "shirt", blurb: "Sneakers, bags, watches, apparel and beauty", sort: 6 },
  { id: 7, slug: "vehicles", name: "Vehicles & Parts", name_ja: "自動車・パーツ", icon: "car", blurb: "Cars, bakkies, bikes, spares and accessories", sort: 7 },
  { id: 8, slug: "sports", name: "Sports & Hobbies", name_ja: "スポーツ・趣味", icon: "dumbbell", blurb: "Instruments, fitness, outdoor and gaming", sort: 8 },
  { id: 9, slug: "collectibles", name: "Art & Collectibles", name_ja: "アート・コレクション", icon: "palette", blurb: "Shona sculpture, paintings, banknotes and rarities", sort: 9 },
  { id: 10, slug: "farm-industrial", name: "Farm & Industrial", name_ja: "農業・工業", icon: "sprout", blurb: "Farming equipment, pumps, tools and machinery", sort: 10 },
  { id: 11, slug: "books-media", name: "Books & Media", name_ja: "本・メディア", icon: "book-open", blurb: "Books, vinyl, media lots and prints", sort: 11 },
];

interface SeedProfileIn {
  username: string;
  display_name: string;
  bio: string;
  city: string;
  rating_avg: number;
  rating_count: number;
  sales: number;
  response_minutes: number;
  verified: number;
  joined_days_ago: number;
}

export const SEED_PROFILES: SeedProfileIn[] = [
  { username: "admin", display_name: "Tengasell Official", bio: "Platform operations account. Trust & safety, dispute resolution and verified seller programmes.", city: "Harare", rating_avg: 5, rating_count: 0, sales: 0, response_minutes: 15, verified: 1, joined_days_ago: 420 },
  { username: "takudzwa", display_name: "Takudzwa Mutasa", bio: "Gadgets and tools. 9 years selling on Tengasell. Based in Avondale, Harare. Pickup welcome.", city: "Harare", rating_avg: 4.9, rating_count: 412, sales: 611, response_minutes: 22, verified: 1, joined_days_ago: 380 },
  { username: "nyasha", display_name: "Nyasha Katuruza", bio: "Phones in Bulawayo. Every device bench-tested for 48 hours before listing. Swap negotiable.", city: "Bulawayo", rating_avg: 4.8, rating_count: 289, sales: 344, response_minutes: 35, verified: 1, joined_days_ago: 350 },
  { username: "rufaro", display_name: "Rufaro Chikafu — Solar Queen", bio: "Off-grid power solutions. Complete kits installed anywhere in Zimbabwe. COC certificate included on installs.", city: "Harare", rating_avg: 4.9, rating_count: 517, sales: 720, response_minutes: 12, verified: 1, joined_days_ago: 400 },
  { username: "blessing", display_name: "Blessing Shoko", bio: "Authentic fashion imports. 100% genuine or triple your money back.", city: "Mutare", rating_avg: 4.7, rating_count: 178, sales: 253, response_minutes: 55, verified: 0, joined_days_ago: 260 },
  { username: "kudzai", display_name: "Kudzai Marange", bio: "Vehicles and spares. Viewings by appointment in Gweru. AA inspection welcome on any unit.", city: "Gweru", rating_avg: 4.8, rating_count: 96, sales: 118, response_minutes: 90, verified: 1, joined_days_ago: 300 },
  { username: "tatenda", display_name: "Tatenda Nyoni", bio: "Collectibles, coins and banknotes. Lifetime collector turned dealer. COA on rarities.", city: "Harare", rating_avg: 5, rating_count: 143, sales: 187, response_minutes: 18, verified: 1, joined_days_ago: 240 },
  { username: "tendai", display_name: "Tendai Chirwa", bio: "Refurbished business laptops. Corporate lease returns with new SSDs and fresh Windows.", city: "Harare", rating_avg: 4.8, rating_count: 234, sales: 299, response_minutes: 26, verified: 1, joined_days_ago: 320 },
  { username: "chipo", display_name: "Chipo Moyo", bio: "Home appliances with warranty. Family-run since 2019. Bulawayo pickup or nationwide courier.", city: "Bulawayo", rating_avg: 4.7, rating_count: 155, sales: 201, response_minutes: 40, verified: 1, joined_days_ago: 280 },
  { username: "farai", display_name: "Farai Dube", bio: "Farm inputs and machinery. Bulk deals for cooperatives. Masvingo based, deliver countrywide.", city: "Masvingo", rating_avg: 4.8, rating_count: 88, sales: 121, response_minutes: 70, verified: 0, joined_days_ago: 190 },
  { username: "simba", display_name: "Simba Gora", bio: "Buyer and collector. Gaming gear and music equipment. Harare.", city: "Harare", rating_avg: 4.9, rating_count: 57, sales: 61, response_minutes: 30, verified: 0, joined_days_ago: 150 },
  { username: "anesu", display_name: "Anesu Tichafa", bio: "African art and sculpture dealer. Vic Falls gallery. Shipping crated and insured.", city: "Victoria Falls", rating_avg: 4.9, rating_count: 74, sales: 98, response_minutes: 45, verified: 1, joined_days_ago: 210 },
  { username: "mukudzei", display_name: "Mukudzei Hove", bio: "Photography gear. Bodies, glass and lighting. Trades welcome.", city: "Harare", rating_avg: 4.7, rating_count: 61, sales: 73, response_minutes: 38, verified: 0, joined_days_ago: 170 },
  { username: "shamiso", display_name: "Shamiso Banda", bio: "Books, media and backpacks. Bibliophile shipping nationwide.", city: "Harare", rating_avg: 4.8, rating_count: 44, sales: 52, response_minutes: 60, verified: 0, joined_days_ago: 120 },
  { username: "panashe", display_name: "Panashe Zvobgo", bio: "Enthusiast buyer. Solar tinkerer.", city: "Harare", rating_avg: 4.6, rating_count: 12, sales: 14, response_minutes: 120, verified: 0, joined_days_ago: 60 },
  { username: "ruvarashe", display_name: "Ruvarashe Mlilo", bio: "Bargain hunter from Byo. Collects vintage kitchenware.", city: "Bulawayo", rating_avg: 4.7, rating_count: 21, sales: 19, response_minutes: 100, verified: 0, joined_days_ago: 80 },
];

interface SeedAuctionIn {
  id: number;
  seller: string;
  title: string;
  category: string;
  condition: string;
  start_price: number;
  current_price: number;
  buy_now?: number;
  reserve?: number;
  bid_count: number;
  shipping_fee: number;
  shipping: string;
  city: string;
  ends_in_min: number;
  started_days_ago: number;
  featured?: number;
  imgKey: string;
  description: string;
  views: number;
  watches: number;
  status?: string;
}

const A: SeedAuctionIn[] = [
  // ── Phones ─────────────────────────────────────────────────────
  { id: 1001, seller: "nyasha", title: "Apple iPhone 13 128GB Midnight — Unlocked, Battery 89%", category: "phones", condition: "used", start_price: 180, current_price: 251, buy_now: 420, bid_count: 12, shipping_fee: 5, shipping: "courier", city: "Bulawayo", ends_in_min: 34, started_days_ago: 5, featured: 1, imgKey: "iphone", views: 1840, watches: 46, description: "Genuine iPhone 13 in Midnight. 89% battery health, unlocked for all networks. Screen has had a tempered protector since day one — no scratches underneath. Includes box, cable and a genuine Apple silicone case. Face ID perfect, True Tone intact. Bench-tested 48 hours: all cameras, mics, speakers and 5G verified." },
  { id: 1002, seller: "nyasha", title: "Samsung Galaxy S23 256GB Phantom Black — Dual SIM", category: "phones", condition: "used", start_price: 250, current_price: 445, buy_now: 650, bid_count: 15, shipping_fee: 5, shipping: "courier", city: "Bulawayo", ends_in_min: 190, started_days_ago: 4, imgKey: "galaxy", views: 2210, watches: 61, description: "Galaxy S23 Snapdragon variant. 256GB storage, 8GB RAM. Battery health excellent (92%). Comes with original box, 25W charger and two unused screen protectors. Snapped one pic of the screen showing settings for sceptics. Network tested on Econet, NetOne and TelOne." },
  { id: 1003, seller: "takudzwa", title: "iPhone 14 Pro Max 256GB Deep Purple — 275 Cycles", category: "phones", condition: "used", start_price: 300, current_price: 720, bid_count: 21, shipping_fee: 8, shipping: "courier", city: "Harare", ends_in_min: 410, started_days_ago: 6, featured: 1, imgKey: "iphone", views: 3350, watches: 98, description: "Flagship with Dynamic Island and Always-On display. 256GB, battery at 275 cycles (86% health). Unlocked. Includes box and braided USB-C cable. Small scuff on titanium frame (photo 2) — screen flawless. Trade-in of your old iPhone considered, mention in Q&A." },
  { id: 1004, seller: "nyasha", title: "Tecno Camon 30 Pro 5G 512GB — 3 Months Old", category: "phones", condition: "like-new", start_price: 90, current_price: 145, buy_now: 210, bid_count: 6, shipping_fee: 4, shipping: "courier", city: "Bulawayo", ends_in_min: 1450, started_days_ago: 2, imgKey: "galaxy", views: 640, watches: 18, description: "Barely 3 months old, 512GB storage, 70W charging. Complete box, screen guard applied, TPU case included. Reason for sale: upgraded to iPhone for iMessage work reasons. Receipt available from official Tecno store." },
  { id: 1005, seller: "takudzwa", title: "iPhone 11 64GB — Fair, Battery 74%", category: "phones", condition: "fair", start_price: 80, current_price: 122, bid_count: 7, shipping_fee: 5, shipping: "courier", city: "Harare", ends_in_min: 95, started_days_ago: 3, imgKey: "iphone", views: 810, watches: 22, description: "Honest listing: battery at 74% (will need service eventually), light scratches on back glass, screen clean with minor micro-scratches visible at angle. Everything works — Face ID, both cameras, WiFi, all buttons. Sold as-is, priced accordingly. Great first iPhone." },
  { id: 1006, seller: "nyasha", title: "Samsung Galaxy A15 128GB Brand Sealed", category: "phones", condition: "new", start_price: 45, current_price: 68, buy_now: 99, bid_count: 4, shipping_fee: 4, shipping: "courier", city: "Bulawayo", ends_in_min: 2880, started_days_ago: 1, imgKey: "galaxy", views: 425, watches: 11, description: "Factory sealed, never opened. 6.5\" AMOLED, 5000mAh, 25W charging. Perfect backup or gift phone. One-year warranty from Samsung Zimbabwe. Buy-now includes a free clear case." },

  // ── Electronics ────────────────────────────────────────────────
  { id: 1007, seller: "takudzwa", title: "PlayStation 5 Slim Disc + 2 DualSense + FC25", category: "electronics", condition: "used", start_price: 200, current_price: 344, buy_now: 480, bid_count: 11, shipping_fee: 10, shipping: "courier", city: "Harare", ends_in_min: 55, started_days_ago: 4, featured: 1, imgKey: "ps5", views: 2960, watches: 84, description: "PS5 Slim disc edition, 1TB, bought December. Includes FC25 disc, Astro's Playroom, and TWO DualSense controllers (one barely used). Runs whisper quiet, HDMI 2.1 cable included. Receipt and remaining warranty transfer to buyer. Harare pickup in Avondale welcome." },
  { id: 1008, seller: "simba", title: "Nintendo Switch OLED Zelda Edition + 4 Games", category: "electronics", condition: "used", start_price: 150, current_price: 232, bid_count: 9, shipping_fee: 8, shipping: "courier", city: "Harare", ends_in_min: 220, started_days_ago: 5, imgKey: "switch", views: 1490, watches: 38, description: "Limited edition Zelda OLED Switch. Joy-cons drift-free (tested). Included: Zelda TOTK, Mario Kart 8, Smash Ultimate, Metroid Dread (cartridges). Screen protector on since new, includes dock, grip and carrying case." },
  { id: 1009, seller: "takudzwa", title: "JBL PartyBox 310 — 240W Bluetooth Party Speaker", category: "electronics", condition: "used", start_price: 120, current_price: 195, bid_count: 8, shipping_fee: 12, shipping: "courier", city: "Harare", ends_in_min: 330, started_days_ago: 3, imgKey: "speaker", views: 980, watches: 27, description: "The one that wakes the neighbours. 240W, light show, 18-hour battery. Used for one wedding season, fully functional. Comes with original cover and charging cable. PartyBoost pairable." },
  { id: 1010, seller: "nyasha", title: "Soundcore Liberty 4 NC Earbuds — Active Noise Cancelling", category: "electronics", condition: "like-new", start_price: 20, current_price: 34, bid_count: 5, shipping_fee: 3, shipping: "courier", city: "Bulawayo", ends_in_min: 85, started_days_ago: 2, imgKey: "earbuds", views: 415, watches: 9, description: "LDAC hi-res audio, adaptive ANC, wireless charging case. Complete with all ear tips and original box. Only selling because I got gifted the Pro version." },
  { id: 1011, seller: "mukudzei", title: "Canon EOS 90D + 18-135mm USM — 14k Shutter Count", category: "electronics", condition: "used", start_price: 400, current_price: 745, buy_now: 950, bid_count: 12, shipping_fee: 15, shipping: "courier", city: "Harare", ends_in_min: 840, started_days_ago: 6, featured: 1, imgKey: "camera", views: 2140, watches: 52, description: "Workhorse 32.5MP APS-C DSLR. Shutter count 14,270 (rated 150k). Includes EF-S 18-135mm f/3.5-5.6 IS USM, two genuine Canon batteries, 64GB SanDisk Extreme, and a Lowepro shoulder bag. Sensor cleaned last month. Sharp photos in listing taken with this exact body." },
  { id: 1012, seller: "mukudzei", title: "Nikon FM2 35mm Film Camera + 50mm f/1.8 — Collector Grade", category: "electronics", condition: "used", start_price: 150, current_price: 264, bid_count: 9, shipping_fee: 10, shipping: "courier", city: "Harare", ends_in_min: 1885, started_days_ago: 5, imgKey: "filmcamera", views: 1130, watches: 31, description: "The legendary FM2 — titanium shutter, works without batteries at all speeds. Cosmetics 9/10, meter accurate, film advance smooth. Nikkor 50mm f/1.8 AI lens is clear, no fungus, no oil on blades. A joy for film shooters and collectors alike." },
  { id: 1013, seller: "chipo", title: "Samsung 55\" Crystal UHD 4K Smart TV (2023)", category: "electronics", condition: "used", start_price: 250, current_price: 388, buy_now: 520, bid_count: 10, shipping_fee: 20, shipping: "courier", city: "Bulawayo", ends_in_min: 260, started_days_ago: 4, imgKey: "tv", views: 1720, watches: 44, description: "55-inch Crystal UHD with Tizen smart hub. Netflix, YouTube and Showmax all logged in smoothly on our fibre. Wall-mountable (bracket included at buy-now). No dead pixels, no backlight bleed. Original remote and box." },
  { id: 1014, seller: "simba", title: "Numark Party Mix II DJ Controller + Stand", category: "electronics", condition: "used", start_price: 90, current_price: 152, bid_count: 6, shipping_fee: 10, shipping: "courier", city: "Harare", ends_in_min: 2000, started_days_ago: 3, imgKey: "dj", views: 530, watches: 14, description: "Two-channel DJ controller with built-in light show and speakers monitor. Serato DJ Lite included. Crossfader smooth, jog wheels responsive. Perfect starter rig — I upgraded to FLX6. Includes laptop stand." },

  // ── Computers ──────────────────────────────────────────────────
  { id: 1015, seller: "tendai", title: "MacBook Air M2 8GB/256GB Midnight — 38 Cycles", category: "computers", condition: "used", start_price: 350, current_price: 690, buy_now: 950, bid_count: 14, shipping_fee: 10, shipping: "courier", city: "Harare", ends_in_min: 120, started_days_ago: 5, featured: 1, imgKey: "macbook", views: 3820, watches: 112, description: "MacBook Air M2, 8GB unified memory, 256GB SSD. Battery: 38 cycles, 96% health. Midnight colour shows usual micro-marks but no dents. macOS Sequoia, includes original 30W charger and box. Perfect student or office machine — handles Xcode and Lightroom happily." },
  { id: 1016, seller: "tendai", title: "Dell Latitude 7420 i7-1185G7 16GB/512GB FHD", category: "computers", condition: "refurbished", start_price: 180, current_price: 320, bid_count: 9, shipping_fee: 8, shipping: "courier", city: "Harare", ends_in_min: 175, started_days_ago: 3, imgKey: "laptop", views: 1240, watches: 33, description: "Corporate lease return, professionally refurbished: brand new 512GB NVMe SSD, fresh Windows 11 Pro, new thermal paste, sanitized keyboard. i7 11th gen, 16GB RAM, fingerprint reader, backlit keyboard. 90-day warranty from us." },
  { id: 1017, seller: "tendai", title: "HP EliteBook 840 G7 i5 16GB — Business Grade", category: "computers", condition: "refurbished", start_price: 150, current_price: 254, bid_count: 7, shipping_fee: 8, shipping: "courier", city: "Harare", ends_in_min: 420, started_days_ago: 2, imgKey: "laptop", views: 890, watches: 21, description: "EliteBook 840 G7, i5-10310U, 16GB, new 256GB NVMe. Magnesium-alloy body, spill-resistant keyboard. Windows 11 Pro activated. Ideal office laptop with webcam privacy shutter. Our refurb includes full diagnostic report in box." },
  { id: 1018, seller: "tendai", title: "Lenovo ThinkPad T14 Gen2 Ryzen 7 16GB", category: "computers", condition: "refurbished", start_price: 130, current_price: 198, bid_count: 5, shipping_fee: 8, shipping: "courier", city: "Harare", ends_in_min: 1500, started_days_ago: 2, imgKey: "laptop", views: 640, watches: 15, description: "ThinkPad T14 Gen 2, Ryzen 7 Pro 5850U (8 cores), 16GB RAM, new 512GB SSD. The keyboard everyone raves about. Linux-friendly — happy to pre-install Ubuntu if the winner prefers." },
  { id: 1019, seller: "mukudzei", title: "Custom Gaming PC — RTX 3060 / Ryzen 5 5600 / 16GB", category: "computers", condition: "used", start_price: 400, current_price: 722, bid_count: 11, shipping_fee: 25, shipping: "courier", city: "Harare", ends_in_min: 720, started_days_ago: 6, imgKey: "macbook", views: 1980, watches: 47, description: "Hand-built gaming rig: RTX 3060 12GB, Ryzen 5 5600, 16GB DDR4 3600, 1TB NVMe + 2TB HDD, 600W Bronze. Runs Cyberpunk 2077 at 1080p ultra 75fps. Tempered glass case with 6 ARGB fans. Cables managed properly (photo 2). Stressed tested 6 hours Prime95 + FurMark — rock stable." },

  // ── Solar & Power ──────────────────────────────────────────────
  { id: 1020, seller: "rufaro", title: "5kVA Hybrid Inverter + 2× 100Ah LiFePO4 — Complete Kit", category: "solar-power", condition: "new", start_price: 600, current_price: 980, buy_now: 1450, bid_count: 13, shipping_fee: 40, shipping: "national", city: "Harare", ends_in_min: 65, started_days_ago: 5, featured: 1, imgKey: "inverter", views: 4120, watches: 128, description: "Brand new, sealed: 5kVA 48V hybrid inverter (parallel-ready, WiFi monitoring), 2× 100Ah 51.2V LiFePO4 batteries (6000 cycles, 10-year design life), and disconnects. Prewired kit — your electrician connects in under 2 hours. Load-shedding proof: runs fridge, TV, lights, WiFi and a borehole pump simultaneously. Installation available countrywide (quoted separately). COC certificate included on installs we do." },
  { id: 1021, seller: "rufaro", title: "550W Monocrystalline Solar Panels — Bundle of 4", category: "solar-power", condition: "new", start_price: 200, current_price: 371, bid_count: 9, shipping_fee: 30, shipping: "national", city: "Harare", ends_in_min: 300, started_days_ago: 4, imgKey: "solar", views: 2640, watches: 73, description: "Four × 550W A-grade mono panels, 25-year performance warranty, IP68 junction box. That's 2.2kW of harvesting power. Rails and clamps available at extra cost. Delivery countrywide via our courier partners or collect from Msasa." },
  { id: 1022, seller: "rufaro", title: "Complete 3kVA Solar Kit — Inverter, Panel, Battery", category: "solar-power", condition: "new", start_price: 300, current_price: 512, buy_now: 780, bid_count: 8, shipping_fee: 35, shipping: "national", city: "Harare", ends_in_min: 1080, started_days_ago: 3, imgKey: "inverter", views: 3100, watches: 86, description: "Starter kit for a small home: 3kVA 24V inverter with 60A MPPT, 6× 335W panels, and 100Ah lithium battery. Powers lights, TV, decoder, WiFi, phone charging through 10 hours of ZESA off-time. Kit ships pre-configured — labelled plugs, no guesswork. Diagram included." },
  { id: 1023, seller: "chipo", title: "150L Solar Geyser — Direct System, New", category: "solar-power", condition: "new", start_price: 150, current_price: 236, bid_count: 5, shipping_fee: 25, shipping: "national", city: "Bulawayo", ends_in_min: 2600, started_days_ago: 3, imgKey: "solar", views: 820, watches: 19, description: "150-litre direct solar water heater with evacuated tubes, frame and complete installation kit. SABS-tested. A family of four never buys electricity for hot water again. Installation referrals available for Byo and Harare." },
  { id: 1024, seller: "rufaro", title: "51.2V 100Ah LiFePO4 Server Rack Battery — BMS + Screen", category: "solar-power", condition: "new", start_price: 400, current_price: 655, bid_count: 7, shipping_fee: 20, shipping: "national", city: "Harare", ends_in_min: 460, started_days_ago: 2, imgKey: "inverter", views: 1870, watches: 48, description: "5.12kWh rack battery with smart BMS, CAN/RS485 comms and LCD status screen. Compatible with Deye, Sunsynk, Voltronic and Growatt inverters. 6000+ cycles. Drop-in expansion for existing systems. Rack mount ears included." },
  { id: 1025, seller: "farai", title: "6.5kVA Silent Diesel Generator — Electric Start", category: "solar-power", condition: "new", start_price: 500, current_price: 812, buy_now: 1100, bid_count: 10, shipping_fee: 50, shipping: "national", city: "Masvingo", ends_in_min: 950, started_days_ago: 4, imgKey: "generator", views: 2260, watches: 59, description: "Key-start silent-type 6.5kVA diesel genset, 15L tank for 11-hour runs at 50% load. AVR stabilised output, circuit breakers, wheels and handles. Runs your house essentials or a small workshop without fuss. We deliver countrywide — fuel it and it works." },
  { id: 1026, seller: "rufaro", title: "Starlink Standard Kit (Gen 2) — Activated Region", category: "solar-power", condition: "used", start_price: 250, current_price: 433, buy_now: 520, bid_count: 15, shipping_fee: 15, shipping: "courier", city: "Harare", ends_in_min: 28, started_days_ago: 3, featured: 1, imgKey: "starlink", views: 5340, watches: 167, description: "Gen 2 standard kit: dish, router, cables and mount. Used 8 months — dish perfect, cable perfect, performance verified this morning (150Mbps+ at my place in Borrowdale). Service transfers to your account in minutes on the app. Why sell? Upgraded to the Mini for travels. The answer to rural connectivity and backup internet." },

  // ── Home & Appliances ──────────────────────────────────────────
  { id: 1027, seller: "chipo", title: "Hisense 350L Chest Freezer — 2 Years Warranty Left", category: "home", condition: "used", start_price: 200, current_price: 344, buy_now: 480, bid_count: 8, shipping_fee: 20, shipping: "national", city: "Bulawayo", ends_in_min: 380, started_days_ago: 4, imgKey: "freezer", views: 1310, watches: 34, description: "350L chest freezer, 18 months old, warranty transfers (2 years left at Hisense Zimbabwe). Perfect for the frozen vegetables side-hustle or big family. Cools to -24°C fast. Includes two baskets. Minor scratch on lid (photo), works flawlessly." },
  { id: 1028, seller: "chipo", title: "DeLonghi Dedica Espresso Machine + Grinder", category: "home", condition: "used", start_price: 80, current_price: 139, bid_count: 6, shipping_fee: 12, shipping: "courier", city: "Bulawayo", ends_in_min: 540, started_days_ago: 3, imgKey: "espresso", views: 720, watches: 17, description: "Pump espresso machine (15 bar) with milk steamer, plus a conical burr grinder. Pulls proper café shots. Descaled monthly. Including a 250g bag of medium-roast Zimbabwe single origin to get you started. Selling: office upgraded to a bigger machine." },
  { id: 1029, seller: "shamiso", title: "Ergonomic Mesh Office Chair — Lumbar Support", category: "home", condition: "used", start_price: 50, current_price: 84, bid_count: 4, shipping_fee: 10, shipping: "courier", city: "Harare", ends_in_min: 1750, started_days_ago: 2, imgKey: "chair", views: 460, watches: 12, description: "Breathable mesh back, adjustable lumbar, 4D armrests, reclines to 135°. Wheels smooth on tiles and carpet. One year old, from a smoke-free home office. Your spine will thank you during load-shedding work-from-home days." },
  { id: 1030, seller: "ruvarashe", title: "Vintage Singer Treadle Sewing Machine — 1930s Working", category: "home", condition: "used", start_price: 60, current_price: 105, bid_count: 7, shipping_fee: 0, shipping: "pickup", city: "Bulawayo", ends_in_min: 2200, started_days_ago: 5, imgKey: "sewing", views: 590, watches: 16, description: "Beautiful 1930s Singer treadle in original cabinet, restored and sewing perfectly — no electricity needed (take that, load shedding). New leather drive belt, oiled mechanism, spare needles included. Cabinet has character marks as expected for age. Collector or practical use. Pickup only — it is heavy." },

  // ── Fashion ────────────────────────────────────────────────────
  { id: 1031, seller: "blessing", title: "Nike Air Jordan 1 Mid — UK9, Authenticated", category: "fashion", condition: "used", start_price: 60, current_price: 118, bid_count: 9, shipping_fee: 6, shipping: "courier", city: "Mutare", ends_in_min: 100, started_days_ago: 4, imgKey: "jordan", views: 1460, watches: 41, description: "Genuine AJ1 Mid, worn a handful of times, UK9. Legit-checked by two sneaker groups and happy to do a live video verification call before you bid. Original box, extra laces. Light creasing on toe box (photo 3). Triple money back if ever flagged fake." },
  { id: 1032, seller: "blessing", title: "Michael Kors Hamilton Leather Tote — Authentic", category: "fashion", condition: "used", start_price: 70, current_price: 112, bid_count: 6, shipping_fee: 6, shipping: "courier", city: "Mutare", ends_in_min: 290, started_days_ago: 3, imgKey: "handbag", views: 780, watches: 23, description: "Genuine MK Hamilton tote in saffiano leather with gold hardware. Serial number and creed card intact, dust bag included. Corners show gentle wear, interior spotless. Authenticated via CheckCheck — certificate transfers to winner." },
  { id: 1033, seller: "blessing", title: "Seiko 5 Sports Automatic — SRPD77 'Bottlecap'", category: "fashion", condition: "used", start_price: 90, current_price: 174, bid_count: 8, shipping_fee: 5, shipping: "courier", city: "Mutare", ends_in_min: 640, started_days_ago: 5, featured: 1, imgKey: "watch", views: 1050, watches: 29, description: "Seiko 5 Sports SRPD77 with the beautiful graduated blue dial. 4R36 movement hacking and hand-winding, running at +8s/day on wrist. Comes on the original 5-link bracelet with all links, plus a spare navy NATO strap. Box and papers included. Honest wrist shots available on request." },
  { id: 1034, seller: "blessing", title: "Wedding Dress — Size 10, Ivory Lace, Dry-Cleaned", category: "fashion", condition: "used", start_price: 100, current_price: 165, bid_count: 5, shipping_fee: 10, shipping: "national", city: "Mutare", ends_in_min: 2880, started_days_ago: 2, imgKey: "dress", views: 640, watches: 18, description: "One worn, one owner: elegant ivory A-line with lace bodice and button back. Professional dry-cleaned and boxed with acid-free tissue. Size 10 (fits 8-12 with lace-up adjust). Veil included. Made a bride very happy — will make another one too." },

  // ── Vehicles ───────────────────────────────────────────────────
  { id: 1035, seller: "kudzai", title: "Toyota Hilux 2.8 GD-6 2019 — 78,000km, 4×4", category: "vehicles", condition: "used", start_price: 18000, current_price: 24500, reserve: 26000, bid_count: 17, shipping_fee: 0, shipping: "pickup", city: "Gweru", ends_in_min: 1440, started_days_ago: 7, featured: 1, imgKey: "hilux", views: 8900, watches: 210, description: "2019 Hilux 2.8 GD-6 Legend 4×4 double cab. Full Toyota service history, books complete. 78,000 genuine km. New tyres all round (December), canopy included, tow bar, reverse camera, Bluetooth. Accident-free — AA inspection welcome at buyer's cost. Reserve set realistically; serious bidders only. Finance questions welcome in Q&A." },
  { id: 1036, seller: "kudzai", title: "Toyota Corolla Quest 2017 — 96,000km, Clean", category: "vehicles", condition: "used", start_price: 6500, current_price: 8200, bid_count: 12, shipping_fee: 0, shipping: "pickup", city: "Gweru", ends_in_min: 2100, started_days_ago: 6, imgKey: "corolla", views: 4260, watches: 87, description: "Corolla Quest 1.6, 96,000km with service records. Aircon ice-cold, economical 6.2L/100km — the perfect commuter for fuel prices we live with. Interior mint, body straight, small touch-up on rear bumper documented in photos. Licence up to date, papers ready for change of ownership same-day." },
  { id: 1037, seller: "simba", title: "26\" Aluminium Mountain Bike — 21 Speed Disc", category: "vehicles", condition: "used", start_price: 40, current_price: 78, bid_count: 9, shipping_fee: 15, shipping: "national", city: "Harare", ends_in_min: 160, started_days_ago: 3, imgKey: "bike", views: 670, watches: 19, description: "Alloy frame MTB, 21-speed Shimano gears, front suspension (working), mechanical disc brakes front and rear. Recently tuned: new chain, new brake pads, wheels trued. Rides great on Borrowdale trails. Helmet available as buy-now bonus." },

  // ── Sports & Hobbies ───────────────────────────────────────────
  { id: 1038, seller: "simba", title: "Electric Guitar Sunburst + Amp + Strap Bundle", category: "sports", condition: "used", start_price: 120, current_price: 198, bid_count: 7, shipping_fee: 15, shipping: "national", city: "Harare", ends_in_min: 350, started_days_ago: 4, imgKey: "guitar", views: 690, watches: 21, description: "Sunburst solid-body electric with dual humbuckers, bolt-on maple neck — plays clean, no fret buzz. Bundle: 15W practice amp (with overdrive), strap, cable, picks, and gig bag. Great beginner-to-intermediate setup that stays in tune." },
  { id: 1039, seller: "simba", title: "Yamaha PSR-E373 Keyboard — 61 Keys, Touch Sensitive", category: "sports", condition: "used", start_price: 90, current_price: 146, bid_count: 5, shipping_fee: 15, shipping: "national", city: "Harare", ends_in_min: 2400, started_days_ago: 3, imgKey: "keyboard", views: 480, watches: 13, description: "61 touch-sensitive keys, 622 voices, 205 styles, and lessons built in. Perfect church or learning keyboard. Includes power adapter, sustain pedal and music stand. Headphone jack for silent practice during study time." },
  { id: 1040, seller: "takudzwa", title: "4K Camera Drone — 3-Axis Gimbal, 2 Batteries", category: "sports", condition: "used", start_price: 100, current_price: 176, bid_count: 8, shipping_fee: 12, shipping: "courier", city: "Harare", ends_in_min: 1300, started_days_ago: 5, imgKey: "drone", views: 940, watches: 26, description: "Compact folding drone with real 4K/30 camera on 3-axis gimbal, GPS return-to-home, 28-min flights per battery. Two batteries, controller, spare props and case. Flown responsibly, no crashes — flight logs screenshot in photos. Vic Falls and Matobo footage taken with it." },

  // ── Art & Collectibles ─────────────────────────────────────────
  { id: 1041, seller: "tatenda", title: "Zimbabwe 100 Trillion Dollar Banknote (2008) — Framed", category: "collectibles", condition: "used", start_price: 50, current_price: 142, bid_count: 11, shipping_fee: 8, shipping: "courier", city: "Harare", ends_in_min: 45, started_days_ago: 5, featured: 1, imgKey: "trillion", views: 3610, watches: 104, description: "The iconic 100 trillion — the highest denomination ever printed. Series AA, crisp UNC condition, professionally framed in double glass with black mount and the story of 2008 hyperinflation printed beneath. A conversation piece no visitor forgets. Serial number photographed for the record. COA included." },
  { id: 1042, seller: "anesu", title: "Shona Springstone Sculpture — 'Mother & Child'", category: "collectibles", condition: "used", start_price: 120, current_price: 240, bid_count: 9, shipping_fee: 45, shipping: "national", city: "Victoria Falls", ends_in_min: 1150, started_days_ago: 6, imgKey: "sculpture", views: 1540, watches: 38, description: "Genuine Shona sculpture in black springstone, carved in Tengenenge style. 'Mother & Child', approx 45cm tall, 18kg. Purchased directly from the artist's village in 2019 with provenance card. Signed base. Professional crated shipping via our art courier — insurance included." },
  { id: 1043, seller: "tatenda", title: "Rhodesia-Era Postage Stamp Collection — 214 Stamps", category: "collectibles", condition: "used", start_price: 30, current_price: 68, bid_count: 6, shipping_fee: 5, shipping: "courier", city: "Harare", ends_in_min: 2750, started_days_ago: 3, imgKey: "stamps", views: 520, watches: 14, description: "214 stamps, Rhodesia and Federation era, mounted in a period album. Includes the 1965 UDI set and 1953 Federation definitives. Mostly fine-used with several mint. A time capsule of our history — starting at less than 15c a stamp." },
  { id: 1044, seller: "anesu", title: "Contemporary Zimbabwean Painting — 'Harare Dusk' 90×60", category: "collectibles", condition: "new", start_price: 80, current_price: 152, bid_count: 7, shipping_fee: 25, shipping: "national", city: "Victoria Falls", ends_in_min: 1900, started_days_ago: 4, imgKey: "art", views: 880, watches: 24, description: "Original acrylic on canvas, 90×60cm, by an emerging Harare artist we represent. 'Harare Dusk' — the CBD skyline burning orange behind jacaranda purple. Stretched, varnished, ready to hang with certificate of authenticity signed by the artist." },

  // ── Farm & Industrial ──────────────────────────────────────────
  { id: 1045, seller: "farai", title: "2-Row Maize Planter — Tractor Mounted", category: "farm-industrial", condition: "used", start_price: 350, current_price: 512, bid_count: 6, shipping_fee: 60, shipping: "national", city: "Masvingo", ends_in_min: 1500, started_days_ago: 5, imgKey: "tractor", views: 1140, watches: 29, description: "Two-row seed planter, adjustable spacing for maize, soya and wheat. Tractor 3-point linkage. This season's planting done and dusted with it — consistent depth, no skips. Discs and seed plates good for seasons to come. Cooperative bulk orders: message me." },
  { id: 1046, seller: "farai", title: "3HP Borehole Pump + Control Box — 100m Head", category: "farm-industrial", condition: "new", start_price: 180, current_price: 298, buy_now: 400, bid_count: 7, shipping_fee: 30, shipping: "national", city: "Masvingo", ends_in_min: 700, started_days_ago: 3, imgKey: "pump", views: 1390, watches: 35, description: "Stainless 3HP submersible borehole pump rated to 100m head, with control box (dry-run protection), 30m cable and non-return valve. Suits household or small-plot boreholes. Sizing advice free — send your borehole depth and yield. Dispatch within 24h of cleared payment." },
  { id: 1047, seller: "takudzwa", title: "Cordless Drill + 68-Piece Accessory Kit", category: "farm-industrial", condition: "used", start_price: 35, current_price: 66, bid_count: 8, shipping_fee: 8, shipping: "courier", city: "Harare", ends_in_min: 240, started_days_ago: 2, imgKey: "drill", views: 830, watches: 21, description: "18V brushless cordless drill with 2 batteries, fast charger, and a 68-piece kit: bits, drivers, sockets, spade bits, hole saws — the full DIY church. Chuck runs true, brakes crisp. Case has scuffs; tools have years of life left." },

  // ── Books & Media ──────────────────────────────────────────────
  { id: 1048, seller: "shamiso", title: "Zimbabwe History Book Lot — 9 Volumes", category: "books-media", condition: "used", start_price: 15, current_price: 33, bid_count: 5, shipping_fee: 8, shipping: "courier", city: "Harare", ends_in_min: 60, started_days_ago: 4, imgKey: "backpack", views: 340, watches: 9, description: "Nine volumes on our history: Terence Ranger's 'Revolt in Southern Rhodesia', Ian Smith's 'The Great Betrayal', two Shona poetry anthologies, and more. All read once, no annotations. Weighing 3.2kg — courier quoted accordingly. Start your Zimbabwe library cheap." },
];

// ── ended / sold auctions for order + rating flows ─────────────────
const ENDED_AUCTIONS: SeedAuctionIn[] = [
  { id: 2001, seller: "rufaro", title: "1kVA Portable Power Station — Sold Auction", category: "solar-power", condition: "new", start_price: 120, current_price: 208, bid_count: 9, shipping_fee: 15, shipping: "courier", city: "Harare", ends_in_min: -2880, started_days_ago: 8, imgKey: "inverter", views: 990, watches: 25, description: "1kVA portable power station with 500Wh LiFePO4, AC/DC/USB outputs. Completed auction.", status: "sold" },
  { id: 2002, seller: "tendai", title: "Logitech MX Master 3S — Completed", category: "computers", condition: "used", start_price: 40, current_price: 72, bid_count: 6, shipping_fee: 5, shipping: "courier", city: "Harare", ends_in_min: -1440, started_days_ago: 6, imgKey: "laptop", views: 410, watches: 11, description: "MX Master 3S in graphite. Completed auction.", status: "sold" },
  { id: 2003, seller: "tatenda", title: "1965 UDI Penny Set — Completed", category: "collectibles", condition: "used", start_price: 20, current_price: 47, bid_count: 5, shipping_fee: 4, shipping: "courier", city: "Harare", ends_in_min: -700, started_days_ago: 5, imgKey: "stamps", views: 260, watches: 7, description: "Completed auction.", status: "sold" },
  { id: 2004, seller: "kudzai", title: "Roof Bars + Canopy Clips Hilux — Ended Unsold", category: "vehicles", condition: "used", start_price: 150, current_price: 150, reserve: 220, bid_count: 0, shipping_fee: 10, shipping: "courier", city: "Gweru", ends_in_min: -300, started_days_ago: 5, imgKey: "hilux", views: 180, watches: 4, description: "Ended without meeting reserve.", status: "ended" },
];

interface SeedQuestionIn {
  auction: number;
  asker: string;
  body: string;
  answer?: string;
  answered_min_ago?: number;
  asked_min_ago: number;
}

const Q: SeedQuestionIn[] = [
  { auction: 1001, asker: "panashe", body: "Does it come with the original box? And is the battery still above 85%?", answer: "Yes, box included and battery health is 89% — screenshot of settings in photo 4. Thanks!", answered_min_ago: 200, asked_min_ago: 260 },
  { auction: 1020, asker: "ruvarashe", body: "Do you install in Bulawayo? And can this run a fridge through the night?", answer: "We install countrywide — Bulawayo included (call-out quoted at cost). Yes: fridge + TV + lights + WiFi comfortably overnight on this kit. Add a second battery if you also want the borehole pump.", answered_min_ago: 90, asked_min_ago: 120 },
  { auction: 1026, asker: "mukudzei", body: "Hi — is the kit still under the hardware warranty? And why 8 months only?", answer: "Dish warranty is 12 months from activation (so 4 months left, transfers with the account). Selling because I travel more now and moved to the Mini.", answered_min_ago: 45, asked_min_ago: 70 },
  { auction: 1035, asker: "panashe", body: "Any accident history? Can I send my mechanic to inspect in Gweru?", answer: "Zero accidents — books and history complete. Your mechanic is very welcome, inspections by appointment, call the number on my profile. Happy bidding!", answered_min_ago: 500, asked_min_ago: 600 },
  { auction: 1031, asker: "chipo", body: "Can you do a live video call to verify authenticity before the auction ends?", answer: "Absolutely — message me to arrange, happy to do a Legit-Check call with the shoes on camera.", answered_min_ago: 30, asked_min_ago: 55 },
  { auction: 1015, asker: "ruvarashe", body: "Any dents or bent corners? Does it come with the charger?", answer: "No dents, corners straight (macro photos available on request). Original 30W charger and box included.", answered_min_ago: 150, asked_min_ago: 190 },
  { auction: 1007, asker: "shamiso", body: "Can I pick up in Avondale this weekend if I win?", answer: "Yes — pickup available Saturday morning, cash or pre-paid. Winning bid can also courier if you prefer.", answered_min_ago: 60, asked_min_ago: 80 },
  { auction: 1041, asker: "simba", body: "Is the serial number the AA prefix series? Great frame by the way.", asked_min_ago: 20 },
  { auction: 1033, asker: "anesu", body: "How is the accuracy? Do you timegraph it?", asked_min_ago: 90 },
  { auction: 1045, asker: "blessing", body: "Does it handle fertiliser placement as well or seed only?", asked_min_ago: 40 },
];

interface SeedThreadIn {
  id: number;
  auction: number | null;
  buyer: string;
  seller: string;
  subject: string;
  messages: { from: "buyer" | "seller"; body: string; min_ago: number }[];
}

const T: SeedThreadIn[] = [
  {
    id: 1,
    auction: 1020,
    buyer: "panashe",
    seller: "rufaro",
    subject: "5kVA kit — Bulawayo install",
    messages: [
      { from: "buyer", body: "Hi Rufaro, I'm keen on the 5kVA kit. What would installation in Bulawayo cost on top?", min_ago: 300 },
      { from: "seller", body: "Hi Panashe! Install in Byo is $120 including railings for a wall mount. Takes our team about 3 hours.", min_ago: 280 },
      { from: "buyer", body: "Perfect. And COC certificate?", min_ago: 275 },
      { from: "seller", body: "Included on all installs we do — insurance-ready. If you win, we book a date within 48h of payment.", min_ago: 260 },
      { from: "buyer", body: "Great, I'll bid tonight 🔆", min_ago: 250 },
    ],
  },
  {
    id: 2,
    auction: 1026,
    buyer: "mukudzei",
    seller: "rufaro",
    subject: "Starlink kit transfer",
    messages: [
      { from: "buyer", body: "Hello — winning this. How does the account transfer work exactly?", min_ago: 90 },
      { from: "seller", body: "Congrats! It's a kit transfer on the Starlink app — I enter your email, you accept, takes 5 minutes. We can do it at handover in Borrowdale.", min_ago: 80 },
      { from: "buyer", body: "Brilliant. I'll complete payment now — the 48h SLA is tight!", min_ago: 70 },
    ],
  },
  {
    id: 3,
    auction: 1015,
    buyer: "ruvarashe",
    seller: "tendai",
    subject: "MacBook Air — macro photos?",
    messages: [
      { from: "buyer", body: "Hi, could you send close-up photos of the corners and the battery cycle count screen?", min_ago: 200 },
      { from: "seller", body: "Sure — just posted them to the listing (photos 5-8). Cycle count is 38, 96% health.", min_ago: 190 },
      { from: "buyer", body: "Thank you, looks clean. Watching this one 👀", min_ago: 185 },
    ],
  },
  {
    id: 4,
    auction: 1035,
    buyer: "tatenda",
    seller: "kudzai",
    subject: "Hilux — finance options?",
    messages: [
      { from: "buyer", body: "Do you accept part payment then balance? I can do $15k now.", min_ago: 400 },
      { from: "seller", body: "Sorry, auction rules apply — full settlement within 48h of winning per Tengasell SLA. No part payments, protects both sides.", min_ago: 380 },
      { from: "buyer", body: "Understood, fair enough. My bank pre-approval is in process.", min_ago: 370 },
    ],
  },
];

// ── build ─────────────────────────────────────────────────────────

export interface SeedData {
  categories: Category[];
  profiles: Profile[];
  auctions: Auction[];
  bids: Bid[];
  watchlist: WatchItem[];
  questions: Question[];
  threads: Thread[];
  messages: Message[];
  orders: Order[];
  payments: Payment[];
  ratings: Rating[];
  notifications: Notification[];
}

export function buildSeed(): SeedData {
  const rnd = lcg(20261019);
  const now = Date.now();

  const profiles: Profile[] = SEED_PROFILES.map((p, i) => ({
    id: i + 1,
    user: `seed-user-${p.username}`, // replaced by real ids at SQL-gen / runtime
    username: p.username,
    display_name: p.display_name,
    bio: p.bio,
    city: p.city,
    rating_avg: p.rating_avg,
    rating_count: p.rating_count,
    sales: p.sales,
    response_minutes: p.response_minutes,
    verified: p.verified,
    joined_at: isoMinutesFromNow(-p.joined_days_ago * 1440),
  }));

  const allAuctionSeeds = [...A, ...ENDED_AUCTIONS];

  const auctions: Auction[] = allAuctionSeeds.map((a) => {
    const images = (IMAGES[a.imgKey] ?? []).slice(0, 3);
    const createdMin = -(a.started_days_ago * 1440) + 5;
    return {
      id: a.id,
      user: `seed-user-${a.seller}`,
      seller_username: a.seller,
      title: a.title,
      slug: slugify(a.title),
      description: a.description,
      category: a.category,
      condition: a.condition,
      start_price: a.start_price,
      current_price: a.current_price,
      buy_now_price: a.buy_now ?? null,
      reserve_price: a.reserve ?? null,
      bid_count: a.bid_count,
      watch_count: a.watches,
      views: a.views,
      shipping_fee: a.shipping_fee,
      shipping: a.shipping,
      city: a.city,
      ends_at: isoMinutesFromNow(a.ends_in_min),
      started_at: isoMinutesFromNow(createdMin),
      status: (a.status ?? "live") as Auction["status"],
      extension_count: 0,
      featured: a.featured ?? 0,
      images: JSON.stringify(images),
      created_at: isoMinutesFromNow(createdMin),
      updated_at: isoMinutesFromNow(createdMin + 60),
    };
  });

  // ── bids: plausible escalating history per live auction ────────
  const bids: Bid[] = [];
  let bidId = 1;
  for (const a of allAuctionSeeds) {
    if (a.bid_count <= 0) continue;
    const inc = bidIncrement(a.current_price);
    const winner = BUYER_POOL[Math.floor(rnd() * BUYER_POOL.length)];
    const span = a.current_price - a.start_price;
    const steps = Math.max(a.bid_count - 1, 1);
    let bidder = winner;
    let prevBidder = "";
    const auctionTotalMin = a.started_days_ago * 1440;
    for (let i = 0; i < a.bid_count; i++) {
      const t = i / steps;
      const amount =
        i === 0
          ? a.start_price
          : i === a.bid_count - 1
            ? a.current_price
            : round2(a.start_price + span * t * (0.75 + rnd() * 0.25));
      if (i < a.bid_count - 1 && rnd() < 0.45) {
        prevBidder = bidder;
        bidder = BUYER_POOL[Math.floor(rnd() * BUYER_POOL.length)];
        if (bidder === prevBidder) bidder = BUYER_POOL[(BUYER_POOL.indexOf(bidder) + 3) % BUYER_POOL.length];
      }
      const minutesAgo =
        i === a.bid_count - 1
          ? Math.max(2, a.ends_in_min > 0 ? Math.min(25, a.ends_in_min / 2) : 30)
          : Math.max(10, auctionTotalMin * (1 - i / a.bid_count));
      bids.push({
        id: bidId++,
        auction_id: a.id,
        user: `seed-user-${bidder}`,
        bidder_username: bidder,
        amount: round2(amount),
        max_amount: round2(i === a.bid_count - 1 ? a.current_price + inc : amount),
        is_auto: 1,
        status: i === a.bid_count - 1 ? "active" : "superseded",
        created_at: new Date(now - minutesAgo * 60_000).toISOString().replace(/\.\d+Z$/, "Z"),
      });
    }
  }

  // ── watchlist (demo buyer simba) ───────────────────────────────
  const watchIds = [1001, 1026, 1033, 1041, 1020];
  const watchlist: WatchItem[] = watchIds.map((auctionId, i) => ({
    id: i + 1,
    user: "seed-user-simba",
    auction_id: auctionId,
    created_at: isoMinutesFromNow(-(200 + i * 47)),
  }));

  // ── questions ──────────────────────────────────────────────────
  const questions: Question[] = Q.map((q, i) => ({
    id: i + 1,
    auction_id: q.auction,
    user: `seed-user-${q.asker}`,
    asker_username: q.asker,
    body: q.body,
    answer: q.answer ?? null,
    answered_at: q.answered_min_ago ? isoMinutesFromNow(-q.answered_min_ago) : null,
    created_at: isoMinutesFromNow(-q.asked_min_ago),
  }));

  // ── threads + messages ─────────────────────────────────────────
  const threads: Thread[] = T.map((t) => ({
    id: t.id,
    auction_id: t.auction,
    buyer_user: `seed-user-${t.buyer}`,
    seller_user: `seed-user-${t.seller}`,
    buyer_username: t.buyer,
    seller_username: t.seller,
    subject: t.subject,
    last_message_at: isoMinutesFromNow(-t.messages[t.messages.length - 1].min_ago),
    created_at: isoMinutesFromNow(-t.messages[0].min_ago - 10),
  }));

  const messages: Message[] = [];
  let msgId = 1;
  for (const t of T) {
    for (const m of t.messages) {
      const isBuyer = m.from === "buyer";
      messages.push({
        id: msgId++,
        thread_id: t.id,
        user: `seed-user-${isBuyer ? t.buyer : t.seller}`,
        sender_username: isBuyer ? t.buyer : t.seller,
        body: m.body,
        created_at: isoMinutesFromNow(-m.min_ago),
      });
    }
  }

  // ── orders ─────────────────────────────────────────────────────
  const orders: Order[] = [
    {
      id: 1,
      auction_id: 2001,
      auction_title: "1kVA Portable Power Station",
      buyer_user: "seed-user-simba",
      seller_user: "seed-user-rufaro",
      buyer_username: "simba",
      seller_username: "rufaro",
      final_price: 208,
      status: "completed",
      pay_by: isoMinutesFromNow(-2790),
      paid_at: isoMinutesFromNow(-2760),
      shipped_at: isoMinutesFromNow(-2400),
      delivered_at: isoMinutesFromNow(-2000),
      completed_at: isoMinutesFromNow(-1900),
      carrier: "SwiftExpress",
      tracking: "SW7841203ZW",
      created_at: isoMinutesFromNow(-2880),
      updated_at: isoMinutesFromNow(-1900),
    },
    {
      id: 2,
      auction_id: 2002,
      auction_title: "Logitech MX Master 3S",
      buyer_user: "seed-user-ruvarashe",
      seller_user: "seed-user-tendai",
      buyer_username: "ruvarashe",
      seller_username: "tendai",
      final_price: 72,
      status: "completed",
      pay_by: isoMinutesFromNow(-1350),
      paid_at: isoMinutesFromNow(-1320),
      shipped_at: isoMinutesFromNow(-1100),
      delivered_at: isoMinutesFromNow(-900),
      completed_at: isoMinutesFromNow(-800),
      carrier: "ZimPost",
      tracking: "RR123456789ZW",
      created_at: isoMinutesFromNow(-1440),
      updated_at: isoMinutesFromNow(-800),
    },
    {
      id: 3,
      auction_id: 2003,
      auction_title: "1965 UDI Penny Set",
      buyer_user: "seed-user-mukudzei",
      seller_user: "seed-user-tatenda",
      buyer_username: "mukudzei",
      seller_username: "tatenda",
      final_price: 47,
      status: "pending_payment",
      pay_by: isoMinutesFromNow(1800), // 30h SLA remaining
      paid_at: null,
      shipped_at: null,
      delivered_at: null,
      completed_at: null,
      carrier: null,
      tracking: null,
      created_at: isoMinutesFromNow(-120),
      updated_at: isoMinutesFromNow(-120),
    },
    {
      id: 4,
      auction_id: 2001,
      auction_title: "1kVA Portable Power Station",
      buyer_user: "seed-user-panashe",
      seller_user: "seed-user-rufaro",
      buyer_username: "panashe",
      seller_username: "rufaro",
      final_price: 195,
      status: "paid",
      pay_by: isoMinutesFromNow(-100),
      paid_at: isoMinutesFromNow(-95),
      shipped_at: null,
      delivered_at: null,
      completed_at: null,
      carrier: null,
      tracking: null,
      created_at: isoMinutesFromNow(-280),
      updated_at: isoMinutesFromNow(-95),
    },
  ];

  const payments: Payment[] = [
    { id: 1, order_id: 1, user: "seed-user-simba", method: "ecocash", amount: 208, status: "settled", reference: "EC-77201-4839", created_at: isoMinutesFromNow(-2760) },
    { id: 2, order_id: 2, user: "seed-user-ruvarashe", method: "zipit", amount: 72, status: "settled", reference: "ZB-9921-0083", created_at: isoMinutesFromNow(-1320) },
    { id: 3, order_id: 4, user: "seed-user-panashe", method: "visa", amount: 195, status: "settled", reference: "VS-4417-2200", created_at: isoMinutesFromNow(-95) },
  ];

  const ratings: Rating[] = [
    { id: 1, order_id: 1, user: "seed-user-simba", ratee_user: "seed-user-rufaro", ratee_username: "rufaro", direction: "as_buyer", score: 5, comment: "Rufaro is world-class. Delivered and installed next morning, COC included. Power stayed on through 12 hours of shedding — life-changing!", created_at: isoMinutesFromNow(-1880) },
    { id: 2, order_id: 1, user: "seed-user-rufaro", ratee_user: "seed-user-simba", ratee_username: "simba", direction: "as_seller", score: 5, comment: "Instant payment, smooth handover, pleasure to deal with.", created_at: isoMinutesFromNow(-1860) },
    { id: 3, order_id: 2, user: "seed-user-ruvarashe", ratee_user: "seed-user-tendai", ratee_username: "tendai", direction: "as_buyer", score: 4, comment: "Item exactly as described, packed beautifully. Courier took an extra day (not seller's fault). Would buy again.", created_at: isoMinutesFromNow(-780) },
    { id: 4, order_id: 2, user: "seed-user-tendai", ratee_user: "seed-user-ruvarashe", ratee_username: "ruvarashe", direction: "as_seller", score: 5, comment: "Paid within the hour. Recommended buyer.", created_at: isoMinutesFromNow(-770) },
  ];

  const notifications: Notification[] = [
    { id: 1, user: "seed-user-simba", type: "outbid", title: "You were outbid", body: "panashe placed a higher bid on iPhone 13 128GB Midnight.", link: "#/item/1001", read: 0, created_at: isoMinutesFromNow(-18) },
    { id: 2, user: "seed-user-simba", type: "message", title: "New message from rufaro", body: "Re: Starlink kit transfer", link: "#/messages/2", read: 0, created_at: isoMinutesFromNow(-80) },
    { id: 3, user: "seed-user-simba", type: "question", title: "Question on your item", body: "simba asked about the 100 Trillion banknote.", link: "#/item/1041", read: 0, created_at: isoMinutesFromNow(-20) },
    { id: 4, user: "seed-user-simba", type: "won", title: "You won — payment due", body: "1kVA Portable Power Station. Complete payment within 48h.", link: "#/orders/1", read: 1, created_at: isoMinutesFromNow(-2880) },
    { id: 5, user: "seed-user-simba", type: "info", title: "Welcome to Tengasell", body: "a snap to your happy deal — your account is ready.", link: "#/", read: 1, created_at: isoMinutesFromNow(-21600) },
    { id: 6, user: "seed-user-simba", type: "ending", title: "Ending soon", body: "iPhone 13 128GB ends in under an hour — your watchlist!", link: "#/item/1001", read: 0, created_at: isoMinutesFromNow(-5) },
  ];

  return {
    categories: SEED_CATEGORIES,
    profiles,
    auctions,
    bids,
    watchlist,
    questions,
    threads,
    messages,
    orders,
    payments,
    ratings,
    notifications,
  };
}
