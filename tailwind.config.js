/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {},
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
