import React from 'react';

type Variant = 'solid' | 'outline' | 'ghost';
type Color = 'primary' | 'neutral' | 'danger';

const base =
  'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none';

const variants: Record<Variant, Record<Color, string>> = {
  solid: {
    primary: 'bg-blue-600 hover:bg-blue-500 text-white',
    neutral: 'bg-neutral-800 hover:bg-neutral-700 text-neutral-100',
    danger: 'bg-rose-600 hover:bg-rose-500 text-white',
  },
  outline: {
    primary: 'border border-blue-600 text-blue-400 hover:bg-blue-600/10',
    neutral: 'border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60',
    danger: 'border border-rose-600 text-rose-400 hover:bg-rose-600/10',
  },
  ghost: {
    primary: 'text-blue-400 hover:bg-blue-600/10',
    neutral: 'text-neutral-200 hover:bg-neutral-800/60',
    danger: 'text-rose-400 hover:bg-rose-600/10',
  },
};

export function Button({
  variant = 'solid',
  color = 'neutral',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; color?: Color }) {
  return <button className={`${base} ${variants[variant][color]} px-3 py-1.5 ${className}`} {...props} />;
}

export function IconButton({
  variant = 'ghost',
  color = 'neutral',
  className = '',
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; color?: Color }) {
  return (
    <button
      className={`${base} ${variants[variant][color]} h-9 w-9 p-0 ${className}`}
      aria-label={props['aria-label']}
      {...props}
    >
      {children}
    </button>
  );
}