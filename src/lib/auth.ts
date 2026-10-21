import type { NextAuthOptions } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { db } from "@/lib/db"
import { verifyPassword } from "@/lib/server/auth-core"

export const authOptions: NextAuthOptions = {
  providers: [
    Credentials({
      name: "Tengasell",
      credentials: { email: { label: "Email", type: "email" }, password: { label: "Password", type: "password" } },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials.password) return null
        const email = credentials.email.toLowerCase().trim()
        const ip = (req?.headers?.["x-forwarded-for"] as string)?.split(",")[0]?.trim() || "local"
        const log = (kind: string) =>
          db.authEvent.create({ data: { email, kind, ip } }).catch(() => undefined)
        const user = await db.user.findUnique({ where: { email } })
        if (!user || user.status === "DELETED") { await log("LOGIN_FAIL"); return null }
        if (user.status === "SUSPENDED" || user.status === "BANNED") { await log("LOCKOUT"); return null }
        if (!verifyPassword(credentials.password, user.passwordHash)) {
          await log("LOGIN_FAIL")
          await db.user.update({ where: { id: user.id }, data: { riskScore: { increment: 1 } } })
          return null
        }
        await log("LOGIN_OK")
        await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), riskScore: 0 } })
        await db.sessionRecord.create({ data: { userId: user.id, ip } }).catch(() => undefined)
        return { id: user.id, email: user.email, name: user.name, role: user.role, handle: user.handle, stepUp: false }
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: 24 * 60 * 60 },
  pages: { signIn: "/" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as { role?: string }).role
        token.handle = (user as { handle?: string }).handle
        token.stepUp = false
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        ;(session.user as Record<string, unknown>).id = token.id as string
        ;(session.user as Record<string, unknown>).role = token.role as string
        ;(session.user as Record<string, unknown>).handle = token.handle as string
        ;(session.user as Record<string, unknown>).stepUp = token.stepUp as boolean
      }
      return session
    },
  },
  secret: process.env.NEXTAUTH_SECRET || "tengasell-dev-secret-change-in-production",
}
