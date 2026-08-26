import React, { useState, ChangeEvent, FormEvent } from 'react';
import { Mail, ArrowRight, BookOpen } from 'lucide-react';
import { UserFormData } from '@frelated/types';

interface UserFormProps {
  onUserSubmit: (formData: UserFormData) => void;
}

const UserForm: React.FC<UserFormProps> = ({ onUserSubmit }) => {
  const [formData, setFormData] = useState<UserFormData>({
    name: '',
    email: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.email.trim()) return;
    setIsSubmitting(true);
    setTimeout(() => {
      onUserSubmit(formData);
      setIsSubmitting(false);
    }, 800);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const isValid = formData.name.trim() !== '' && formData.email.trim() !== '';

  return (
    <div className="min-h-screen bg-[#1b2635] flex items-center justify-center p-4">
      <div className="w-full max-w-sm animate-slide-up">
        {/* Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-600 shadow-lg mb-4">
            <BookOpen className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Frelated Editor
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            Éditeur LaTeX collaboratif en temps réel
          </p>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-xl shadow-2xl p-7">
          <h2 className="text-base font-semibold text-slate-800 mb-5">
            Accéder à l&apos;espace de travail
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-slate-700 mb-1.5"
              >
                Nom complet
              </label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all placeholder:text-slate-400"
                placeholder="Votre nom"
                required
                autoFocus
              />
            </div>

            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-slate-700 mb-1.5"
              >
                Adresse e-mail
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all placeholder:text-slate-400"
                  placeholder="vous@email.com"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !isValid}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 mt-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Connexion…</span>
                </>
              ) : (
                <>
                  <span>Continuer</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-slate-500 text-xs mt-5">
          Collaboration en temps réel sur vos documents LaTeX
        </p>
      </div>
    </div>
  );
};

export default UserForm;
