import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Mail,
  Lock,
  User,
  Building2,
  ArrowRight,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  GitBranch,
} from 'lucide-react';
import type { RegisterPayload } from '../services/auth.types';
import { Button, Input } from '../components/ui';

interface RegisterPageProps {
  onRegister: (payload: RegisterPayload) => Promise<void>;
  isSubmitting: boolean;
}

const PERKS = [
  'Éditeur LaTeX collaboratif en temps réel',
  'Import ZIP avec détection automatique .tex',
  'Compilation et aperçu PDF intégrés',
  'Open source & hébergeable soi-même',
];

const RegisterPage: React.FC<RegisterPageProps> = ({
  onRegister,
  isSubmitting,
}) => {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    organization: '',
  });
  const [showPwd, setShowPwd] = useState(false);
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pwdStrength = (() => {
    const p = form.password;
    if (p.length === 0) return null;
    if (p.length < 6)
      return { label: 'Trop court', color: 'bg-red-400', w: '33%' };
    if (p.length < 10)
      return { label: 'Moyen', color: 'bg-amber-400', w: '66%' };
    return { label: 'Fort', color: 'bg-emerald-500', w: '100%' };
  })();

  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!accept) {
      setError('Vous devez accepter la politique de confidentialité.');
      return;
    }
    if (form.password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    try {
      await onRegister({
        name: form.name,
        email: form.email,
        password: form.password,
        organization: form.organization || undefined,
      });
      navigate('/projects');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Inscription impossible.');
    }
  };

  return (
    <div className="min-h-screen bg-[#f0f4f2] flex">
      {/* ── Left panel ── */}
      <div className="hidden lg:flex lg:w-[46%] xl:w-[42%] bg-gradient-to-br from-[#1a2e22] to-[#0f1f17] flex-col justify-between p-12 relative overflow-hidden">
        <div
          className="absolute top-0 right-0 w-80 h-80 rounded-full bg-emerald-700/20 translate-x-1/2 -translate-y-1/2"
          style={{ filter: 'blur(70px)' }}
        />
        <div
          className="absolute bottom-0 left-0 w-96 h-96 rounded-full bg-teal-700/15 -translate-x-1/3 translate-y-1/3"
          style={{ filter: 'blur(80px)' }}
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

        {/* Headline */}
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-900/60 border border-emerald-700/40 px-4 py-1.5 text-xs font-semibold text-emerald-300 mb-6">
            <GitBranch className="h-3.5 w-3.5" />
            Plateforme open source
          </div>
          <h2 className="text-[30px] font-extrabold text-white leading-tight tracking-tight mb-5">
            Rejoignez des milliers
            <br />
            de chercheurs qui
            <br />
            collaborent sur Frelated
          </h2>
          <div className="space-y-3">
            {PERKS.map((p) => (
              <div
                key={p}
                className="flex items-center gap-3 text-[13.5px] text-emerald-100/75"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                {p}
              </div>
            ))}
          </div>
        </div>

        {/* Bottom blurb */}
        <div className="relative rounded-2xl bg-white/5 border border-white/10 p-5">
          <p className="text-[13px] text-white/70 leading-relaxed">
            Gratuit, sans carte bancaire. Vos projets restent privés et
            accessibles uniquement par les collaborateurs que vous invitez.
          </p>
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:px-8">
        {/* Mobile logo */}
        <div className="lg:hidden mb-8 flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-[#2d6a4f] flex items-center justify-center">
            <BookOpen
              style={{ width: 18, height: 18 }}
              className="text-white"
            />
          </div>
          <span className="text-[16px] font-bold text-slate-900">Frelated</span>
        </div>

        <div className="w-full max-w-[440px]">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 sm:p-9">
            <div className="mb-7">
              <h1 className="text-[22px] font-extrabold text-slate-900 tracking-tight">
                Créer un compte
              </h1>
              <p className="mt-1.5 text-[14px] text-slate-500">
                Rejoignez la plateforme et commencez à collaborer.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Nom complet"
                type="text"
                placeholder="Amina Kotto"
                value={form.name}
                onChange={set('name')}
                leftEl={<User className="h-4 w-4" />}
                required
                autoFocus
              />

              <Input
                label="Adresse e-mail"
                type="email"
                placeholder="vous@exemple.com"
                value={form.email}
                onChange={set('email')}
                leftEl={<Mail className="h-4 w-4" />}
                required
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
                    placeholder="8 caractères minimum"
                    value={form.password}
                    onChange={set('password')}
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
                {pwdStrength && (
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className="flex-1 h-1 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${pwdStrength.color}`}
                        style={{ width: pwdStrength.w }}
                      />
                    </div>
                    <span className="text-[11px] text-slate-500">
                      {pwdStrength.label}
                    </span>
                  </div>
                )}
              </div>

              <Input
                label="Organisation (optionnel)"
                type="text"
                placeholder="Université, labo, entreprise…"
                value={form.organization}
                onChange={set('organization')}
                leftEl={<Building2 className="h-4 w-4" />}
              />

              {/* Policy checkbox */}
              <label className="flex items-start gap-3 cursor-pointer">
                <div className="relative mt-0.5">
                  <input
                    type="checkbox"
                    checked={accept}
                    onChange={(e) => setAccept(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div
                    className="w-4.5 h-4.5 rounded border-2 border-slate-300 peer-checked:border-[#2d6a4f] peer-checked:bg-[#2d6a4f] transition-colors flex items-center justify-center"
                    style={{ width: 18, height: 18 }}
                  >
                    {accept && (
                      <CheckCircle2
                        className="w-3 h-3 text-white"
                        style={{ width: 12, height: 12 }}
                      />
                    )}
                  </div>
                </div>
                <span className="text-[12.5px] text-slate-500 leading-snug">
                  J&apos;accepte la{' '}
                  <span className="text-[#2d6a4f] font-medium cursor-pointer hover:underline">
                    politique de confidentialité
                  </span>{' '}
                  et les conditions d&apos;utilisation.
                </span>
              </label>

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
                disabled={!accept}
              >
                {isSubmitting ? 'Création du compte…' : 'Créer mon compte'}
              </Button>
            </form>

            <p className="mt-6 text-center text-[13px] text-slate-500">
              Déjà un compte ?{' '}
              <Link
                to="/login"
                className="font-semibold text-[#2d6a4f] hover:text-[#245a41] transition-colors"
              >
                Se connecter
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

export default RegisterPage;
