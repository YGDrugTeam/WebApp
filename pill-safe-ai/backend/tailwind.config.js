/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 우리가 정한 '메인 사이언 블루' 색상을 'medic-main'이라는 이름으로 등록합니다.
        'medic-main': '#00B4D8',
      },
      borderRadius: {
        // 더 둥글둥글하고 세련된 모서리를 위해 '4xl'을 추가합니다.
        '4xl': '2rem',
      }
    },
  },
  plugins: [],
}