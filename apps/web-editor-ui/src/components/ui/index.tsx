import {
  forwardRef,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from 'react';
import { Loader2 } from 'lucide-react';

// ─── Button ───────────────────────────────────────────────────────────────────

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type BtnSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: BtnSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const variantCls: Record<BtnVariant, string> = {
  primary:
    'bg-[#2d6a4f] hover:bg-[#245a41] text-white shadow-sm shadow-emerald-900/20',
  secondary:
    'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-sm',
  ghost: 'bg-transparent hover:bg-slate-100 text-slate-600',
  danger: 'bg-red-600 hover:bg-red-700 text-white shadow-sm',
};
const sizeCls: Record<BtnSize, string> = {
  sm: 'px-3 py-1.5 text-xs gap-1.5 rounded-lg',
  md: 'px-4 py-2.5 text-sm gap-2 rounded-xl',
  lg: 'px-6 py-3 text-sm gap-2.5 rounded-xl',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading,
      leftIcon,
      rightIcon,
      children,
      className = '',
      disabled,
      ...rest
    },
    ref,
  ) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-medium transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed select-none ${variantCls[variant]} ${sizeCls[size]} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin-slow" /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  ),
);
Button.displayName = 'Button';

// ─── Input ────────────────────────────────────────────────────────────────────

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftEl?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, leftEl, className = '', id, ...rest }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-slate-700"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {leftEl && (
            <span className="absolute inset-y-0 left-3 flex items-center text-slate-400 pointer-events-none">
              {leftEl}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={`w-full rounded-xl border bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition
              focus:border-[#40916c] focus:ring-3 focus:ring-[#52b788]/20
              disabled:bg-slate-50 disabled:cursor-not-allowed
              ${error ? 'border-red-400 focus:border-red-400 focus:ring-red-400/15' : 'border-slate-200'}
              ${leftEl ? 'pl-10' : ''}
              ${className}`}
            {...rest}
          />
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
    );
  },
);
Input.displayName = 'Input';

// ─── Badge ────────────────────────────────────────────────────────────────────

type BadgeColor = 'green' | 'blue' | 'amber' | 'red' | 'slate';

const badgeCls: Record<BadgeColor, string> = {
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
};

export const Badge: React.FC<{
  color?: BadgeColor;
  children: ReactNode;
  className?: string;
}> = ({ color = 'slate', children, className = '' }) => (
  <span
    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${badgeCls[color]} ${className}`}
  >
    {children}
  </span>
);

// ─── Spinner ──────────────────────────────────────────────────────────────────

export const Spinner: React.FC<{ size?: number; className?: string }> = ({
  size = 20,
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={`animate-spin-slow ${className}`}
  >
    <circle
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="3"
      strokeOpacity=".2"
    />
    <path
      d="M12 2a10 10 0 0 1 10 10"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    />
  </svg>
);

// ─── Avatar ───────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  '#2d6a4f',
  '#1e6091',
  '#7b2d8b',
  '#c44b1e',
  '#6b5a00',
  '#14532d',
];
function colorFromStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export const Avatar: React.FC<{
  name: string;
  size?: number;
  className?: string;
}> = ({ name, size = 32, className = '' }) => {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  const bg = colorFromStr(name);
  return (
    <div
      className={`flex items-center justify-center rounded-full text-white font-semibold select-none flex-shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: bg,
      }}
    >
      {initials}
    </div>
  );
};

// ─── Divider ──────────────────────────────────────────────────────────────────

export const Divider: React.FC<{ label?: string }> = ({ label }) => (
  <div className="flex items-center gap-3 my-1">
    <div className="flex-1 h-px bg-slate-200" />
    {label && (
      <span className="text-xs text-slate-400 font-medium">{label}</span>
    )}
    <div className="flex-1 h-px bg-slate-200" />
  </div>
);
