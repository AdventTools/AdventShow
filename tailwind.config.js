/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Urmează tema interfeței (data-theme pe <html>, variabilele din App.css).
        // fg = cerneala panourilor: albă în tema închisă, aproape neagră în cea
        // deschisă — `text-fg/40` e vechiul `text-white/40`, identic în tema închisă.
        // sunk = fundalul zonelor adâncite (neagră în tema închisă, albă în cea deschisă).
        fg: 'rgb(var(--fg-rgb) / <alpha-value>)',
        sunk: 'rgb(var(--sunk-rgb) / <alpha-value>)',
      },
    },
  },
  plugins: [
    require('daisyui'),
  ],
  daisyui: {
    themes: ['night', 'light'],   // night = implicit (întunecat); light = tema deschisă din Setări
    darkTheme: 'night',
    base: true,
    styled: true,
    utils: true,
    logs: false,
  },
}
