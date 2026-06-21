import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import AppPressable from '../components/AppPressable';
import { useFocusEffect } from '@react-navigation/native';
import { ChevronLeft, Calendar, Clock, MapPin, Users, ScanFace, List } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../utils/api';
import { colors, spacing, radius } from '../theme';

export default function SessionDetailScreen({ route, navigation }) {
  const { session_id } = route.params;
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadDetail = async () => {
    try {
      setError(null);
      setLoading(true);
      const res = await api.getSessionDetail(session_id);
      setSession(res);
    } catch (err) {
      setError(err.message || 'Không thể tải thông tin ca học');
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => {
    loadDetail();
  }, [session_id]));

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (error || !session) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.errorText}>{error || 'Không tìm thấy ca học'}</Text>
        <AppPressable style={styles.btnSecondary} onPress={() => navigation.goBack()} scaleTo={0.97}>
          <Text style={styles.btnSecondaryText}>Quay lại</Text>
        </AppPressable>
      </SafeAreaView>
    );
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'ongoing': return colors.success;
      case 'upcoming': return colors.primary;
      case 'finished': return colors.textMuted;
      default: return colors.textSecondary;
    }
  };
  
  const getStatusBgColor = (status) => {
    switch (status) {
      case 'ongoing': return colors.successBg;
      case 'upcoming': return colors.primaryLight;
      case 'finished': return colors.borderLight;
      default: return 'transparent';
    }
  };

  const handleStartAttendance = () => {
    if (session.status !== 'ongoing') {
      Alert.alert('Thông báo', 'Chỉ có thể điểm danh khi ca học đang diễn ra.');
      return;
    }
    navigation.navigate('Attendance', { session_id: session.id });
  };

  const isAttendanceDisabled = session.status !== 'ongoing';

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <AppPressable style={styles.backBtn} onPress={() => navigation.goBack()} scaleEnabled={false}>
          <ChevronLeft color={colors.text} size={24} />
        </AppPressable>
        <Text style={styles.headerTitle}>Chi tiết ca học</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Status Badge */}
        <View style={{ alignItems: 'flex-start', marginBottom: spacing.sm }}>
          <View style={[styles.statusBadge, { backgroundColor: getStatusBgColor(session.status) }]}>
            <Text style={[styles.statusText, { color: getStatusColor(session.status) }]}>
              {session.status_label}
            </Text>
          </View>
        </View>

        <Text style={styles.subjectName}>{session.subject?.subject_name}</Text>
        <Text style={styles.classInfo}>
          Lớp: {session.course_class?.class_code} • Mã LHP: {session.section_code}
        </Text>

        <View style={styles.card}>
          <View style={styles.detailRow}>
            <View style={styles.detailIconBox}>
              <Calendar size={20} color={colors.primary} />
            </View>
            <View style={styles.detailTextContent}>
              <Text style={styles.detailLabel}>Ngày học</Text>
              <Text style={styles.detailValue}>{session.day_of_week}, {session.study_date}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <View style={styles.detailIconBox}>
              <Clock size={20} color={colors.primary} />
            </View>
            <View style={styles.detailTextContent}>
              <Text style={styles.detailLabel}>Thời gian</Text>
              <Text style={styles.detailValue}>
                Tiết {session.lesson_start} - {session.lesson_end} 
                {'  '}({new Date(session.start_time).toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'})} - {new Date(session.end_time).toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'})})
              </Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <View style={styles.detailIconBox}>
              <MapPin size={20} color={colors.primary} />
            </View>
            <View style={styles.detailTextContent}>
              <Text style={styles.detailLabel}>Phòng học</Text>
              <Text style={styles.detailValue}>{session.room}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <View style={styles.detailIconBox}>
              <Users size={20} color={colors.primary} />
            </View>
            <View style={styles.detailTextContent}>
              <Text style={styles.detailLabel}>Giảng viên</Text>
              <Text style={styles.detailValue}>
                {session.teachers?.map(t => t.full_name).join(', ') || 'Chưa phân công'}
              </Text>
            </View>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionsContainer}>
          <AppPressable 
            style={[styles.btnPrimary, isAttendanceDisabled && styles.btnDisabled]}
            onPress={handleStartAttendance}
            disabled={isAttendanceDisabled}
            scaleTo={0.97}
          >
            <ScanFace color="#fff" size={20} style={{ marginRight: 8 }} />
            <Text style={styles.btnPrimaryText}>
              {session.status === 'upcoming' ? 'Ca học chưa bắt đầu' : session.status === 'finished' ? 'Ca học đã kết thúc' : 'Bắt đầu điểm danh'}
            </Text>
          </AppPressable>
 
          <AppPressable 
            style={styles.btnSecondary}
            onPress={() => navigation.navigate('Students', { session_id: session.id })}
            scaleTo={0.97}
          >
            <List color={colors.primary} size={20} style={{ marginRight: 8 }} />
            <Text style={styles.btnSecondaryText}>Danh sách sinh viên</Text>
          </AppPressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  errorText: { color: colors.danger, marginBottom: spacing.md },
  
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    backgroundColor: colors.background,
  },
  backBtn: { padding: spacing.xs },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.text, letterSpacing: -0.3 },
  
  content: { padding: spacing.md },
  
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.md,
  },
  statusText: { fontSize: 13, fontWeight: '700' },
  
  subjectName: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.4,
    marginBottom: 4,
    marginTop: spacing.xs,
  },
  classInfo: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    padding: spacing.md,
    shadowColor: '#1E3A6E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    marginBottom: spacing.xl,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
  },
  detailIconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  detailTextContent: { flex: 1, justifyContent: 'center' },
  detailLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 2 },
  detailValue: { fontSize: 15, fontWeight: '600', color: colors.text },
  divider: { height: 1, backgroundColor: colors.borderLight, marginVertical: 4 },
  
  actionsContainer: { gap: spacing.md },
  
  btnPrimary: {
    flexDirection: 'row',
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  btnDisabled: {
    backgroundColor: colors.borderLight,
    shadowOpacity: 0,
    elevation: 0,
  },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  
  btnSecondary: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnSecondaryText: { color: colors.primary, fontSize: 16, fontWeight: '700' },
});
