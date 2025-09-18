import {
  FileText,
  Zap,
  Users,
  Code,
  ChevronRight,
  Github,
  BookOpen,
  Sparkles,
} from 'lucide-react';
import { Link } from 'react-router-dom';

const Home = () => {
  const features = [
    {
      icon: <FileText className="w-6 h-6" />,
      title: 'Édition en temps réel',
      description:
        'Visualisez vos documents LaTeX instantanément avec notre aperçu en direct',
    },
    {
      icon: <Zap className="w-6 h-6" />,
      title: 'Compilation rapide',
      description: 'Moteur de rendu optimisé pour une compilation ultra-rapide',
    },
    {
      icon: <Code className="w-6 h-6" />,
      title: 'Coloration syntaxique',
      description:
        'Syntaxe LaTeX mise en évidence pour une meilleure lisibilité',
    },
    {
      icon: <Users className="w-6 h-6" />,
      title: 'Collaboration',
      description: 'Travaillez en équipe sur vos documents LaTeX',
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header */}
      <nav className="relative z-10 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">Lᴀ</span>
            </div>
            <span className="text-white font-bold text-xl">LaTeX Editor</span>
          </div>
          <div className="flex items-center space-x-6">
            <a
              href="/docs"
              className="text-gray-300 hover:text-white transition-colors"
            >
              Documentation
            </a>
            <a
              href="/about"
              className="text-gray-300 hover:text-white transition-colors"
            >
              À propos
            </a>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="relative px-6 py-20">
        <div className="max-w-7xl mx-auto text-center">
          {/* Decorative elements */}
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse"></div>
            <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse"></div>
          </div>

          <div className="relative z-10">
            <div className="inline-flex items-center px-4 py-2 bg-purple-500/10 border border-purple-500/20 rounded-full mb-8">
              <Sparkles className="w-4 h-4 text-purple-400 mr-2" />
              <span className="text-purple-300 text-sm font-medium">
                Nouvel éditeur LaTeX en ligne
              </span>
            </div>

            <h1 className="text-5xl md:text-7xl font-bold text-white mb-6">
              Créez des documents
              <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent block">
                LaTeX parfaits
              </span>
            </h1>

            <p className="text-xl text-gray-300 mb-10 max-w-3xl mx-auto leading-relaxed">
              Un éditeur LaTeX moderne et puissant avec aperçu en temps réel,
              collaboration en équipe et tous les outils dont vous avez besoin
              pour créer des documents académiques et professionnels
              exceptionnels.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <Link
                to="/editor"
                className="group inline-flex items-center px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-semibold rounded-xl hover:from-blue-600 hover:to-purple-700 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:-translate-y-1"
              >
                Commencer à écrire
                <ChevronRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
              </Link>

              <button className="inline-flex items-center px-8 py-4 border-2 border-white/20 text-white font-semibold rounded-xl hover:bg-white/10 transition-all duration-300">
                <BookOpen className="w-5 h-5 mr-2" />
                Voir la démo
              </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-8 mt-16 max-w-md mx-auto">
              <div className="text-center">
                <div className="text-3xl font-bold text-white mb-1">5K+</div>
                <div className="text-gray-400 text-sm">Utilisateurs</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-white mb-1">50K+</div>
                <div className="text-gray-400 text-sm">Documents</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-white mb-1">99.9%</div>
                <div className="text-gray-400 text-sm">Uptime</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="relative px-6 py-20 bg-white/5 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-white mb-4">
              Pourquoi choisir notre éditeur ?
            </h2>
            <p className="text-gray-300 text-lg max-w-2xl mx-auto">
              Découvrez les fonctionnalités qui font de notre éditeur l'outil
              idéal pour tous vos projets LaTeX
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {features.map((feature, index) => (
              <div
                key={index}
                className="group p-6 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl hover:bg-white/10 transition-all duration-300 hover:-translate-y-2"
              >
                <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <div className="text-white">{feature.icon}</div>
                </div>
                <h3 className="text-xl font-semibold text-white mb-3">
                  {feature.title}
                </h3>
                <p className="text-gray-300 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="relative px-6 py-20">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl font-bold text-white mb-6">
            Prêt à créer votre prochain document ?
          </h2>
          <p className="text-xl text-gray-300 mb-10">
            Rejoignez des milliers d'utilisateurs qui font confiance à notre
            éditeur LaTeX
          </p>
          <Link
            to="/editor"
            className="inline-flex items-center px-10 py-5 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-bold text-lg rounded-xl hover:from-blue-600 hover:to-purple-700 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:-translate-y-1"
          >
            Lancer l'éditeur
            <ChevronRight className="w-6 h-6 ml-2" />
          </Link>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/10 px-6 py-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between">
          <div className="flex items-center space-x-2 mb-4 md:mb-0">
            <div className="w-6 h-6 bg-gradient-to-r from-blue-500 to-purple-600 rounded flex items-center justify-center">
              <span className="text-white font-bold text-xs">Lᴀ</span>
            </div>
            <span className="text-gray-400">© 2025 LaTeX Editor</span>
          </div>
          <div className="flex items-center space-x-6">
            <a
              href="#"
              className="text-gray-400 hover:text-white transition-colors"
            >
              <Github className="w-5 h-5" />
            </a>
            <a
              href="/privacy"
              className="text-gray-400 hover:text-white transition-colors text-sm"
            >
              Confidentialité
            </a>
            <a
              href="/terms"
              className="text-gray-400 hover:text-white transition-colors text-sm"
            >
              Conditions
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Home;
