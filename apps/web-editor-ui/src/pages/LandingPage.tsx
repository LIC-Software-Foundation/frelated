import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  Users,
  GitBranch,
  FileText,
  Zap,
  Shield,
  ChevronRight,
  Menu,
  X,
  ArrowRight,
  Star,
  Globe,
  CheckCircle2,
  Terminal,
  RefreshCw,
} from 'lucide-react';

// ─── Data ─────────────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { label: 'Fonctionnalités', href: '#features' },
  { label: 'Comment ça marche', href: '#how' },
  { label: 'Open source', href: '#opensource' },
];

const FEATURES = [
  {
    icon: Users,
    color: 'bg-emerald-100 text-emerald-700',
    title: 'Collaboration temps réel',
    desc: 'Éditez simultanément avec vos co-auteurs grâce à la synchronisation Yjs. Suivez la présence et les curseurs de chaque collaborateur.',
  },
  {
    icon: FileText,
    color: 'bg-blue-100 text-blue-700',
    title: 'LaTeX natif',
    desc: "Syntaxe colorée, autocomplétion des commandes, compilation directe vers PDF sans quitter l'interface.",
  },
  {
    icon: Shield,
    color: 'bg-violet-100 text-violet-700',
    title: 'Projets privés',
    desc: 'Chaque projet est rattaché à un compte vérifié. Le partage reste contrôlé, tracé et réservé aux personnes autorisées.',
  },
  {
    icon: Zap,
    color: 'bg-amber-100 text-amber-700',
    title: 'Import instantané',
    desc: 'Glissez un dossier ou une archive ZIP. La plateforme détecte automatiquement vos fichiers .tex et les indexe.',
  },
  {
    icon: GitBranch,
    color: 'bg-rose-100 text-rose-700',
    title: 'Open source',
    desc: 'Base transparente, extensible, pensée pour les laboratoires, universités et équipes produit.',
  },
  {
    icon: Globe,
    color: 'bg-cyan-100 text-cyan-700',
    title: 'Multi-plateforme',
    desc: "Interface web responsive. Accédez à vos projets depuis n'importe quel appareil, sans installation.",
  },
];

const STEPS = [
  {
    n: '01',
    title: 'Créez un compte',
    desc: 'Inscription sécurisée en 30 secondes. Aucune carte bancaire requise.',
  },
  {
    n: '02',
    title: 'Importez ou créez',
    desc: "Nouveau projet vierge ou import d'une archive ZIP avec détection .tex automatique.",
  },
  {
    n: '03',
    title: 'Collaborez',
    desc: 'Invitez vos coauteurs, éditez ensemble, compilez et exportez en PDF.',
  },
];

const TESTIMONIALS = [
  {
    name: 'Amina Kotto',
    role: 'Doctorante, Université de Yaoundé',
    text: 'Frelated a transformé la façon dont mon groupe rédige nos articles de recherche. La synchronisation est bluffante.',
    avatar: 'AK',
  },
  {
    name: 'Paul Ndzi',
    role: 'Ingénieur R&D, OpenLab Africa',
    text: "J'utilisais Overleaf mais la liberté d'une solution open source hébergeable localement change tout.",
    avatar: 'PN',
  },
  {
    name: 'Sara Mbuyi',
    role: 'Enseignante-chercheuse',
    text: "L'import ZIP avec détection automatique des fichiers .tex est une vraie pépite pour onboarder de nouveaux collègues.",
    avatar: 'SM',
  },
];

const STATS = [
  { value: '10×', label: 'plus rapide que par email' },
  { value: '100%', label: 'open source' },
  { value: 'Yjs', label: 'synchronisation CRDT' },
  { value: 'LaTeX', label: 'support natif' },
];

// ─── Components ───────────────────────────────────────────────────────────────

const NavBar: React.FC<{ onMenu: () => void; mobileOpen: boolean }> = ({
  onMenu,
  mobileOpen,
}) => (
  <header className="fixed inset-x-0 top-0 z-50 border-b border-emerald-900/10 bg-white/90 backdrop-blur-xl">
    <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-10">
      {/* Logo */}
      <Link to="/" className="flex items-center gap-3 flex-shrink-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#2d6a4f] shadow-md shadow-emerald-900/20">
          <BookOpen
            className="h-4.5 w-4.5 text-white"
            style={{ width: 18, height: 18 }}
          />
        </div>
        <span className="text-[15px] font-bold tracking-tight text-slate-900">
          Frelated
        </span>
      </Link>

      {/* Desktop nav */}
      <nav className="ml-8 hidden items-center gap-1 lg:flex">
        {NAV_LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            className="px-3.5 py-2 rounded-lg text-[13.5px] font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors"
          >
            {l.label}
          </a>
        ))}
      </nav>

      <div className="flex-1" />

      {/* Desktop CTAs */}
      <div className="hidden items-center gap-2 sm:flex">
        <Link
          to="/login"
          className="px-4 py-2 rounded-xl text-[13.5px] font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 border border-slate-200 transition-colors"
        >
          Se connecter
        </Link>
        <Link
          to="/register"
          className="px-4 py-2 rounded-xl text-[13.5px] font-semibold text-white bg-[#2d6a4f] hover:bg-[#245a41] shadow-sm shadow-emerald-900/20 transition-all hover:-translate-y-0.5"
        >
          Commencer gratuitement
        </Link>
      </div>

      {/* Mobile hamburger */}
      <button
        onClick={onMenu}
        className="ml-2 rounded-xl border border-slate-200 p-2 text-slate-600 sm:hidden transition-colors hover:bg-slate-50"
      >
        {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
    </div>

    {/* Mobile menu */}
    {mobileOpen && (
      <div className="border-t border-slate-100 bg-white px-4 pt-3 pb-4 sm:hidden animate-fade-in">
        {NAV_LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            className="block px-3 py-2.5 rounded-lg text-[14px] font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors"
          >
            {l.label}
          </a>
        ))}
        <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col gap-2">
          <Link
            to="/login"
            className="w-full py-2.5 text-center text-[14px] font-medium text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
          >
            Se connecter
          </Link>
          <Link
            to="/register"
            className="w-full py-2.5 text-center text-[14px] font-semibold text-white bg-[#2d6a4f] rounded-xl hover:bg-[#245a41] transition-colors"
          >
            Commencer gratuitement
          </Link>
        </div>
      </div>
    )}
  </header>
);

// ─── Main LandingPage ──────────────────────────────────────────────────────────

const LandingPage: React.FC = () => {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-white text-slate-900 overflow-x-hidden">
      <NavBar onMenu={() => setMobileOpen((o) => !o)} mobileOpen={mobileOpen} />

      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <section className="relative pt-28 pb-20 sm:pt-36 sm:pb-28 overflow-hidden">
        {/* Background blobs */}
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full bg-gradient-to-br from-emerald-50 via-teal-50 to-transparent opacity-80"
            style={{ filter: 'blur(80px)' }}
          />
          <div
            className="absolute -top-24 -left-24 w-80 h-80 rounded-full bg-emerald-100 opacity-30"
            style={{ filter: 'blur(60px)' }}
          />
          <div
            className="absolute top-40 right-0 w-64 h-64 rounded-full bg-teal-100 opacity-40"
            style={{ filter: 'blur(60px)' }}
          />
          {/* Subtle grid */}
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                'linear-gradient(#000 1px,transparent 1px),linear-gradient(90deg,#000 1px,transparent 1px)',
              backgroundSize: '48px 48px',
            }}
          />
        </div>

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
          <div className="flex flex-col items-center text-center">
            {/* Pill badge */}
            <div className="animate-fade-up mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-1.5 text-xs font-semibold text-emerald-700">
              <Star className="h-3 w-3 fill-emerald-400 text-emerald-400" />
              Éditeur LaTeX collaboratif open source
              <ChevronRight className="h-3 w-3 opacity-60" />
            </div>

            <h1 className="animate-fade-up animate-fade-up-d1 text-[clamp(36px,6vw,72px)] font-extrabold tracking-tighter leading-[1.04] text-slate-950 max-w-4xl">
              Rédigez vos documents
              <br />
              <span className="bg-gradient-to-r from-[#2d6a4f] via-[#40916c] to-[#52b788] bg-clip-text text-transparent">
                LaTeX en équipe
              </span>
            </h1>

            <p className="animate-fade-up animate-fade-up-d2 mt-6 text-[17px] text-slate-500 leading-relaxed max-w-2xl">
              Frelated est une plateforme d&apos;édition collaborative en temps
              réel pour articles scientifiques, thèses et rapports techniques —
              100% open source, sans installation.
            </p>

            <div className="animate-fade-up animate-fade-up-d3 mt-9 flex flex-col sm:flex-row items-center gap-3">
              <Link
                to="/register"
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl text-[15px] font-semibold text-white bg-[#2d6a4f] hover:bg-[#245a41] shadow-lg shadow-emerald-900/20 transition-all hover:-translate-y-0.5"
              >
                Créer un compte gratuit
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl text-[15px] font-medium text-slate-600 border border-slate-200 hover:border-slate-300 hover:text-slate-800 bg-white transition-all"
              >
                Se connecter
              </Link>
            </div>

            {/* Trust badges */}
            <div className="animate-fade-up animate-fade-up-d4 mt-8 flex flex-wrap items-center justify-center gap-5 text-xs text-slate-400">
              {[
                'Gratuit et open source',
                'Sans carte bancaire',
                'Données chiffrées',
                'Hébergeable soi-même',
              ].map((t) => (
                <span key={t} className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  {t}
                </span>
              ))}
            </div>

            {/* App mockup */}
            <div className="animate-fade-up animate-fade-up-d4 mt-16 w-full max-w-5xl">
              <div className="relative">
                {/* Glow */}
                <div
                  className="absolute -inset-4 rounded-3xl bg-gradient-to-b from-emerald-100/40 to-transparent -z-10"
                  style={{ filter: 'blur(20px)' }}
                />
                <div className="rounded-2xl overflow-hidden border border-slate-200/80 shadow-2xl shadow-slate-900/10 bg-[#1b2635]">
                  {/* Toolbar mock */}
                  <div className="flex items-center gap-2 px-4 py-3 bg-[#141e2d] border-b border-[#253347]">
                    <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                    <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
                    <span className="w-3 h-3 rounded-full bg-[#28c840]" />
                    <div className="ml-3 flex items-center gap-2 text-slate-400 text-xs">
                      <div className="w-5 h-5 rounded bg-emerald-600 flex items-center justify-center text-white font-bold text-[10px]">
                        F
                      </div>
                      <span className="text-slate-300">Frelated</span>
                      <ChevronRight className="w-3 h-3 opacity-40" />
                      <span className="text-slate-400">Thèse de doctorat</span>
                      <ChevronRight className="w-3 h-3 opacity-40" />
                      <span className="text-white font-medium">main.tex</span>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <div className="hidden sm:flex items-center gap-1 rounded border border-slate-700 overflow-hidden text-[11px]">
                        <span className="px-2 py-1 text-slate-300">Code</span>
                        <span className="px-2 py-1 bg-white/10 text-white border-x border-slate-700">
                          Split
                        </span>
                        <span className="px-2 py-1 text-slate-400">PDF</span>
                      </div>
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] bg-emerald-600 text-white font-semibold">
                        <Terminal className="w-3 h-3" />
                        Compiler
                      </div>
                    </div>
                  </div>
                  {/* Editor mock */}
                  <div className="flex h-64 sm:h-80">
                    {/* Sidebar */}
                    <div className="w-40 border-r border-[#253347] p-2 hidden sm:block">
                      <div className="text-[9px] tracking-widest uppercase text-slate-500 px-2 py-1 mb-1">
                        Fichiers
                      </div>
                      {[
                        'main.tex',
                        'introduction.tex',
                        'references.bib',
                        'figures/',
                      ].map((f, i) => (
                        <div
                          key={f}
                          className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-[11px] cursor-pointer ${i === 0 ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`}
                        >
                          <div
                            className={`w-1.5 h-1.5 rounded-full ${f.endsWith('.tex') ? 'bg-amber-400' : f.endsWith('.bib') ? 'bg-blue-400' : 'bg-slate-500'}`}
                          />
                          {f}
                        </div>
                      ))}
                    </div>
                    {/* Code area */}
                    <div className="flex-1 p-4 font-mono text-[12px] leading-6 overflow-hidden">
                      {[
                        { t: '\\documentclass{article}', c: 'text-blue-400' },
                        {
                          t: '\\usepackage[utf8]{inputenc}',
                          c: 'text-blue-400',
                        },
                        { t: '', c: '' },
                        {
                          t: '\\title{Ma thèse de doctorat}',
                          c: 'text-emerald-400',
                        },
                        { t: '\\author{Amina Kotto}', c: 'text-emerald-400' },
                        { t: '', c: '' },
                        { t: '\\begin{document}', c: 'text-amber-400' },
                        { t: '\\maketitle', c: 'text-slate-300' },
                        { t: '', c: '' },
                        { t: '\\section{Introduction}', c: 'text-emerald-300' },
                        {
                          t: 'La recherche en intelligence...',
                          c: 'text-slate-300',
                        },
                      ].map((line, i) => (
                        <div key={i} className="flex gap-4">
                          <span className="text-slate-600 select-none w-5 text-right flex-shrink-0">
                            {i + 1}
                          </span>
                          <span className={line.c}>{line.t || '\u00a0'}</span>
                        </div>
                      ))}
                      {/* Cursor */}
                      <div className="flex gap-4">
                        <span className="text-slate-600 select-none w-5 text-right flex-shrink-0">
                          12
                        </span>
                        <span className="text-slate-300">
                          artificielle
                          <span className="inline-block w-0.5 h-4 bg-emerald-400 ml-0.5 animate-pulse" />
                        </span>
                      </div>
                    </div>
                    {/* Collaborators */}
                    <div className="w-44 border-l border-[#253347] p-3 hidden lg:block">
                      <div className="text-[9px] tracking-widest uppercase text-slate-500 mb-2">
                        En ligne
                      </div>
                      {[
                        { n: 'Amina K.', c: '#2d6a4f', active: true },
                        { n: 'Paul N.', c: '#1e6091', active: true },
                        { n: 'Sara M.', c: '#7b2d8b', active: false },
                      ].map((u) => (
                        <div
                          key={u.n}
                          className="flex items-center gap-2 py-1.5"
                        >
                          <div
                            className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
                            style={{ background: u.c }}
                          >
                            {u.n
                              .split(' ')
                              .map((w) => w[0])
                              .join('')}
                          </div>
                          <span className="text-[11px] text-slate-400">
                            {u.n}
                          </span>
                          {u.active && (
                            <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── STATS ────────────────────────────────────────────────────── */}
      <div className="border-y border-slate-100 bg-slate-50/70">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-10 py-10">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {STATS.map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-3xl font-extrabold tracking-tight text-[#2d6a4f]">
                  {s.value}
                </div>
                <div className="mt-1 text-sm text-slate-500">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── FEATURES ─────────────────────────────────────────────────── */}
      <section id="features" className="py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
          <div className="text-center mb-14">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-600 mb-3">
              Fonctionnalités
            </div>
            <h2 className="text-[clamp(28px,4vw,44px)] font-extrabold tracking-tight text-slate-950">
              Tout ce qu&apos;il vous faut pour collaborer
            </h2>
            <p className="mt-4 text-[16px] text-slate-500 max-w-2xl mx-auto">
              Une expérience complète de l&apos;import à la compilation, pensée
              pour les chercheurs et équipes académiques.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="card-lift group rounded-2xl border border-slate-100 bg-white p-6 shadow-sm"
                >
                  <div
                    className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl ${f.color} mb-4`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-[16px] font-semibold text-slate-900 mb-2">
                    {f.title}
                  </h3>
                  <p className="text-[13.5px] text-slate-500 leading-relaxed">
                    {f.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────── */}
      <section id="how" className="py-20 sm:py-28 bg-[#f8fafb]">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-10">
          <div className="text-center mb-14">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-600 mb-3">
              Comment ça marche
            </div>
            <h2 className="text-[clamp(26px,4vw,40px)] font-extrabold tracking-tight text-slate-950">
              Opérationnel en 3 étapes
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {STEPS.map((s, i) => (
              <div key={s.n} className="relative text-center">
                {i < STEPS.length - 1 && (
                  <div className="hidden md:block absolute top-8 left-[calc(50%+40px)] w-[calc(100%-80px)] h-px border-t-2 border-dashed border-emerald-200" />
                )}
                <div className="relative inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-white border-2 border-emerald-100 shadow-sm mb-5">
                  <span className="text-2xl font-black text-[#2d6a4f]">
                    {s.n}
                  </span>
                </div>
                <h3 className="text-[16px] font-semibold text-slate-900 mb-2">
                  {s.title}
                </h3>
                <p className="text-[13.5px] text-slate-500 leading-relaxed">
                  {s.desc}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-12 text-center">
            <Link
              to="/register"
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl text-[15px] font-semibold text-white bg-[#2d6a4f] hover:bg-[#245a41] shadow-lg shadow-emerald-900/15 transition-all hover:-translate-y-0.5"
            >
              Commencer maintenant
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ─────────────────────────────────────────────── */}
      <section className="py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
          <div className="text-center mb-14">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-600 mb-3">
              Témoignages
            </div>
            <h2 className="text-[clamp(26px,4vw,40px)] font-extrabold tracking-tight text-slate-950">
              Ils nous font confiance
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t) => (
              <div
                key={t.name}
                className="card-lift rounded-2xl border border-slate-100 bg-white p-6 shadow-sm"
              >
                <div className="flex gap-1 mb-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className="h-4 w-4 fill-amber-400 text-amber-400"
                    />
                  ))}
                </div>
                <p className="text-[14px] text-slate-600 leading-relaxed mb-5">
                  &quot;{t.text}&quot;
                </p>
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2d6a4f] text-[12px] font-bold text-white flex-shrink-0">
                    {t.avatar}
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-slate-900">
                      {t.name}
                    </div>
                    <div className="text-[11.5px] text-slate-500">{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── OPEN SOURCE ──────────────────────────────────────────────── */}
      <section id="opensource" className="py-20 sm:py-28 bg-[#1a2e22]">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-10 text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-900/50 border border-emerald-700/40 px-4 py-1.5 text-xs font-semibold text-emerald-300 mb-6">
            <GitBranch className="h-3 w-3" />
            100% Open Source
          </div>
          <h2 className="text-[clamp(28px,4vw,48px)] font-extrabold tracking-tight text-white mb-5">
            Transparent, extensible et fait pour durer
          </h2>
          <p className="text-[16px] text-emerald-100/70 leading-relaxed max-w-2xl mx-auto mb-10">
            Frelated est conçu comme une brique collaborative ouverte —
            hébergeable en interne, auditable, extensible par la communauté.
            Aucune dépendance propriétaire.
          </p>
          <div className="grid sm:grid-cols-3 gap-4 mb-10">
            {[
              {
                icon: RefreshCw,
                label: 'Synchronisation CRDT',
                sub: 'via Yjs — aucun conflit',
              },
              {
                icon: Shield,
                label: 'Authentification locale',
                sub: 'mockée ou Supabase',
              },
              {
                icon: Terminal,
                label: 'Compilation LaTeX',
                sub: 'back-end branché ou simulé',
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className="rounded-2xl bg-white/5 border border-white/10 p-5 text-left"
                >
                  <div className="w-9 h-9 rounded-xl bg-emerald-800/60 flex items-center justify-center mb-3">
                    <Icon className="h-4 w-4 text-emerald-300" />
                  </div>
                  <div className="text-[14px] font-semibold text-white">
                    {item.label}
                  </div>
                  <div className="text-[12px] text-emerald-100/50 mt-1">
                    {item.sub}
                  </div>
                </div>
              );
            })}
          </div>
          <Link
            to="/register"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl text-[15px] font-semibold text-[#1a2e22] bg-emerald-400 hover:bg-emerald-300 transition-all hover:-translate-y-0.5 shadow-lg shadow-emerald-900/30"
          >
            Rejoindre la plateforme
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-100 bg-white py-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-[#2d6a4f] flex items-center justify-center">
                <BookOpen className="h-4 w-4 text-white" />
              </div>
              <span className="text-[14px] font-bold text-slate-900">
                Frelated
              </span>
            </div>
            <p className="text-[12px] text-slate-400 text-center">
              © {new Date().getFullYear()} Frelated · Éditeur LaTeX
              collaboratif open source
            </p>
            <div className="flex items-center gap-4 text-[12px] text-slate-500">
              <Link
                to="/login"
                className="hover:text-slate-800 transition-colors"
              >
                Connexion
              </Link>
              <Link
                to="/register"
                className="hover:text-slate-800 transition-colors"
              >
                Inscription
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
