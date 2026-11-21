import type { Config } from 'tailwindcss';

/**
 * 视觉基线 v2（D 维护）：石灰白底、松绿主色、扶手木强调、印泥红仅用于验收章。
 * 色名沿用 v1（brand / accent / ink / line / canvas / danger / warn），已有类名无需改动。
 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#815600', hover: '#654200', soft: '#FFF0BE' },
        /** 扶手木：金额重点、待处理。accent 为兼容旧类名的别名。 */
        wood: { DEFAULT: '#855C23', soft: '#FFF3D6' },
        accent: { DEFAULT: '#855C23', soft: '#FFF3D6' },
        /** 印泥红：只用于验收章，不用于报错。 */
        seal: '#BF3A2B',
        ink: { DEFAULT: '#302A21', 2: '#5D5345', 3: '#756A59' },
        line: { DEFAULT: '#E9DFC9', strong: '#CCBB9B' },
        canvas: '#FFFCF5',
        /** 雾灰：中性浅底（信息提示、未开始状态） */
        mist: '#F5F0E5',
        danger: { DEFAULT: '#A8261F', soft: '#FBEDEB' },
        warn: { DEFAULT: '#7A5205', soft: '#FBF3E2' },
      },
      borderRadius: { panel: '16px', card: '12px', control: '8px', input: '8px', tag: '6px' },
      fontFamily: {
        sans: ['"PingFang SC"', '"HarmonyOS Sans SC"', '"Microsoft YaHei UI"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
        song: ['"Songti SC"', 'STSong', 'SimSun', 'serif'],
      },
      fontSize: {
        hero: ['40px', { lineHeight: '1.25', fontWeight: '700' }],
        meta: ['13px', { lineHeight: '1.5' }],
      },
      boxShadow: {
        float: '0 12px 32px rgba(29, 43, 41, 0.14)',
      },
    },
  },
  plugins: [],
} satisfies Config;
