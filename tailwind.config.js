/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html','./src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: { yellow:'#FFB833', red:'#D9281E', dark:'#2A1507', light:'#FFF1BD' }
      },
      fontFamily: { sans: ['-apple-system','BlinkMacSystemFont','SF Pro Display','SF Pro Text','Sarabun','system-ui','sans-serif'] }
    }
  },
  plugins: []
}
