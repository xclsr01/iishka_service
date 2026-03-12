import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(28 18% 82%)',
        input: 'hsl(28 18% 82%)',
        ring: 'hsl(20 78% 41%)',
        background: 'hsl(42 40% 96%)',
        foreground: 'hsl(20 30% 15%)',
        muted: 'hsl(42 30% 90%)',
        'muted-foreground': 'hsl(20 14% 40%)',
        accent: 'hsl(35 80% 52%)',
        'accent-foreground': 'hsl(20 30% 12%)',
        card: 'hsla(0 0% 100% / 0.82)',
        'card-foreground': 'hsl(20 30% 15%)',
        primary: 'hsl(20 78% 41%)',
        'primary-foreground': 'hsl(42 40% 96%)',
        secondary: 'hsl(160 35% 35%)',
        'secondary-foreground': 'hsl(42 40% 96%)',
        destructive: 'hsl(2 78% 52%)',
        'destructive-foreground': 'hsl(0 0% 100%)',
      },
      borderRadius: {
        lg: '1.25rem',
        md: '1rem',
        sm: '0.75rem',
      },
      boxShadow: {
        soft: '0 18px 46px rgba(89, 55, 24, 0.12)',
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        grain:
          'radial-gradient(circle at 1px 1px, rgba(109, 78, 53, 0.06) 1px, transparent 0)',
      },
    },
  },
  plugins: [],
};

export default config;
