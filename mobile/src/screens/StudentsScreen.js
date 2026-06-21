import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
} from 'react-native';
import { Search, ChevronLeft, Filter, Camera, Image as ImageIcon, X, Trash2 } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import api from '../utils/api';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, radius, shadow } from '../theme';
import AppPressable from '../components/AppPressable';

const AVATAR_COLORS = [
  ['#4F6EF7', '#EEF2FF'],
  ['#10B981', '#ECFDF5'],
  ['#F59E0B', '#FFFBEB'],
  ['#EF4444', '#FEF2F2'],
  ['#8B5CF6', '#F5F3FF'],
  ['#EC4899', '#FDF2F8'],
];
function getAvatarColors(name = '') {
  const idx = (name.charCodeAt(0) || 0) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
}

const FILTERS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'present', label: 'Có mặt' },
  { key: 'absent', label: 'Vắng' },
  { key: 'not_checked_in', label: 'Chưa điểm danh' },
  { key: 'no_face', label: 'Chưa ĐK mặt' },
];

export default function StudentsScreen({ route, navigation }) {
  const session_id = route?.params?.session_id;

  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [error, setError] = useState(null);

  // Add Student state
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({ student_code: '', full_name: '', phone: '', email: '' });
  const [formErrors, setFormErrors] = useState({});
  const [faceImage, setFaceImage] = useState(null);
  const [addEnrollMethod, setAddEnrollMethod] = useState('photo');
  const [addEnrollVideoUri, setAddEnrollVideoUri] = useState(null);
  
  const [deletingId, setDeletingId] = useState(null);

  // Face Registration state
  const [isFaceModalVisible, setIsFaceModalVisible] = useState(false);
  const [registeringStudent, setRegisteringStudent] = useState(null);
  const [isRegisteringFace, setIsRegisteringFace] = useState(false);
  const [newFaceImage, setNewFaceImage] = useState(null);
  const [faceEnrollMethod, setFaceEnrollMethod] = useState('photo');
  const [faceEnrollVideoUri, setFaceEnrollVideoUri] = useState(null);
  const [faceError, setFaceError] = useState('');

  const loadData = async () => {
    if (!session_id) {
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const res = await api.getSessionStudents(session_id);
      setStudents(res || []);
    } catch (err) {
      setError('Không tải được danh sách sinh viên: ' + err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(useCallback(() => {
    loadData();
  }, [session_id]));

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'present': return colors.success;
      case 'late': return colors.warning;
      case 'absent': return colors.danger;
      default: return colors.textSecondary;
    }
  };
  
  const getStatusBgColor = (status) => {
    switch (status) {
      case 'present': return colors.successBg;
      case 'late': return colors.warningBg;
      case 'absent': return colors.dangerBg;
      default: return colors.backgroundDark;
    }
  };
  
  const getStatusLabel = (status) => {
    switch (status) {
      case 'present': return 'Có mặt';
      case 'late': return 'Đi muộn';
      case 'absent': return 'Vắng';
      default: return 'Chưa điểm danh';
    }
  };

  const formatTime = (ts) => {
    if (!ts) return '—';
    return new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  };

  const handleStudentIdChange = (text) => {
    const onlyNumbers = text.replace(/[^0-9]/g, '');
    const limited = onlyNumbers.slice(0, 7);
    setFormData(prev => ({ ...prev, student_code: limited }));
  };

  const validateForm = () => {
    const errors = {};
    const { student_code, full_name, phone, email } = formData;
    
    if (!student_code) {
      errors.student_code = 'Vui lòng nhập MSSV';
    } else if (!/^\d{7}$/.test(student_code)) {
      errors.student_code = 'MSSV phải là 7 chữ số';
    }

    if (!full_name || !full_name.trim()) {
      errors.full_name = 'Vui lòng nhập họ và tên';
    } else if (!/^[a-zA-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠàáâãèéêìíòóôõùúăđĩũơƯĂẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼỀỀỂưăạảấầẩẫậắằẳẵặẹẻẽềềểỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪễệỉịọỏốồổỗộớờởỡợụủứừỮỰỲỴÝỶỸửữựỳỵỷỹ\s]+$/.test(full_name)) {
      errors.full_name = 'Họ và tên chỉ được chứa chữ cái và khoảng trắng';
    }

    if (phone && phone.trim()) {
      if (!/^\d{9,11}$/.test(phone)) {
        errors.phone = 'Số điện thoại không hợp lệ';
      }
    }

    if (email && email.trim()) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.email = 'Email không hợp lệ';
      }
    }

    if (addEnrollMethod === 'photo' && !faceImage) {
      errors.face_image = 'Vui lòng đăng ký khuôn mặt cho sinh viên';
    } else if (addEnrollMethod === 'video' && !addEnrollVideoUri) {
      errors.face_video = 'Vui lòng quay video để đăng ký khuôn mặt';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Lỗi', 'Cần quyền truy cập thư viện ảnh để tiếp tục!');
      return;
    }

    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
    });

    if (!result.canceled) {
      setFaceImage(result.assets[0]);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Lỗi', 'Cần quyền truy cập camera để tiếp tục!');
      return;
    }

    let result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.8,
    });

    if (!result.canceled) {
      setFaceImage(result.assets[0]);
    }
  };

  const pickNewFaceImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Lỗi', 'Cần quyền truy cập thư viện ảnh để tiếp tục!');
      return;
    }
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
    });
    if (!result.canceled) {
      setNewFaceImage(result.assets[0]);
      setFaceError('');
    }
  };

  const takeNewFacePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Lỗi', 'Cần quyền truy cập camera để tiếp tục!');
      return;
    }
    let result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.8,
    });
    if (!result.canceled) {
      setNewFaceImage(result.assets[0]);
      setFaceError('');
    }
  };

  const recordVideoForAdd = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Lỗi', 'Cần quyền truy cập camera để tiếp tục!');
      return;
    }
    let result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['videos'],
      videoMaxDuration: 2,
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      setAddEnrollVideoUri(result.assets[0].uri);
    }
  };

  const recordVideoForUpdate = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Lỗi', 'Cần quyền truy cập camera để tiếp tục!');
      return;
    }
    let result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['videos'],
      videoMaxDuration: 2,
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      setFaceEnrollVideoUri(result.assets[0].uri);
      setFaceError('');
    }
  };

  const openFaceRegisterModal = (student) => {
    setRegisteringStudent(student);
    setNewFaceImage(null);
    setFaceEnrollVideoUri(null);
    setFaceEnrollMethod('photo');
    setFaceError('');
    setIsFaceModalVisible(true);
  };

  const closeFaceRegisterModal = () => {
    if (isRegisteringFace) return;
    setIsFaceModalVisible(false);
    setNewFaceImage(null);
    setFaceEnrollVideoUri(null);
    setFaceEnrollMethod('photo');
    setRegisteringStudent(null);
    setFaceError('');
  };

  const handleRegisterFace = async () => {
    if (faceEnrollMethod === 'photo') {
      if (!newFaceImage) {
        setFaceError('Vui lòng chọn hoặc chụp ảnh khuôn mặt');
        return;
      }
      setIsRegisteringFace(true);
      setFaceError('');
      try {
        const data = new FormData();
        const filename = newFaceImage.uri.split('/').pop();
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : `image`;
        
        data.append('face_image', {
          uri: newFaceImage.uri,
          name: filename,
          type,
        });

        await api.registerStudentFace(registeringStudent.id || registeringStudent.student_id, data);
        closeFaceRegisterModal();
        Alert.alert('Thành công', 'Đăng ký khuôn mặt thành công!');
        loadData();
      } catch (err) {
        setFaceError(err.message || 'Có lỗi xảy ra');
      } finally {
        setIsRegisteringFace(false);
      }
    } else {
      if (!faceEnrollVideoUri) {
        setFaceError('Vui lòng quay video khuôn mặt');
        return;
      }
      setIsRegisteringFace(true);
      setFaceError('');
      try {
        const videoData = new FormData();
        const filename = faceEnrollVideoUri.split('/').pop() || 'face_enroll.mp4';
        videoData.append('face_video', {
          uri: faceEnrollVideoUri,
          name: filename,
          type: 'video/mp4',
        });

        await api.registerFaceVideo(registeringStudent.id || registeringStudent.student_id, videoData);
        closeFaceRegisterModal();
        Alert.alert('Thành công', 'Đăng ký khuôn mặt bằng video thành công!');
        loadData();
      } catch (err) {
        setFaceError(err.message || 'Có lỗi xảy ra');
      } finally {
        setIsRegisteringFace(false);
      }
    }
  };

  const handleAddStudent = async () => {
    if (!validateForm()) return;
    
    setIsSubmitting(true);
    try {
      if (addEnrollMethod === 'photo') {
        const data = new FormData();
        data.append('student_code', formData.student_code);
        data.append('full_name', formData.full_name);
        if (formData.phone) data.append('phone', formData.phone);
        if (formData.email) data.append('email', formData.email);
        data.append('session_id', session_id);
        
        const filename = faceImage.uri.split('/').pop();
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : `image`;
        
        data.append('face_image', {
          uri: faceImage.uri,
          name: filename,
          type,
        });

        await api.createStudentWithFace(data);
        Alert.alert('Thành công', 'Thêm sinh viên và đăng ký khuôn mặt thành công!');
      } else {
        // Create student via text first
        const studentPayload = {
          student_code: formData.student_code,
          full_name: formData.full_name,
          phone: formData.phone || null,
          email: formData.email || null,
          session_id: session_id ? Number(session_id) : null,
        };

        const studentRes = await api.createStudent(studentPayload);
        const studentId = studentRes.id;

        // Register face via video
        const videoData = new FormData();
        const filename = addEnrollVideoUri.split('/').pop() || 'face_enroll.mp4';
        videoData.append('face_video', {
          uri: addEnrollVideoUri,
          name: filename,
          type: 'video/mp4',
        });

        try {
          await api.registerFaceVideo(studentId, videoData);
          Alert.alert('Thành công', 'Thêm sinh viên và đăng ký khuôn mặt bằng video thành công!');
        } catch (videoErr) {
          console.log('Video registration error:', videoErr);
          const detailMsg = videoErr.data?.detail || videoErr.message || 'Lỗi xử lý video';
          Alert.alert(
            'Thông báo',
            `Thêm sinh viên thành công nhưng đăng ký khuôn mặt thất bại. Lỗi: ${detailMsg}. Bạn có thể đăng ký lại sau.`
          );
        }
      }
      
      setIsModalVisible(false);
      setFormData({ student_code: '', full_name: '', phone: '', email: '' });
      setFaceImage(null);
      setAddEnrollVideoUri(null);
      setAddEnrollMethod('photo');
      loadData();
    } catch (err) {
      Alert.alert('Lỗi', err.message || 'Có lỗi xảy ra');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteStudent = (student) => {
    Alert.alert(
      'Xoá sinh viên?',
      `Bạn có chắc chắn muốn xoá sinh viên ${student.full_name} không? Dữ liệu khuôn mặt và lịch sử điểm danh liên quan cũng sẽ bị xoá.`,
      [
        { text: 'Huỷ', style: 'cancel' },
        {
          text: 'Xoá',
          style: 'destructive',
          onPress: async () => {
            const targetId = student.id || student.student_id;
            setDeletingId(targetId);
            try {
              await api.deleteStudent(targetId);
              Alert.alert('Thành công', 'Xoá sinh viên thành công');
              loadData();
            } catch (err) {
              const msg = err.data?.detail || err.message || 'Xóa thất bại';
              Alert.alert('Lỗi', msg);
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  };

  if (!session_id) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.errorText}>Thiếu thông tin ca học (session_id).</Text>
        <AppPressable style={styles.btnSecondary} onPress={() => navigation.goBack()}>
          <Text style={styles.btnSecondaryText}>Quay lại</Text>
        </AppPressable>
      </SafeAreaView>
    );
  }

  const canSubmit =
    formData.student_code?.length === 7 &&
    formData.full_name?.trim().length > 0 &&
    (addEnrollMethod === 'photo' ? !!faceImage : !!addEnrollVideoUri);

  const filtered = students.filter(s => {
    const matchSearch = s.full_name?.toLowerCase().includes(search.toLowerCase()) ||
                        s.student_code?.toLowerCase().includes(search.toLowerCase());
    const matchFilter = activeFilter === 'all' 
      ? true 
      : activeFilter === 'present'
        ? (s.status === 'present' || s.status === 'late')
        : activeFilter === 'no_face'
          ? !s.face_registered
          : (s.status === activeFilter);
    return matchSearch && matchFilter;
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <AppPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <ChevronLeft color={colors.text} size={24} />
        </AppPressable>
        <Text style={styles.headerTitle}>Danh sách sinh viên</Text>
        <AppPressable style={styles.addBtn} onPress={() => setIsModalVisible(true)}>
          <Text style={styles.addBtnText}>+ Thêm SV</Text>
        </AppPressable>
      </View>

      {/* Toolbar */}
      <View style={styles.toolbar}>
        <View style={styles.searchWrap}>
          <Search color={colors.textMuted} size={18} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Tìm theo tên, mã SV..."
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>

      {/* Filters */}
      <View style={styles.filtersWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersScroll}>
          {FILTERS.map(f => {
            const isActive = activeFilter === f.key;
            const count = f.key === 'all' 
              ? students.length 
              : f.key === 'present'
                ? students.filter(s => s.status === 'present' || s.status === 'late').length
                : f.key === 'no_face'
                  ? students.filter(s => !s.face_registered).length
                  : students.filter(s => s.status === f.key).length;
            return (
              <AppPressable
                key={f.key}
                containerStyle={[styles.filterChip, isActive && styles.filterChipActive]}
                style={styles.filterChipInner}
                onPress={() => setActiveFilter(f.key)}
                scaleEnabled={false}
              >
                <Text style={[styles.filterText, isActive && styles.filterTextActive]}>{f.label}</Text>
                <View style={[styles.filterBadge, isActive && styles.filterBadgeActive]}>
                  <Text style={[styles.filterBadgeText, isActive && styles.filterBadgeTextActive]}>{count}</Text>
                </View>
              </AppPressable>
            );
          })}
        </ScrollView>
      </View>

      {error && (
        <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.md }}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 120 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        >
          {filtered.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyIcon}>📭</Text>
              <Text style={styles.emptyText}>
                {activeFilter === 'no_face' 
                  ? 'Không có sinh viên chưa đăng ký khuôn mặt' 
                  : 'Không tìm thấy sinh viên nào'}
              </Text>
            </View>
          ) : (
            filtered.map((student) => {
              const [fg, bg] = getAvatarColors(student.full_name);
              const initials = student.full_name?.[0]?.toUpperCase() || '?';
              return (
                <View key={student.id || student.student_id || student.student_code} style={styles.card}>
                  <View style={styles.cardTopRow}>
                    <View style={[styles.avatar, { backgroundColor: bg }]}>
                      <Text style={[styles.avatarText, { color: fg }]}>{initials}</Text>
                    </View>
                    <View style={styles.studentInfo}>
                      <Text style={styles.name} numberOfLines={2}>{student.full_name}</Text>
                      <Text style={styles.code}>{student.student_code}</Text>
                      {student.checkin_time && (
                        <Text style={styles.time}>Điểm danh lúc: {formatTime(student.checkin_time)}</Text>
                      )}
                    </View>
                    <View style={styles.statusColumn}>
                      {/* Status Badge */}
                      <View style={[styles.badge, { backgroundColor: getStatusBgColor(student.status) }]}>
                        <Text style={[styles.badgeText, { color: getStatusColor(student.status) }]}>
                          {getStatusLabel(student.status)}
                        </Text>
                      </View>
                      {/* Face Badge */}
                      <View style={[styles.faceBadge, { backgroundColor: student.face_registered ? colors.successBg : colors.backgroundDark }]}>
                        <Text style={[styles.faceBadgeText, { color: student.face_registered ? colors.success : colors.textSecondary }]}>
                          {student.face_registered ? 'Đã đăng ký' : 'Chưa đăng ký'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.cardDivider} />

                  <View style={styles.actionRow}>
                    <AppPressable 
                      style={styles.actionBtn}
                      onPress={() => openFaceRegisterModal(student)}
                      scaleEnabled={false}
                    >
                      <Camera color={colors.primary} size={16} />
                      <Text style={styles.actionBtnText}>{student.face_registered ? 'Cập nhật khuôn mặt' : 'Đăng ký'}</Text>
                    </AppPressable>

                    <AppPressable 
                      style={styles.deleteBtn}
                      onPress={() => handleDeleteStudent(student)}
                      disabled={deletingId === (student.id || student.student_id)}
                      scaleEnabled={false}
                    >
                      {deletingId === (student.id || student.student_id) ? (
                        <ActivityIndicator size="small" color={colors.danger} />
                      ) : (
                        <Trash2 color={colors.danger} size={18} />
                      )}
                    </AppPressable>
                  </View>
                </View>
              );
            })
          )}
          <View style={{ height: 100 }} />
        </ScrollView>
      )}

      {/* Modal Add Student */}
      <Modal
        visible={isModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIsModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalKeyboardView}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableWithoutFeedback onPress={() => setIsModalVisible(false)}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={styles.addStudentModal}>
                  <ScrollView
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={styles.addStudentScrollContent}
                  >
                    <Text style={styles.addStudentTitle}>Thêm sinh viên</Text>

                    <View style={styles.formGroup}>
                      <Text style={styles.formLabel}>MSSV <Text style={styles.required}>*</Text></Text>
                      <TextInput
                        style={[styles.formInput, formErrors.student_code && styles.inputError]}
                        placeholder="Nhập MSSV"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="number-pad"
                        inputMode="numeric"
                        maxLength={7}
                        value={formData.student_code}
                        onChangeText={handleStudentIdChange}
                      />
                      {formErrors.student_code ? <Text style={styles.errorHelper}>{formErrors.student_code}</Text> : null}
                    </View>

                    <View style={styles.formGroup}>
                      <Text style={styles.formLabel}>Họ và tên <Text style={styles.required}>*</Text></Text>
                      <TextInput
                        style={[styles.formInput, formErrors.full_name && styles.inputError]}
                        placeholder="Nhập họ và tên sinh viên"
                        placeholderTextColor={colors.textMuted}
                        value={formData.full_name}
                        onChangeText={(text) => setFormData(prev => ({ ...prev, full_name: text }))}
                      />
                      {formErrors.full_name ? <Text style={styles.errorHelper}>{formErrors.full_name}</Text> : null}
                    </View>

                    <View style={styles.formGroup}>
                      <Text style={styles.formLabel}>Số điện thoại</Text>
                      <TextInput
                        style={[styles.formInput, formErrors.phone && styles.inputError]}
                        placeholder="Nhập số điện thoại"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="phone-pad"
                        value={formData.phone}
                        onChangeText={(text) => setFormData(prev => ({ ...prev, phone: text }))}
                      />
                      {formErrors.phone ? <Text style={styles.errorHelper}>{formErrors.phone}</Text> : null}
                    </View>

                    <View style={styles.formGroup}>
                      <Text style={styles.formLabel}>Email</Text>
                      <TextInput
                        style={[styles.formInput, formErrors.email && styles.inputError]}
                        placeholder="Nhập email sinh viên"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        value={formData.email}
                        onChangeText={(text) => setFormData(prev => ({ ...prev, email: text }))}
                      />
                      {formErrors.email ? <Text style={styles.errorHelper}>{formErrors.email}</Text> : null}
                    </View>

                    <View style={styles.formGroup}>
                      <Text style={styles.formLabel}>Phương thức đăng ký khuôn mặt</Text>
                      <View style={styles.methodTabs}>
                        <AppPressable
                          containerStyle={{ flex: 1, height: '100%' }}
                          style={[styles.methodTab, addEnrollMethod === 'photo' && styles.methodTabActive]}
                          onPress={() => setAddEnrollMethod('photo')}
                          scaleEnabled={false}
                        >
                          <Text style={[styles.methodTabText, addEnrollMethod === 'photo' && styles.methodTabTextActive]}>Đăng ký bằng ảnh</Text>
                        </AppPressable>
                        <AppPressable
                          containerStyle={{ flex: 1, height: '100%' }}
                          style={[styles.methodTab, addEnrollMethod === 'video' && styles.methodTabActive]}
                          onPress={() => setAddEnrollMethod('video')}
                          scaleEnabled={false}
                        >
                          <Text style={[styles.methodTabText, addEnrollMethod === 'video' && styles.methodTabTextActive]}>Đăng ký bằng video</Text>
                        </AppPressable>
                      </View>
                    </View>

                    {addEnrollMethod === 'photo' ? (
                      <View style={styles.formGroup}>
                        <Text style={styles.formLabel}>Ảnh đăng ký <Text style={styles.required}>*</Text></Text>
                        <Text style={styles.subLabel}>Chụp ảnh rõ mặt hoặc chọn ảnh có sẵn để đăng ký nhận diện khuôn mặt.</Text>
                        
                        {faceImage ? (
                          <View style={styles.facePreviewSection}>
                            <Image source={{ uri: faceImage.uri }} style={styles.facePreviewImage} />
                            <AppPressable style={styles.removeFaceImageButton} onPress={() => setFaceImage(null)} scaleEnabled={false}>
                              <X color="#fff" size={18} />
                            </AppPressable>
                          </View>
                        ) : (
                          <View style={styles.facePickActions}>
                            <AppPressable
                              containerStyle={{ flex: 1 }}
                              style={styles.facePickButton}
                              onPress={takePhoto}
                              scaleTo={0.96}
                            >
                              <Camera color={colors.primary} size={24} style={{ marginBottom: 10, alignSelf: 'center' }} />
                              <Text style={styles.facePickButtonText}>Chụp ảnh</Text>
                            </AppPressable>
                            <AppPressable
                              containerStyle={{ flex: 1 }}
                              style={styles.facePickButton}
                              onPress={pickImage}
                              scaleTo={0.96}
                            >
                              <ImageIcon color={colors.primary} size={24} style={{ marginBottom: 10, alignSelf: 'center' }} />
                              <Text style={styles.facePickButtonText}>Tải ảnh</Text>
                            </AppPressable>
                          </View>
                        )}
                        {formErrors.face_image ? <Text style={styles.errorHelper}>{formErrors.face_image}</Text> : null}
                      </View>
                    ) : (
                      <View style={styles.formGroup}>
                        <Text style={styles.formLabel}>Video đăng ký <Text style={styles.required}>*</Text></Text>
                        <Text style={styles.subLabel}>Quay video ngắn 2 giây rõ mặt để đăng ký nhận diện khuôn mặt (chỉ chứa một người).</Text>
                        
                        {addEnrollVideoUri ? (
                          <View style={{ width: '100%' }}>
                            <View style={styles.videoSuccessBox}>
                              <Text style={styles.videoSuccessText}>✓ Đã quay video thành công</Text>
                            </View>
                            <AppPressable
                              containerStyle={{ width: '100%', marginTop: 8 }}
                              style={styles.videoRetakeButton}
                              onPress={recordVideoForAdd}
                              scaleTo={0.97}
                            >
                              <Text style={styles.videoRetakeButtonText}>Ghi hình lại</Text>
                            </AppPressable>
                          </View>
                        ) : (
                          <AppPressable
                            containerStyle={{ width: '100%', marginTop: 8 }}
                            style={styles.videoRecordButton}
                            onPress={recordVideoForAdd}
                            scaleTo={0.97}
                          >
                            <Camera color={colors.primary} size={24} style={{ marginRight: 8 }} />
                            <Text style={styles.videoRecordButtonText}>Ghi video 2s để đăng ký khuôn mặt</Text>
                          </AppPressable>
                        )}
                        {formErrors.face_video ? <Text style={styles.errorHelper}>{formErrors.face_video}</Text> : null}
                      </View>
                    )}

                    <View style={styles.formActions}>
                      <AppPressable
                        containerStyle={{ flex: 1 }}
                        style={styles.cancelButton}
                        onPress={() => setIsModalVisible(false)}
                        disabled={isSubmitting}
                        scaleTo={0.97}
                      >
                        <Text style={styles.cancelButtonText}>Hủy</Text>
                      </AppPressable>
                      <AppPressable 
                        containerStyle={{ flex: 1 }}
                        style={[
                          styles.submitButton,
                          (!canSubmit || isSubmitting) && styles.submitButtonDisabled,
                        ]} 
                        onPress={handleAddStudent} 
                        disabled={!canSubmit || isSubmitting}
                        scaleTo={0.97}
                      >
                        {isSubmitting ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={styles.submitButtonText}>Thêm sinh viên</Text>
                        )}
                      </AppPressable>
                    </View>
                  </ScrollView>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal Register Face */}
      <Modal
        visible={isFaceModalVisible}
        transparent
        animationType="slide"
        onRequestClose={closeFaceRegisterModal}
      >
        <TouchableWithoutFeedback onPress={closeFaceRegisterModal}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.faceRegisterModal}>
                {/* Modal Header */}
                <View style={styles.faceRegisterHeader}>
                  <Text style={styles.faceRegisterTitle}>Đăng ký khuôn mặt</Text>
                  <AppPressable
                    onPress={closeFaceRegisterModal}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    style={styles.modalCloseButton}
                    scaleEnabled={false}
                  >
                    <X size={24} color="#667085" />
                  </AppPressable>
                </View>

                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.faceRegisterScrollContent}
                >
                  {/* Student Info Box */}
                  {registeringStudent && (
                    <View style={styles.studentInfoBox}>
                      <Text style={styles.studentInfoText}>
                        Sinh viên: <Text style={styles.studentInfoValue}>{registeringStudent.full_name}</Text>
                      </Text>
                      <Text style={styles.studentInfoText}>
                        MSSV: <Text style={styles.studentInfoValue}>{registeringStudent.student_code || registeringStudent.id}</Text>
                      </Text>
                    </View>
                  )}

                  <View style={styles.formGroup}>
                    <Text style={styles.formLabel}>Phương thức đăng ký khuôn mặt</Text>
                    <View style={styles.methodTabs}>
                      <AppPressable
                        containerStyle={{ flex: 1, height: '100%' }}
                        style={[styles.methodTab, faceEnrollMethod === 'photo' && styles.methodTabActive]}
                        onPress={() => setFaceEnrollMethod('photo')}
                        scaleEnabled={false}
                      >
                        <Text style={[styles.methodTabText, faceEnrollMethod === 'photo' && styles.methodTabTextActive]}>Đăng ký bằng ảnh</Text>
                      </AppPressable>
                      <AppPressable
                        containerStyle={{ flex: 1, height: '100%' }}
                        style={[styles.methodTab, faceEnrollMethod === 'video' && styles.methodTabActive]}
                        onPress={() => setFaceEnrollMethod('video')}
                        scaleEnabled={false}
                      >
                        <Text style={[styles.methodTabText, faceEnrollMethod === 'video' && styles.methodTabTextActive]}>Đăng ký bằng video</Text>
                      </AppPressable>
                    </View>
                  </View>

                  {/* Form Content / Image/Video Section */}
                  <View style={styles.formGroup}>
                    {faceEnrollMethod === 'photo' ? (
                      newFaceImage ? (
                        <View style={{ width: '100%' }}>
                          {/* Preview Section */}
                          <View style={styles.facePreviewSection}>
                            <Image
                              source={{ uri: newFaceImage.uri }}
                              style={styles.facePreviewImage}
                            />
                            <AppPressable
                              style={styles.removeFaceImageButton}
                              onPress={() => setNewFaceImage(null)}
                              scaleEnabled={false}
                            >
                              <X size={18} color="#FFFFFF" />
                            </AppPressable>
                          </View>

                          {/* Retake buttons */}
                          <View style={styles.faceRetakeActions}>
                            <AppPressable
                              containerStyle={{ flex: 1 }}
                              style={styles.secondaryFaceButton}
                              onPress={takeNewFacePhoto}
                              scaleTo={0.96}
                            >
                              <Text style={styles.secondaryFaceButtonText}>Chụp lại</Text>
                            </AppPressable>
                            <AppPressable
                              containerStyle={{ flex: 1 }}
                              style={styles.secondaryFaceButton}
                              onPress={pickNewFaceImage}
                              scaleTo={0.96}
                            >
                              <Text style={styles.secondaryFaceButtonText}>Tải ảnh khác</Text>
                            </AppPressable>
                          </View>

                          {/* Confirm button */}
                          <AppPressable
                            containerStyle={{ width: '100%', marginBottom: 12 }}
                            style={[
                              styles.confirmRegisterButton,
                              isRegisteringFace && styles.confirmRegisterButtonDisabled,
                            ]}
                            onPress={handleRegisterFace}
                            disabled={isRegisteringFace}
                            scaleTo={0.98}
                          >
                            {isRegisteringFace ? (
                              <ActivityIndicator size="small" color="#fff" />
                            ) : (
                              <Text style={styles.confirmRegisterButtonText}>Xác nhận đăng ký</Text>
                            )}
                          </AppPressable>
                        </View>
                      ) : (
                        /* Pick buttons if no image chosen */
                        <View style={styles.facePickActions}>
                          <AppPressable
                            containerStyle={{ flex: 1 }}
                            style={styles.facePickButton}
                            onPress={takeNewFacePhoto}
                            scaleTo={0.96}
                          >
                            <Camera size={26} color={colors.primary} style={{ marginBottom: 10, alignSelf: 'center' }} />
                            <Text style={styles.facePickButtonText}>Chụp ảnh</Text>
                          </AppPressable>
                          <AppPressable
                            containerStyle={{ flex: 1 }}
                            style={styles.facePickButton}
                            onPress={pickNewFaceImage}
                            scaleTo={0.96}
                          >
                            <ImageIcon size={26} color={colors.primary} style={{ marginBottom: 10, alignSelf: 'center' }} />
                            <Text style={styles.facePickButtonText}>Tải ảnh</Text>
                          </AppPressable>
                        </View>
                      )
                    ) : (
                      /* Video update flow */
                      faceEnrollVideoUri ? (
                        <View style={{ width: '100%' }}>
                          <View style={styles.videoSuccessBox}>
                            <Text style={styles.videoSuccessText}>✓ Đã quay video thành công</Text>
                          </View>
                          <AppPressable
                            containerStyle={{ width: '100%', marginTop: 8 }}
                            style={styles.videoRetakeButton}
                            onPress={recordVideoForUpdate}
                            scaleTo={0.97}
                          >
                            <Text style={styles.videoRetakeButtonText}>Ghi hình lại</Text>
                          </AppPressable>

                          {/* Confirm button */}
                          <AppPressable
                            containerStyle={{ width: '100%', marginBottom: 12, marginTop: 14 }}
                            style={[
                              styles.confirmRegisterButton,
                              isRegisteringFace && styles.confirmRegisterButtonDisabled,
                            ]}
                            onPress={handleRegisterFace}
                            disabled={isRegisteringFace}
                            scaleTo={0.98}
                          >
                            {isRegisteringFace ? (
                              <ActivityIndicator size="small" color="#fff" />
                            ) : (
                              <Text style={styles.confirmRegisterButtonText}>Xác nhận cập nhật</Text>
                            )}
                          </AppPressable>
                        </View>
                      ) : (
                        <AppPressable
                          containerStyle={{ width: '100%', marginTop: 8 }}
                          style={styles.videoRecordButton}
                          onPress={recordVideoForUpdate}
                          scaleTo={0.97}
                        >
                          <Camera color={colors.primary} size={24} style={{ marginRight: 8 }} />
                          <Text style={styles.videoRecordButtonText}>Ghi video 2s để cập nhật khuôn mặt</Text>
                        </AppPressable>
                      )
                    )}
                    {faceError ? <Text style={styles.errorHelper}>{faceError}</Text> : null}
                  </View>

                  {/* Cancel Button - Always at the bottom of flow */}
                  <AppPressable
                    containerStyle={{ width: '100%', marginTop: 8 }}
                    style={styles.cancelFaceRegisterButton}
                    onPress={closeFaceRegisterModal}
                    disabled={isRegisteringFace}
                    scaleTo={0.98}
                  >
                    <Text style={styles.cancelFaceRegisterText}>Hủy</Text>
                  </AppPressable>
                </ScrollView>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { color: colors.danger, marginBottom: spacing.md, textAlign: 'center' },
  
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  backBtn: { padding: spacing.xs },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.text, flex: 1, textAlign: 'center', letterSpacing: -0.3 },
  addBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.lg,
  },
  addBtnText: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: '700',
  },

  btnSecondary: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnSecondaryText: { color: colors.primary, fontSize: 15, fontWeight: '600' },

  toolbar: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    height: 44,
    fontSize: 14,
    color: colors.text,
  },

  filtersWrap: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  filtersScroll: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  filterChip: {
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundDark,
    borderWidth: 1,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  filterChipActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  filterChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  filterText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginRight: 6,
  },
  filterTextActive: {
    color: colors.primaryDark,
  },
  filterBadge: {
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  filterBadgeActive: {
    backgroundColor: colors.primary,
  },
  filterBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  filterBadgeTextActive: {
    color: '#fff',
  },

  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md },

  emptyWrap: {
    alignItems: 'center',
    paddingTop: spacing.xl * 2,
  },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyText: { fontSize: 15, color: colors.textMuted },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    padding: 16,
    marginBottom: 14,
    ...shadow.card,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  avatarText: { fontSize: 20, fontWeight: '800' },
  studentInfo: { 
    flex: 1, 
    justifyContent: 'center',
    paddingRight: 8
  },
  name: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 },
  code: { fontSize: 13, color: colors.textSecondary, marginBottom: 4 },
  time: { fontSize: 12, color: colors.textMuted },
  
  statusColumn: {
    alignItems: 'flex-end',
    width: 90,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  faceBadge: {
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  faceBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },

  cardDivider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginVertical: 12,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: 'transparent',
  },
  actionBtnText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  deleteBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
    backgroundColor: '#FEE2E2',
  },

  modalKeyboardView: {
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  addStudentModal: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '90%',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 20,
  },
  addStudentScrollContent: {
    paddingBottom: 48,
  },
  addStudentTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 28,
  },
  formGroup: {
    marginBottom: 18,
  },
  formLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: '#475467',
    marginBottom: 8,
  },
  formInput: {
    height: 56,
    borderRadius: 18,
    backgroundColor: '#F3F6FF',
    paddingHorizontal: 18,
    fontSize: 16,
    color: '#111827',
    borderWidth: 1,
    borderColor: '#E5EAF3',
  },
  inputError: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerBg,
  },
  errorHelper: {
    color: colors.danger,
    fontSize: 12,
    marginTop: 4,
  },
  formActions: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 20,
    marginBottom: 4,
  },
  cancelButton: {
    height: 56,
    borderRadius: 18,
    backgroundColor: '#EEF3FF',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#475467',
  },
  submitButton: {
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  submitButtonDisabled: {
    opacity: 0.45,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  subLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  imagePickers: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  imgBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderStyle: 'dashed',
    gap: spacing.xs,
  },
  imgBtnText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  imagePreviewWrap: {
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  imagePreview: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: colors.primaryLight,
  },
  removeImageBtn: {
    position: 'absolute',
    top: 0,
    right: '30%',
    backgroundColor: 'rgba(0,0,0,0.6)',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Modal Đăng ký khuôn mặt thiết kế mới
  faceRegisterModal: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '85%',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    width: '100%',
  },
  faceRegisterScrollContent: {
    paddingBottom: 32,
  },
  faceRegisterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    height: 40,
  },
  faceRegisterTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.3,
  },
  modalCloseButton: {
    padding: 4,
  },
  studentInfoBox: {
    backgroundColor: '#F3F6FF',
    borderRadius: 18,
    padding: 16,
    marginTop: 18,
    marginBottom: 22,
    width: '100%',
  },
  studentInfoText: {
    fontSize: 16,
    color: '#475467',
    fontWeight: '600',
    marginBottom: 6,
  },
  studentInfoValue: {
    color: '#111827',
    fontWeight: '800',
  },
  facePickActions: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
    marginTop: 14,
    marginBottom: 22,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  facePickButton: {
    flex: 1,
    width: '100%',
    height: 120,
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
  },
  facePickButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.primary,
    textAlign: 'center',
  },
  facePreviewSection: {
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 22,
    position: 'relative',
  },
  facePreviewImage: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: '#EEF1F7',
    borderWidth: 4,
    borderColor: '#EEF3FF',
  },
  removeFaceImageButton: {
    position: 'absolute',
    left: -6,
    bottom: -6,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#667085',
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceRetakeActions: {
    flexDirection: 'row',
    width: '100%',
    gap: 14,
    marginBottom: 22,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  secondaryFaceButton: {
    flex: 1,
    width: '100%',
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryFaceButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  confirmRegisterButton: {
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  confirmRegisterButtonDisabled: {
    opacity: 0.65,
  },
  confirmRegisterButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  cancelFaceRegisterButton: {
    height: 56,
    borderRadius: 18,
    backgroundColor: '#EEF3FF',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  cancelFaceRegisterText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#475467',
  },
  videoRecordButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: 56,
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
  },
  videoRecordButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  videoSuccessBox: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1.5,
    borderRadius: 18,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 12,
    width: '100%',
  },
  videoSuccessText: {
    color: '#059669',
    fontSize: 15,
    fontWeight: '800',
  },
  videoRetakeButton: {
    width: '100%',
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoRetakeButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  methodTabs: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: radius.lg,
    padding: 4,
    gap: 4,
    marginTop: 6,
    height: 52,
    alignItems: 'center',
    width: '100%',
    overflow: 'hidden',
  },
  methodTab: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: 'transparent',
    paddingHorizontal: 8,
  },
  methodTabActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
    height: '100%',
  },
  methodTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  methodTabTextActive: {
    color: colors.primaryDark,
    fontWeight: '700',
  },
});
