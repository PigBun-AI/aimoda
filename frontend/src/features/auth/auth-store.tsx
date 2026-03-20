import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface AuthContextType {
  isLoginOpen: boolean
  openLogin: () => void
  closeLogin: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoginOpen, setIsLoginOpen] = useState(false)

  const openLogin = useCallback(() => setIsLoginOpen(true), [])
  const closeLogin = useCallback(() => setIsLoginOpen(false), [])

  return (
    <AuthContext.Provider value={{ isLoginOpen, openLogin, closeLogin }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useLoginDialog() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useLoginDialog must be used within AuthProvider')
  }
  return context
}
