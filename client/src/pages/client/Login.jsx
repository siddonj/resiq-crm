import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useClientAuth } from '../context/ClientAuthContext'

export default function ClientLogin() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const [mode, setMode] = useState(token ? 'signup' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { login, isAuthenticated } = useClientAuth()
  const navigate = useNavigate()

  if (isAuthenticated) {
    navigate('/client')
    return null
  }

  const handleSignUp = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('http://localhost:5000/api/auth/client/verify/' + token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password: password || undefined }),
      })

      const data = await res.json()
      if (res.ok) {
        login(data.token, data.client)
        navigate('/client')
      } else {
        setError(data.error || 'Signup failed')
      }
    } catch (err) {
      setError('Failed to sign up. Please try again.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('http://localhost:5000/api/auth/client/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json()
      if (res.ok) {
        login(data.token, data.client)
        navigate('/client')
      } else {
        setError(data.error || 'Login failed')
      }
    } catch (err) {
      setError('Failed to login. Please try again.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleRequestLink = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('http://localhost:5000/api/auth/client/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const data = await res.json()
      if (res.ok) {
        setError('') // Clear any previous errors
        alert('Check your email for a verification link!')
        setEmail('')
      } else {
        setError(data.error || 'Failed to send link')
      }
    } catch (err) {
      setError('Failed to request link. Please try again.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-8">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-4xl font-bold text-blue-600 mb-2">ResiQ</div>
          <p className="text-gray-600">Client Portal</p>
        </div>

        {/* Mode Toggle */}
        {!token && (
          <div className="flex space-x-2 mb-6">
            <button
              onClick={() => {
                setMode('login')
                setError('')
              }}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
                mode === 'login'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Login
            </button>
            <button
              onClick={() => {
                setMode('request')
                setError('')
              }}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
                mode === 'request'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Magic Link
            </button>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Sign Up Form (from email link) */}
        {mode === 'signup' && token && (
          <form onSubmit={handleSignUp} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Your Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="John Doe"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Password (Optional)
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave blank for passwordless login"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">
                You can set a password now or use magic links every time
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition-colors"
            >
              {loading ? 'Creating Account...' : 'Create Account'}
            </button>
          </form>
        )}

        {/* Login Form */}
        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition-colors"
            >
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>
        )}

        {/* Request Magic Link Form */}
        {mode === 'request' && (
          <form onSubmit={handleRequestLink} className="space-y-4">
            <p className="text-gray-600 text-sm mb-4">
              Enter your email to receive a magic link. No password needed!
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition-colors"
            >
              {loading ? 'Sending...' : 'Send Magic Link'}
            </button>
          </form>
        )}

        {/* Footer */}
        <div className="mt-6 pt-6 border-t border-gray-200 text-center text-sm text-gray-600">
          <p>Need help? Contact your project manager.</p>
        </div>
      </div>
    </div>
  )
}
