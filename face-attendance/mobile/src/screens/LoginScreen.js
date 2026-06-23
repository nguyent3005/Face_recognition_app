import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import AppPressable from '../components/AppPressable';
import { LinearGradient } from 'expo-linear-gradient';
import { ShieldCheck, Eye, EyeOff, ChevronDown, ChevronUp, Wifi } from 'lucide-react-native';
import { setAccessToken, setCurrentUser } from '../utils/auth';
import { validateLogin, parseApiError } from '../utils/validation';
import { getApiBaseUrl, getApiRootForDisplay, setApiBaseUrl } from '../config/apiConfig';
import { colors, spacing, radius, shadow } from '../theme';

export default function LoginScreen({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [apiUrl, setApiUrl] = useState('');
  const [showServerConfig, setShowServerConfig] = useState(false);

  useEffect(() => {
    getApiRootForDisplay().then(setApiUrl);
  }, []);

  const handleLogin = async () => {
    const { valid, errors } = validateLogin(username, password);
    setFieldErrors(errors);
    if (!valid) return;

    setLoading(true);
    setFieldErrors({});

    try {
      if (apiUrl.trim()) await setApiBaseUrl(apiUrl.trim());
      const baseUrl = await getApiBaseUrl();
      const params = new URLSearchParams();
      params.append('username', username.trim());
      params.append('password', password);

      const response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'ngrok-skip-browser-warning': 'true',
        },
        body: params.toString(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(parseApiError(data));

      await setAccessToken(data.access_token);
      await setCurrentUser(data.user);
      onLoginSuccess?.();
    } catch (err) {
      setFieldErrors({
        form: err.message || 'Không kết nối được máy chủ. Kiểm tra backend và địa chỉ API.',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Background gradient */}
      <LinearGradient
        colors={['#3B54C4', '#4F6EF7', '#6C8EFF']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Decorative blobs */}
      <View style={styles.blob1} />
      <View style={styles.blob2} />

      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero ──────────────────────────────────────────────────────────── */}
        <View style={styles.heroSection}>
          <View style={styles.logoRing}>
            <View style={styles.logoInner}>
              <ShieldCheck color="#fff" size={30} strokeWidth={1.8} />
            </View>
          </View>
          <Text style={styles.heroTitle}>Face Attendance</Text>
          <Text style={styles.heroSub}>Hệ thống điểm danh khuôn mặt</Text>
        </View>

        {/* ── Login Card ────────────────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Đăng nhập</Text>
          <Text style={styles.cardSub}>Nhập thông tin tài khoản của bạn</Text>

          {/* Username */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Tên đăng nhập</Text>
            <TextInput
              style={[styles.input, fieldErrors.username && styles.inputError]}
              value={username}
              onChangeText={(t) => {
                setUsername(t);
                if (fieldErrors.username) setFieldErrors((e) => ({ ...e, username: null }));
              }}
              placeholder="Nhập tên đăng nhập"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {fieldErrors.username ? (
              <Text style={styles.fieldError}>{fieldErrors.username}</Text>
            ) : null}
          </View>

          {/* Password */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Mật khẩu</Text>
            <View style={styles.passwordWrapper}>
              <TextInput
                style={[styles.input, styles.passwordInput, fieldErrors.password && styles.inputError]}
                value={password}
                onChangeText={(t) => {
                  setPassword(t);
                  if (fieldErrors.password) setFieldErrors((e) => ({ ...e, password: null }));
                }}
                placeholder="Nhập mật khẩu"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showPassword}
              />
              <AppPressable
                containerStyle={styles.eyeBtn}
                style={styles.eyeBtnInner}
                onPress={() => setShowPassword(!showPassword)}
                scaleEnabled={false}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                {showPassword
                  ? <EyeOff color={colors.textMuted} size={18} />
                  : <Eye color={colors.textMuted} size={18} />}
              </AppPressable>
            </View>
            {fieldErrors.password ? (
              <Text style={styles.fieldError}>{fieldErrors.password}</Text>
            ) : null}
          </View>

          {/* Form error */}
          {fieldErrors.form ? (
            <View style={styles.errorBox}>
              <Text style={styles.formError}>{fieldErrors.form}</Text>
            </View>
          ) : null}

          {/* Login button */}
          <AppPressable
            containerStyle={[styles.loginBtn, loading && styles.loginBtnDisabled]}
            style={{ width: '100%' }}
            onPress={handleLogin}
            disabled={loading}
          >
            <LinearGradient
              colors={[colors.primary, colors.primaryDark]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.loginBtnGradient}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.loginBtnText}>Đăng nhập</Text>}
            </LinearGradient>
          </AppPressable>

          {/* Server config toggle */}
          <AppPressable
            style={styles.serverToggle}
            onPress={() => setShowServerConfig(!showServerConfig)}
            scaleTo={0.98}
          >
            <Wifi color={colors.primary} size={15} />
            <Text style={styles.serverToggleText}>Cấu hình máy chủ</Text>
            {showServerConfig
              ? <ChevronUp color={colors.textMuted} size={15} />
              : <ChevronDown color={colors.textMuted} size={15} />}
          </AppPressable>

          {showServerConfig ? (
            <View style={styles.serverBox}>
              <Text style={styles.fieldLabel}>Địa chỉ backend</Text>
              <TextInput
                style={styles.input}
                value={apiUrl}
                onChangeText={setApiUrl}
                placeholder="http://192.168.1.10:8000"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                keyboardType="url"
              />
              <Text style={styles.hint}>
                📱 Emulator Android: 10.0.2.2 · Máy thật: IP LAN máy chạy backend
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    padding: spacing.lg,
    paddingTop: spacing.xl + spacing.xl,
    paddingBottom: spacing.xl,
  },

  // Decorative blobs
  blob1: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(255,255,255,0.07)',
    top: -60,
    right: -60,
  },
  blob2: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(255,255,255,0.05)',
    bottom: 200,
    left: -60,
  },

  // ── Hero ──────────────────────────────────────────────────────────────────
  heroSection: { alignItems: 'center', marginBottom: spacing.xl },
  logoRing: {
    width: 88,
    height: 88,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  logoInner: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.4,
  },
  heroSub: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 5,
    fontWeight: '400',
  },

  // ── Card ──────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    padding: spacing.lg,
    shadowColor: '#1E1B4B',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.20,
    shadowRadius: 28,
    elevation: 14,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 4,
    letterSpacing: -0.3,
  },
  cardSub: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },

  // Fields
  fieldGroup: { marginBottom: spacing.md },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
    fontSize: 15,
    borderWidth: 1.5,
    borderColor: colors.border,
    color: colors.text,
  },
  inputError: { borderColor: colors.danger },
  passwordWrapper: { position: 'relative', width: '100%' },
  passwordInput: { paddingRight: 52 },
  eyeBtn: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    width: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  eyeBtnInner: {
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    height: '100%',
  },
  fieldError: { color: colors.danger, fontSize: 12, marginTop: 5, fontWeight: '500' },

  errorBox: {
    backgroundColor: colors.dangerBg,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginBottom: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
  },
  formError: { color: colors.danger, fontSize: 13, lineHeight: 18 },

  // Login button
  loginBtn: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginTop: spacing.sm,
    ...shadow.primary,
  },
  loginBtnDisabled: { opacity: 0.65 },
  loginBtnGradient: {
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },

  // Server config
  serverToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.md,
    paddingVertical: spacing.xs,
  },
  serverToggleText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  serverBox: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.borderLight,
  },
  hint: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: spacing.xs,
    lineHeight: 17,
  },
});
