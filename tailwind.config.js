/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html','./src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: { yellow:'#D32F23', red:'#D32F23', dark:'#1F1412', light:'#FFF7F6' }
      },
      fontFamily: { sans: ['-apple-system','BlinkMacSystemFont','SF Pro Display','SF Pro Text','Sarabun','system-ui','sans-serif'] }
    }
  },
  plugins: []
}
