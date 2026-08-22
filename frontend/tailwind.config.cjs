const { heroui } = require('@heroui/theme')

module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    './node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: { extend: {} },
  plugins: [heroui({ addCommonColors: true })],
}
