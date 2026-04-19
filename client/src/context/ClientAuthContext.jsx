import { createContext, useContext, useState, useEffect } from 'react'

const ClientAuthContext = createContext(null)

export function ClientAuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('client_token'))
  const [client, setClient] = useState(() => {
    const c = localStorage.getItem('client_user')
    return c ? JSON.parse(c) : null
  })
  const [loading, setLoading] = useState(false)

  const login = (token, clientData) => {
    localStorage.setItem('client_token', token)
    localStorage.setItem('client_user', JSON.stringify(clientData))
    setToken(token)
    setClient(clientData)
  }

  const logout = () => {
    localStorage.removeItem('client_token')
    localStorage.removeItem('client_user')
    setToken(null)
    setClient(null)
  }

  // Fetch authenticated client profile
  const fetchProfile = async () => {
    if (!token) return
    try {
      setLoading(true)
      const res = await fetch('http://localhost:5000/api/client/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setClient(data)
        localStorage.setItem('client_user', JSON.stringify(data))
      } else if (res.status === 401) {
        logout()
      }
    } catch (err) {
      console.error('Failed to fetch profile:', err)
    } finally {
      setLoading(false)
    }
  }

  // Validate token on mount
  useEffect(() => {
    if (token) {
      fetchProfile()
    }
  }, [])

  const value = {
    token,
    client,
    loading,
    login,
    logout,
    isAuthenticated: !!token,
    fetchProfile,
  }

  return <ClientAuthContext.Provider value={value}>{children}</ClientAuthContext.Provider>
}

export const useClientAuth = () => {
  const context = useContext(ClientAuthContext)
  if (!context) {
    throw new Error('useClientAuth must be used within ClientAuthProvider')
  }
  return context
}
