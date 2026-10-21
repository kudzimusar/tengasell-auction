// ── Experience-plane shared client types (Agent A) — shapes match the API routes ──

export type SellerMini = { id?: string; shopName: string; slug: string | null; avatarEmoji: string; ratingAvg?: number }

export type CategoryMini = { id?: string; slug: string; name: string; nameJa: string; icon: string; listingCount?: number }

export type ListingCardData = {
  id: string
  title: string
  condition: "NEW" | "USED" | "REFURB"
  type: "AUCTION" | "BUY_NOW"
  startingPrice: number
  buyNowPrice: number | null
  currentPrice: number
  images: string[]
  status: string
  endsAt?: string | null
  bidCount?: number
  watchCount?: number
  viewCount?: number
  createdAt?: string
  rejectReason?: string | null
  watchedAt?: string
  seller: SellerMini
  category?: CategoryMini | null
}

export type ListingSearchResult = { items: ListingCardData[]; total: number; page: number; limit: number }

export type CategoryList = { items: CategoryMini[] }

export type BidEntry = { id: string; amount: number; bidderName: string; isMine: boolean; createdAt: string }

export type ListingDetail = {
  id: string
  title: string
  description: string
  condition: string
  type: "AUCTION" | "BUY_NOW"
  startingPrice: number
  buyNowPrice: number | null
  currentPrice: number
  stock: number
  images: string[]
  status: string
  rejectReason?: string | null
  endsAt: string | null
  viewCount: number
  bidCount: number
  watchCount: number
  createdAt: string
  category: CategoryMini | null
  seller: {
    id: string
    name: string
    avatarEmoji: string
    city: string | null
    memberSince: string
    shopName: string
    slug: string | null
    shopStatus: string
    bio?: string
    ratingAvg: number
    ratingCount: number
    healthScore: number
    identityVerified: boolean
  } | null
  bids: BidEntry[]
  versionCount: number
  similar: ListingCardData[]
  viewer: { isOwner: boolean; isStaff: boolean; isWatched: boolean }
  meta: { bidIncrement: number; vatRate: number; sellerFeePct: number }
}

export type OrderCardData = {
  id: string
  listingId: string
  listingTitle: string
  listingImages: string[]
  listingStatus: string | null
  type: string
  amount: number
  buyerFee: number
  sellerFee: number
  vatAmount: number
  totalCharged: number
  status: string
  paymentMethod: string | null
  trackingCode: string | null
  carrier: string | null
  shippingAddress: { name?: string; phone?: string; city?: string; street?: string; notes?: string } | null
  placedAt: string
  paidAt: string | null
  shippedAt: string | null
  deliveredAt: string | null
  completedAt: string | null
  role: "buyer" | "seller"
  eventCount: number
  lastEventType: string | null
  lastEventAt: string | null
  dispute: { id: string; status: string; reason: string } | null
  hasReview: boolean
}

export type OrderDetailData = {
  order: OrderCardData & { buyerId: string; sellerId: string; cancelledAt: string | null }
  viewer: { isBuyer: boolean; isSeller: boolean; isStaff: boolean }
  events: { id: string; type: string; actorId: string | null; data: Record<string, unknown>; createdAt: string }[]
  dispute: { id: string; reason: string; details: string | null; status: string; openedAt: string } | null
  review: { id: string; rating: number; title: string | null; body: string | null; createdAt: string } | null
  payment: { id: string; method: string; status: string; amount: number } | null
  invoice: { id: string; number: string; total: number; vatAmount: number } | null
}

export type SellerPageData = {
  seller: {
    id: string
    userId: string
    shopName: string
    slug: string
    bio: string | null
    status: string
    identityVerified: boolean
    businessVerified: boolean
    healthScore: number
    ratingAvg: number
    ratingCount: number
    joinedAt: string
    city: string | null
    avatarEmoji: string
    userStatus: string
  }
  listings: ListingCardData[]
  reviews: { id: string; rating: number; title: string | null; body: string | null; createdAt: string; authorName: string; authorEmoji: string; listingId: string }[]
}

export type ReviewEntry = {
  id: string
  rating: number
  title: string | null
  body: string | null
  createdAt: string
  authorName: string
  authorEmoji: string
}

export type WatchListData = { items: ListingCardData[] }

export const PRESET_IMAGES = [
  "/items/phone.jpg", "/items/laptop.jpg", "/items/headphones.jpg", "/items/camera.jpg",
  "/items/dress.jpg", "/items/sneakers.jpg", "/items/painting.jpg", "/items/sofa.jpg",
  "/items/bicycle.jpg", "/items/guitar.jpg", "/items/watch.jpg", "/items/books.jpg",
]
