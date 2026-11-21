import jwt from 'jsonwebtoken'

// Sessions slide: requireAuth re-issues the cookie once a day while the app is used,
// so only 30 days of inactivity sign the owner out.
export const SESSION_SECONDS = 30 * 24 * 60 * 60
export const RENEW_AFTER_SECONDS = 24 * 60 * 60

const secureFlag = () => process.env.NODE_ENV === 'production' ? '; Secure' : ''

// The cookie keeps the app's earlier name (Mapper), so a rename does not sign everyone out.
export function setAuthCookie(res, { sub, version }) {
  const token = jwt.sign({ sub, version }, process.env.SESSION_SECRET, { expiresIn: SESSION_SECONDS })
  res.setHeader('Set-Cookie', `mapper_token=${token}; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secureFlag()}; Path=/`)
}

export function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `mapper_token=; HttpOnly; SameSite=Strict; Max-Age=0${secureFlag()}; Path=/`)
}
