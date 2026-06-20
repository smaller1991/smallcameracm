/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html','./src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: { yellow:'#007AFF', red:'#FF3B30', dark:'#1D1D1F', light:'#F5F5F7' }
      },
      fontFamily: { sans: ['-apple-system','BlinkMacSystemFont','SF Pro Text','SF Pro Display','Helvetica Neue','Sarabun','system-ui','sans-serif'] }
    }
  },
  plugins: []
}
