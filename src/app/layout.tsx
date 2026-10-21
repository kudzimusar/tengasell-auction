import type { Metadata, Viewport } from "next"
import { Inter, Noto_Sans_JP } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"
import { ThemeProvider } from "@/components/theme-provider"

const inter = Inter({ variable: "--font-geist-sans", subsets: ["latin"] })
const notoJp = Noto_Sans_JP({ variable: "--font-jp", subsets: ["latin"], weight: ["400", "500", "700"] })

export const metadata: Metadata = {
  title: "Tengasell — Zimbabwe's Online Auction Marketplace",
  description:
    "Tengasell is Zimbabwe's trusted online auction marketplace. Bid, buy and sell safely with escrow-style protection, mediated messaging and verified sellers.",
  keywords: ["Tengasell", "Zimbabwe", "auction", "marketplace", "online bidding"],
  openGraph: { title: "Tengasell", description: "Zimbabwe's online auction marketplace", type: "website" },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${notoJp.variable} font-sans antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
