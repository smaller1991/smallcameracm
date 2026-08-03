/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html','./src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: { yellow:'#721811', red:'#721811', dark:'#3B211C', light:'#EFE8DF' }
      },
      fontFamily: { sans: ['-apple-system','BlinkMacSystemFont','SF Pro Display','SF Pro Text','Sarabun','system-ui','sans-serif'] }
    }
  },
  plugins: []
}
