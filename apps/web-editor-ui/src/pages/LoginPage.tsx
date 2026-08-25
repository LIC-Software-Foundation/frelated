import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Mail,
  Lock,
  ArrowRight,
  Eye,
  EyeOff,
  AlertCircle,
} from 'lucide-react';
import type { LoginPayload } from '../services/auth.types';
import { Button, Input } from '../components/ui';

interface LoginPageProps {
  onLogin: (payload: LoginPayload) => Promise<void>;
  isSubmitting: boolean;
}

const LoginPage: React.FC<LoginPageProps> = ({ onLogin, isSubmitting }) => {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [showPwd, setShowPwd] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await onLogin(form);
      navigate('/projects');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion impossible.');
    }
  };

  return (
    <div className="min-h-screen bg-[#f0f4f2] flex">
      {/* ── Left panel (branding) ── */}
      <div className="hidden lg:flex lg:w-[46%] xl:w-[42%] bg-[#1a2e22] flex-col justify-between p-12 relative overflow-hidden">
        {/* Decorative blobs */}
        <div
          className="absolute top-0 left-0 w-96 h-96 rounded-full bg-emerald-800/30 -translate-x-1/2 -translate-y-1/2"
          style={{ filter: 'blur(80px)' }}
        />
        <div
          className="absolute bottom-0 right-0 w-80 h-80 rounded-full bg-teal-800/20 translate-x-1/2 translate-y-1/2"
          style={{ filter: 'blur(70px)' }}
        />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,.6) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.6) 1px,transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />

        {/* Logo */}
        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 border border-emerald-500/30">
            <BookOpen className="h-5 w-5 text-emerald-400" />
          </div>
          <span className="text-[17px] font-bold text-white">Frelated</span>
        </div>

        {/* Center quote */}
        <div className="relative">
          <div className="text-5xl font-black text-emerald-400 leading-none mb-4">
            &quot;
          </div>
          <p className="text-[18px] font-medium text-white/90 leading-relaxed">
            La rédaction scientifique collaborative, réinventée pour les équipes
            modernes.
          </p>
          <div className="mt-8 flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-emerald-600 flex items-center justify-center text-xs font-bold text-white">
              AK
            </div>
            <div>
              <div className="text-[13px] font-semibold text-white">
                Amina Kotto
              </div>
              <div className="text-[12px] text-white/50">
                Doctorante, Université de Yaoundé
              </div>
            </div>
          </div>
        </div>

        {/* Features list */}
        <div className="relative space-y-3">
          {[
            'Synchronisation en temps réel',
            'Import ZIP avec détection .tex',
            'Compilation LaTeX intégrée',
          ].map((f) => (
            <div
              key={f}
              className="flex items-center gap-2.5 text-[13px] text-emerald-100/70"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
              {f}
            </div>
          ))}
        </div>
      </div>

      {/* ── Right panel (form) ── */}
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:px-8">
        {/* Mobile logo */}
        <div className="lg:hidden mb-8 flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-[#2d6a4f] flex items-center justify-center">
            <BookOpen
              className="h-4.5 w-4.5 text-white"
              style={{ width: 18, height: 18 }}
            />
          </div>
          <span className="text-[16px] font-bold text-slate-900">Frelated</span>
        </div>

        <div className="w-full max-w-[420px]">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 sm:p-9">
            <div className="mb-7">
              <h1 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
                Bon retour 👋
              </h1>
              <p className="mt-1.5 text-[14px] text-slate-500">
                Connectez-vous pour accéder à vos projets.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Adresse e-mail"
                type="email"
                placeholder="vous@exemple.com"
                value={form.email}
                onChange={(e) =>
                  setForm((f) => ({ ...f, email: e.target.value }))
                }
                leftEl={<Mail className="h-4 w-4" />}
                required
                autoFocus
              />

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-700">
                  Mot de passe
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-3 flex items-center text-slate-400 pointer-events-none">
                    <Lock className="h-4 w-4" />
                  </span>
                  <input
                    type={showPwd ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={form.password}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, password: e.target.value }))
                    }
                    required
                    className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-10 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-[#40916c] focus:ring-3 focus:ring-[#52b788]/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    className="absolute inset-y-0 right-3 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showPwd ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2.5 rounded-xl border border-red-100 bg-red-50 px-3.5 py-3">
                  <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-[13px] text-red-700 leading-snug">
                    {error}
                  </p>
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={isSubmitting}
                rightIcon={<ArrowRight className="h-4 w-4" />}
                className="w-full mt-1"
              >
                {isSubmitting ? 'Vérification…' : 'Se connecter'}
              </Button>
            </form>

            {/* Demo hint */}
            <div className="mt-5 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3">
              <p className="text-[12px] text-emerald-800 leading-relaxed">
                <span className="font-semibold">Compte de test :</span>{' '}
                amina@frelated.dev / frelated123
              </p>
            </div>

            <p className="mt-6 text-center text-[13px] text-slate-500">
              Pas encore de compte ?{' '}
              <Link
                to="/register"
                className="font-semibold text-[#2d6a4f] hover:text-[#245a41] transition-colors"
              >
                Créer un compte
              </Link>
            </p>
          </div>

          <p className="mt-6 text-center text-[11.5px] text-slate-400">
            <Link to="/" className="hover:text-slate-600 transition-colors">
              ← Retour à l&apos;accueil
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
