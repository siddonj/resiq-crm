import { createContext, useContext, useState, useEffect } from 'react'
import axios from 'axios'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('resiq_token'))
  const [user, setUser] = useState(() => {
    const u = localStorage.getItem('resiq_user')
    return u ? JSON.parse(u) : null
  })

  const login = (token, user) => {
    localStorage.setItem('resiq_token', token)
    localStorage.setItem('resiq_user', JSON.stringify(user))
    setToken(token)
    setUser(user)
  }

  const logout = () => {
    localStorage.removeItem('resiq_token')
    localStorage.removeItem('resiq_user')
    setToken(null)
    setUser(null)
  }

  useEffect(() => {
    let mounted = true

    const syncCurrentUser = async () => {
      if (!token) return

      try {
        const { data } = await axios.get('/api/users/me', {
          headers: { Authorization: `Bearer ${token}` },
        })

        if (!mounted) return

        setUser(data)
        localStorage.setItem('resiq_user', JSON.stringify(data))
      } catch {
        if (!mounted) return
        logout()
      }
    }

    syncCurrentUser()

    return () => {
      mounted = false
    }
  }, [token])

  return (
    <AuthContext.Provider value={{ token, user, login, logout, isAuthenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
