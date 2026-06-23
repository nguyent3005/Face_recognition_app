import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  TouchableWithoutFeedback,
  Modal,
} from 'react-native';
import AppPressable from '../components/AppPressable';
import { User, LogOut, Server, Info, Lock, ChevronRight, Shield, Cpu, Mail, Phone, Edit2, X } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import ScreenHeader from '../components/ScreenHeader';
import { getCurrentUser, clearAuth } from '../utils/auth';
import { getApiRootForDisplay, setApiBaseUrl, getDefaultApiBaseUrl } from '../config/apiConfig';
import api from '../utils/api';
import { parseApiError } from '../utils/validation';
import { colors, spacing, radius, shadow } from '../theme';

export default function SettingsScreen({ onLogout }) {
  const [user, setUser] = useState(null);
  const [apiUrl, setApiUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changingPwd, setChangingPwd] = useState(false);

  const [isEditProfileVisible, setIsEditProfileVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const displayName = user?.full_name || user?.name || user?.username || 'Administrator';
  const displayEmail = user?.email || 'Chưa cập nhật';
  const displayPhone = user?.phone || user?.phone_number || 'Chưa cập nhật';

  useEffect(() => { loadUser(); loadApiUrl(); }, []);
  const loadUser = async () => setUser(await getCurrentUser());
  const loadApiUrl = async () => setApiUrl(await getApiRootForDisplay());

  const handleSaveApi = async () => {
    setSaving(true);
    try {
      await setApiBaseUrl(apiUrl.trim());
      Alert.alert('✓ Đã lưu', 'Địa chỉ máy chủ đã được cập nhật.');
    } catch {
      Alert.alert('Lỗi', 'Không thể lưu cấu hình.');
    } finally {
      setSaving(false);
    }
  };

  const handleResetApi = async () => {
    const def = getDefaultApiBaseUrl().replace(/\/api$/, '');
    setApiUrl(def);
    await setApiBaseUrl(def);
    Alert.alert('✓ Đã khôi phục', `Mặc định: ${def}`);
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword) {
      Alert.alert('Lỗi', 'Vui lòng nhập đầy đủ mật khẩu hiện tại và mật khẩu mới');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('Lỗi', 'Mật khẩu mới phải có ít nhất 6 ký tự');
      return;
    }
    setChangingPwd(true);
    try {
      const res = await api.put('/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      Alert.alert('Thành công', res.message || 'Đã đổi mật khẩu thành công');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      Alert.alert('Lỗi', parseApiError(err));
    } finally {
      setChangingPwd(false);
    }
  };

  const openEditProfileModal = () => {
    setEditName(displayName === 'Chưa cập nhật' || displayName === 'Administrator' ? '' : displayName);
    setEditEmail(displayEmail === 'Chưa cập nhật' ? '' : displayEmail);
    setEditPhone(displayPhone === 'Chưa cập nhật' ? '' : displayPhone);
    setIsEditProfileVisible(true);
  };

  const handleSaveProfile = async () => {
    const name = editName.trim();
    const email = editEmail.trim();
    const phone = editPhone.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (name.length < 2) {
      Alert.alert('Lỗi', 'Tên phải có ít nhất 2 ký tự.');
      return;
    }

    if (email && !emailRegex.test(email)) {
      Alert.alert('Lỗi', 'Email không hợp lệ.');
      return;
    }

    const phoneDigits = phone.replace(/\D/g, '');
    if (phone && phoneDigits.length < 8) {
      Alert.alert('Lỗi', 'Số điện thoại không hợp lệ.');
      return;
    }

    try {
      setIsSavingProfile(true);

      const updatedProfile = {
        full_name: name,
        email: email || null,
        phone: phone || null,
      };

      // TODO: Cập nhật gọi API backend khi sẵn sàng
      // await updateUserProfile(updatedProfile);

      setUser((prev) => ({
        ...prev,
        ...updatedProfile,
      }));

      setIsEditProfileVisible(false);
      Alert.alert('Thành công', 'Thông tin cá nhân đã được cập nhật.');
    } catch (error) {
      console.error('Update profile error:', error);
      Alert.alert('Lỗi', 'Không thể cập nhật thông tin cá nhân. Vui lòng thử lại.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Đăng xuất', 'Bạn có chắc muốn đăng xuất?', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Đăng xuất',
        style: 'destructive',
        onPress: async () => { await clearAuth(); onLogout?.(); },
      },
    ]);
  };

  const initials = user?.full_name
    ?.split(' ')
    .slice(-2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || '?';

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader title="Cài đặt" subtitle={`@${user?.username || '...'} · ${user?.role === 'teacher' ? 'Giáo viên' : 'Quản trị viên'}`} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Profile Card ─────────────────────────────────────────────────── */}
        <View style={styles.profileCard}>
          {/* Gradient banner */}
          <LinearGradient
            colors={colors.primaryGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.profileBanner}
          >
            {/* Decorative circles */}
            <View style={styles.bannerCircle1} />
            <View style={styles.bannerCircle2} />
          </LinearGradient>

          {/* Avatar (overlaps banner) */}
          <View style={styles.avatarContainer}>
            <View style={styles.avatarRing}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
            </View>
          </View>

          {/* User info */}
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{user?.full_name || 'Người dùng'}</Text>
            <Text style={styles.profileUsername}>@{user?.username || '—'}</Text>
            <View style={styles.roleBadge}>
              <Shield color={colors.primary} size={11} strokeWidth={2.5} />
              <Text style={styles.roleBadgeText}>
                {user?.role === 'teacher' ? 'Giáo viên' : 'Quản trị viên'}
              </Text>
            </View>
            <View style={styles.activeBadge}>
              <View style={styles.activeDot} />
              <Text style={styles.activeBadgeText}>Đang hoạt động</Text>
            </View>
          </View>
        </View>

        {/* ── Personal Info ─────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <View style={[styles.sectionHead, { justifyContent: 'space-between', marginBottom: spacing.md }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <View style={[styles.sectionIconWrap, { backgroundColor: colors.primaryLight }]}>
                <User color={colors.primary} size={16} />
              </View>
              <Text style={styles.sectionTitle}>Thông tin cá nhân</Text>
            </View>
            <AppPressable onPress={openEditProfileModal} style={styles.editBtn} scaleTo={0.98}>
              <Edit2 color={colors.primary} size={15} />
              <Text style={styles.editBtnText}>Chỉnh sửa</Text>
            </AppPressable>
          </View>

          <View style={styles.infoRow}>
            <View style={styles.infoLabelRow}>
              <User color={colors.textMuted} size={15} />
              <Text style={styles.infoLabel}>Tên</Text>
            </View>
            <Text style={[styles.infoValue, displayName === 'Chưa cập nhật' && { color: colors.textMuted, fontWeight: '400' }]}>
              {displayName}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoLabelRow}>
              <Mail color={colors.textMuted} size={15} />
              <Text style={styles.infoLabel}>Email</Text>
            </View>
            <Text style={[styles.infoValue, displayEmail === 'Chưa cập nhật' && { color: colors.textMuted, fontWeight: '400' }]}>
              {displayEmail}
            </Text>
          </View>
          <View style={[styles.infoRow, { borderBottomWidth: 0, paddingBottom: 0 }]}>
            <View style={styles.infoLabelRow}>
              <Phone color={colors.textMuted} size={15} />
              <Text style={styles.infoLabel}>Số điện thoại</Text>
            </View>
            <Text style={[styles.infoValue, displayPhone === 'Chưa cập nhật' && { color: colors.textMuted, fontWeight: '400' }]}>
              {displayPhone}
            </Text>
          </View>
        </View>

        {/* ── Server Config ─────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <View style={[styles.sectionIconWrap, { backgroundColor: colors.primaryLight }]}>
              <Server color={colors.primary} size={16} />
            </View>
            <Text style={styles.sectionTitle}>Máy chủ Backend</Text>
          </View>
          <Text style={styles.sectionHint}>
            Nhập địa chỉ máy tính chạy API.{'\n'}
            <Text style={{ fontWeight: '700', color: colors.text }}>
              VD: http://192.168.1.10:8000
            </Text>
          </Text>
          <TextInput
            style={styles.input}
            value={apiUrl}
            onChangeText={setApiUrl}
            placeholder="http://192.168.1.10:8000"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <View style={styles.btnRow}>
            <AppPressable
              containerStyle={[styles.primaryBtn, saving && { opacity: 0.6 }]}
              style={styles.btnInner}
              onPress={handleSaveApi}
              disabled={saving}
              scaleTo={0.97}
            >
              <Text style={styles.primaryBtnText}>{saving ? 'Đang lưu...' : 'Lưu địa chỉ'}</Text>
            </AppPressable>
            <AppPressable
              containerStyle={styles.outlineBtn}
              style={styles.btnInner}
              onPress={handleResetApi}
              scaleTo={0.97}
            >
              <Text style={styles.outlineBtnText}>Mặc định</Text>
            </AppPressable>
          </View>
        </View>

        {/* ── App Info ──────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <View style={[styles.sectionIconWrap, { backgroundColor: colors.successBg }]}>
              <Info color={colors.success} size={16} />
            </View>
            <Text style={styles.sectionTitle}>Thông tin ứng dụng</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Phiên bản</Text>
            <Text style={styles.infoValue}>1.0.0</Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoLabelRow}>
              <Cpu color={colors.textMuted} size={13} />
              <Text style={styles.infoLabel}>Model</Text>
            </View>
            <Text style={styles.infoValue}>iResNet50 · ArcFace</Text>
          </View>
          <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.infoLabel}>Công nghệ</Text>
            <Text style={styles.infoValue}>PyTorch · FastAPI</Text>
          </View>
        </View>

        {/* ── Change Password ───────────────────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <View style={[styles.sectionIconWrap, { backgroundColor: colors.dangerBg }]}>
              <Lock color={colors.danger} size={16} />
            </View>
            <Text style={styles.sectionTitle}>Đổi mật khẩu</Text>
          </View>
          <TextInput
            style={styles.input}
            value={currentPassword}
            onChangeText={setCurrentPassword}
            placeholder="Mật khẩu hiện tại"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
          />
          <TextInput
            style={styles.input}
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="Mật khẩu mới (ít nhất 6 ký tự)"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
          />
          <AppPressable
            containerStyle={[
              styles.primaryBtn,
              { backgroundColor: colors.danger },
              changingPwd && { opacity: 0.6 },
            ]}
            style={styles.btnInner}
            onPress={handleChangePassword}
            disabled={changingPwd}
            scaleTo={0.97}
          >
            <Text style={styles.primaryBtnText}>
              {changingPwd ? 'Đang xử lý...' : 'Đổi mật khẩu'}
            </Text>
          </AppPressable>
        </View>

        {/* ── Logout ────────────────────────────────────────────────────────── */}
        <AppPressable
          containerStyle={styles.logoutBtn}
          style={styles.logoutBtnInner}
          onPress={handleLogout}
          scaleTo={0.98}
        >
          <View style={styles.logoutLeft}>
            <View style={styles.logoutIconWrap}>
              <LogOut color={colors.danger} size={18} strokeWidth={2} />
            </View>
            <Text style={styles.logoutText}>Đăng xuất</Text>
          </View>
          <ChevronRight color={colors.danger} size={18} />
        </AppPressable>

        <View style={{ height: 110 }} />
      </ScrollView>

      {/* ── Edit Profile Modal ────────────────────────────────────────────── */}
      <Modal
        visible={isEditProfileVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIsEditProfileVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.editProfileOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.editProfileBackdrop}>
              <View style={styles.editProfileModal}>
                <View style={styles.editProfileHeader}>
                  <Text style={styles.editProfileTitle}>Chỉnh sửa thông tin cá nhân</Text>
                  <AppPressable
                    onPress={() => setIsEditProfileVisible(false)}
                    disabled={isSavingProfile}
                    scaleEnabled={false}
                  >
                    <X size={22} color="#6B7280" />
                  </AppPressable>
                </View>

                <View style={styles.editInputGroup}>
                  <Text style={styles.editInputLabel}>Tên hiển thị</Text>
                  <TextInput
                    style={styles.editInput}
                    value={editName}
                    onChangeText={setEditName}
                    placeholder="Nhập tên của bạn"
                    placeholderTextColor="#98A2B3"
                  />
                </View>

                <View style={styles.editInputGroup}>
                  <Text style={styles.editInputLabel}>Email</Text>
                  <TextInput
                    style={styles.editInput}
                    value={editEmail}
                    onChangeText={setEditEmail}
                    placeholder="Nhập địa chỉ email"
                    placeholderTextColor="#98A2B3"
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>

                <View style={styles.editInputGroup}>
                  <Text style={styles.editInputLabel}>Số điện thoại</Text>
                  <TextInput
                    style={styles.editInput}
                    value={editPhone}
                    onChangeText={setEditPhone}
                    placeholder="Nhập số điện thoại"
                    placeholderTextColor="#98A2B3"
                    keyboardType="phone-pad"
                  />
                </View>

                <View style={styles.editProfileActions}>
                  <AppPressable
                    containerStyle={styles.cancelButton}
                    style={styles.btnInner}
                    onPress={() => setIsEditProfileVisible(false)}
                    disabled={isSavingProfile}
                    scaleEnabled={false}
                  >
                    <Text style={styles.cancelButtonText}>Hủy</Text>
                  </AppPressable>
 
                  <AppPressable
                    containerStyle={[styles.saveButton, isSavingProfile && styles.saveButtonDisabled]}
                    style={styles.btnInner}
                    onPress={handleSaveProfile}
                    disabled={isSavingProfile}
                    scaleEnabled={false}
                  >
                    <Text style={styles.saveButtonText}>
                      {isSavingProfile ? 'Đang lưu...' : 'Lưu thay đổi'}
                    </Text>
                  </AppPressable>
                </View>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.md, paddingBottom: 90 },

  // ── Profile Card ──────────────────────────────────────────────────────────
  profileCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    marginBottom: spacing.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderLight,
    ...shadow.card,
  },
  profileBanner: {
    height: 100,
    overflow: 'hidden',
    position: 'relative',
  },
  bannerCircle1: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.1)',
    top: -30,
    right: -20,
  },
  bannerCircle2: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.08)',
    bottom: -20,
    left: 40,
  },
  avatarContainer: {
    alignItems: 'center',
    marginTop: -38,
  },
  avatarRing: {
    padding: 3,
    borderRadius: radius.xxl,
    backgroundColor: colors.surface,
  },
  avatar: {
    width: 66,
    height: 66,
    borderRadius: radius.xl,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { fontSize: 24, fontWeight: '800', color: '#fff' },
  profileInfo: { alignItems: 'center', padding: spacing.md, paddingTop: spacing.sm },
  profileName: { fontSize: 20, fontWeight: '800', color: colors.text, letterSpacing: -0.3, marginBottom: 3 },
  profileUsername: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.sm },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    marginBottom: spacing.xs,
  },
  roleBadgeText: { fontSize: 12, fontWeight: '700', color: colors.primary },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.successBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  activeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  activeBadgeText: { fontSize: 11, fontWeight: '700', color: colors.success },

  // ── Section ───────────────────────────────────────────────────────────────
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    ...shadow.card,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  sectionIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  sectionHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    lineHeight: 18,
  },

  // Input
  input: {
    width: '100%',
    alignSelf: 'stretch',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 14,
    backgroundColor: colors.background,
    marginBottom: spacing.sm,
    color: colors.text,
  },

  // Buttons
  btnRow: { flexDirection: 'row', gap: 12, width: '100%', marginTop: 2 },
  primaryBtn: {
    flex: 1.2,
    backgroundColor: colors.primary,
    height: 52,
    borderRadius: radius.md,
    overflow: 'hidden',
    ...shadow.primary,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14, textAlign: 'center' },
  outlineBtn: {
    flex: 1,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  outlineBtnText: { color: colors.textSecondary, fontWeight: '600', fontSize: 14, textAlign: 'center' },
  btnInner: {
    flex: 1,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // App info rows
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  infoLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  infoLabel: { fontSize: 13, color: colors.textSecondary },
  infoValue: { fontSize: 13, fontWeight: '600', color: colors.text },

  // Logout button
  logoutBtn: {
    borderRadius: radius.xxl,
    borderWidth: 1.5,
    borderColor: colors.dangerBg,
    ...shadow.card,
    overflow: 'hidden',
  },
  logoutBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    padding: spacing.md,
    width: '100%',
  },
  logoutLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logoutIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: colors.dangerBg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoutText: { color: colors.danger, fontSize: 15, fontWeight: '700' },

  // Edit Profile section
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  editBtnText: { color: colors.primary, fontSize: 13, fontWeight: '600' },

  // Edit Modal Styles
  editProfileOverlay: { flex: 1 },
  editProfileBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  editProfileModal: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 28,
  },
  editProfileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  editProfileTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.2,
  },
  editInputGroup: { marginBottom: 16 },
  editInputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 8,
  },
  editInput: {
    height: 52,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#E5EAF3',
    backgroundColor: '#F8FAFF',
    paddingHorizontal: 16,
    fontSize: 15,
    color: '#111827',
  },
  editProfileActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  cancelButton: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#E5EAF3',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#374151',
    textAlign: 'center',
  },
  saveButton: {
    flex: 1.4,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.primary,
    ...shadow.primary,
    overflow: 'hidden',
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  sliderContainer: {
    marginVertical: spacing.sm,
    paddingHorizontal: 4,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sliderLabelText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  sliderDescription: {
    fontSize: 11,
    color: colors.textMuted,
    lineHeight: 16,
    marginTop: spacing.xs,
  },
});
