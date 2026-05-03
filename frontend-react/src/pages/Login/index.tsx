import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from '@/api/auth'
import { useAuthStore } from '@/store/auth'

export default function LoginPage() {
  const navigate  = useNavigate()
  const setToken  = useAuthStore((s) => s.setToken)
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { token } = await login(email, password)
      setToken(token)
      navigate('/search', { replace: true })
    } catch {
      setError('E-posta veya şifre hatalı.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="text-4xl font-black text-white tracking-tight">
            Profile<span className="text-brand-500">Axis</span>
          </div>
          <p className="text-slate-400 text-sm mt-2">CAD Benzerlik Arama Motoru</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl shadow-xl p-8 flex flex-col gap-4"
        >
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
              E-posta
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              placeholder="ornek@firma.com"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
              Şifre
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-red-500 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors"
          >
            {loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
          </button>
        </form>
      </div>
    </div>
  )
}
