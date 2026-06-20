/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html','./src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: { yellow:'#FFB838', red:'#D32F23', dark:'#1A1208', light:'#FFF8EC' }
      },
      fontFamily: { sans: ['Sarabun','system-ui','sans-serif'] }
    }
  },
  plugins: []
}
