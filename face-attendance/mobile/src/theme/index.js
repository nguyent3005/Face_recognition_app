// ─── Color Palette ────────────────────────────────────────────────────────────
export const colors = {
  primary: '#4F6EF7',
  primaryLight: '#EEF2FF',
  primaryDark: '#3B54C4',
  primaryGradient: ['#4F6EF7', '#6C8EFF'],

  accent: '#6366F1',
  accentLight: '#EEF2FF',

  // Subtle blue-tinted background for a cohesive indigo feel
  background: '#F0F4FF',
  backgroundDark: '#E4EAFF',
  surface: '#FFFFFF',
  surfaceElevated: '#FAFBFF',

  text: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',

  border: '#E2E8F0',
  borderLight: '#EEF2FF',

  success: '#10B981',
  successLight: '#34D399',
  successBg: '#ECFDF5',

  warning: '#F59E0B',
  warningLight: '#FBBF24',
  warningBg: '#FFFBEB',

  danger: '#EF4444',
  dangerLight: '#F87171',
  dangerBg: '#FEF2F2',

  // Gray for "unmarked / chưa điểm danh"
  gray: '#64748B',
  grayLight: '#CBD5E1',
  grayBg: '#F1F5F9',

  // Gradient pairs for stat cards
  gradientBlue:   ['#4F6EF7', '#6C8EFF'],
  gradientGreen:  ['#10B981', '#34D399'],
  gradientAmber:  ['#F59E0B', '#FBBF24'],
  gradientRed:    ['#EF4444', '#F87171'],
  gradientGray:   ['#64748B', '#94A3B8'],

  // Header gradient
  headerGradient: ['#3A52CC', '#4F6EF7'],
};

// ─── Attendance Status Helpers ────────────────────────────────────────────────
export const attendanceStatus = {
  present: {
    label: 'Có mặt',
    color: '#10B981',
    bg: '#ECFDF5',
    gradient: ['#10B981', '#34D399'],
  },
  late: {
    label: 'Đi muộn',
    color: '#F59E0B',
    bg: '#FFFBEB',
    gradient: ['#F59E0B', '#FBBF24'],
  },
  absent: {
    label: 'Vắng mặt',
    color: '#EF4444',
    bg: '#FEF2F2',
    gradient: ['#EF4444', '#F87171'],
  },
  unmarked: {
    label: 'Chưa điểm danh',
    color: '#64748B',
    bg: '#F1F5F9',
    gradient: ['#64748B', '#94A3B8'],
  },
};

// ─── Spacing ──────────────────────────────────────────────────────────────────
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

// ─── Border Radius ────────────────────────────────────────────────────────────
export const radius = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  pill: 999,
};

// ─── Shadow Presets ───────────────────────────────────────────────────────────
export const shadow = {
  sm: {
    shadowColor: '#1E3A6E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  card: {
    shadowColor: '#1E3A6E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 3,
  },
  lg: {
    shadowColor: '#1E3A6E',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.10,
    shadowRadius: 20,
    elevation: 8,
  },
  primary: {
    shadowColor: '#4F6EF7',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.30,
    shadowRadius: 12,
    elevation: 5,
  },
  header: {
    shadowColor: '#1E3A6E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
};

// ─── Typography ───────────────────────────────────────────────────────────────
export const typography = {
  h1: { fontSize: 28, fontWeight: '800', color: '#0F172A', letterSpacing: -0.5 },
  h2: { fontSize: 22, fontWeight: '800', color: '#0F172A', letterSpacing: -0.3 },
  h3: { fontSize: 18, fontWeight: '700', color: '#0F172A' },
  h4: { fontSize: 16, fontWeight: '700', color: '#0F172A' },
  body: { fontSize: 15, fontWeight: '400', color: '#0F172A', lineHeight: 22 },
  bodySmall: { fontSize: 13, fontWeight: '400', color: '#475569', lineHeight: 18 },
  caption: { fontSize: 11, fontWeight: '500', color: '#94A3B8' },
  label: { fontSize: 13, fontWeight: '600', color: '#475569' },
  mono: { fontSize: 13, fontWeight: '500', letterSpacing: 0.5 },
};
