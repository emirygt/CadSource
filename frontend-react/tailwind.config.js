/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eff6ff',
          100: '#dbeafe',
          500: '#2f66eb',
          600: '#1d4ed8',
          700: '#1e40af',
        },
        sidebar: '#1e293b',
      },
    },
  },
  plugins: [],
}

